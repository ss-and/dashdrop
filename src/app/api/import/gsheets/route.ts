/**
 * Google Sheets import commit endpoint (no OAuth).
 * POST JSON:
 *   {
 *     url: string,                          // public / link-shared Sheets URL
 *     sheets: [{ sheetName, collectionName?,
 *                fields?: [{name,key,type,sourceHeader?,required?,options?}] }]
 *   }
 *
 * Mirrors /api/import: fetches the sheet as CSV via its public export URL, then
 * turns each selected sheet into its own Collection with typed Fields and one
 * Record per row. Tenant-safe and plan-limited; all-or-nothing (any failure
 * rolls back every collection created in this request).
 *
 * The CSV is fetched a second time here (preview fetched its own copy), so the
 * sheet may have changed in between. `sourceHeader` pins every field to the
 * column it was mapped against and the commit is refused if that column is
 * gone — pairing by position would silently shift every mapping instead.
 */
import { withAuth, ok, ApiError, readJson } from "@/lib/api";
import { z } from "zod";
import { db, toJson } from "@/lib/db";
import { slugify, uniqueName, toFieldKey } from "@/lib/utils";
import { assertCanCreateCollection, logActivity } from "@/lib/workspace";
import { getPlan } from "@/lib/plans";
import {
  assertWithinCollectionLimit,
  takenSlugsWithReserved,
} from "@/lib/master-objects";
import {
  isFieldType,
  coerceValue,
  type FieldType,
  type SelectOption,
} from "@/lib/field-types";
import { readSheet, inferFields, sheetWarnings } from "@/lib/excel";
import { toCsvExportUrl, fetchSheetCsv } from "@/lib/gsheets";
import { assertCapability } from "@/lib/workspace";

/** 1回の createMany にまとめる行数。値の根拠は /api/import と同じ。 */
const BATCH_SIZE = 2000;

/**
 * Google からの CSV 取得（ネットワーク）＋ 行の一括書き込みに与える上限（秒）。
 * 宣言が無いと Vercel の既定（10〜15秒）で切られ、all-or-nothing の巻き戻しの
 * せいで「待たされた末に何も起きなかった」になる。
 *
 * 60 は Vercel Pro の最大（800秒）ではなく、Hobby でも他のホスティングでも
 * 通る値。/api/import・Notion 取り込み・cron の2本と同じ値でそろえてある。
 */
export const maxDuration = 60;

interface FinalField {
  name: string;
  key: string;
  type: FieldType;
  required: boolean;
  options?: SelectOption[];
  /** 値を読み出す元の列名。null なら対応する列が無い＝常に空欄。 */
  sourceHeader: string | null;
}

const bodySchema = z.object({
  url: z.string(),
  sheets: z
    .array(
      z.object({
        sheetName: z.string(),
        collectionName: z.string().optional(),
        fields: z.unknown().optional(),
      }),
    )
    .optional(),
});

/**
 * Normalise a user-supplied fields array into a validated, key-unique schema.
 *
 * 【回帰防止】以前はここで名前が空の項目を「捨て」、レコード生成側が
 * fields[i] と headers[i] を添え字で突き合わせていた。画面の列名は自由入力で
 * 検証も無かったため、列名を1つ空にすると以降のフィールドが1つずつ後ろの列を
 * 読み、最後の列は丸ごと消えていた。しかもエラーにならず 200 で完了していた。
 * Google Sheets では取り込み直前にCSVを取り直すため、プレビュー後に列が
 * 増減しただけでも同じずれが起きる。対応は添え字ではなく「元の列名」で固定する。
 */
function parseFieldsArray(
  arr: unknown,
  headers: string[],
): FinalField[] | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const headerSet = new Set(headers);
  const takenKeys = new Set<string>();
  const fields: FinalField[] = [];
  arr.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) {
      // 空の列名は「この列を捨てる」という指示ではない（画面に削除操作は無い）。
      // 黙って捨てると以降の対応がずれるので、書き込む前に止めて直してもらう。
      throw new ApiError(
        `${index + 1}列目の列名が空です。列名を入力してから取り込んでください。`,
        400,
      );
    }
    const type: FieldType = isFieldType(rec.type) ? rec.type : "text";
    const rawKey =
      typeof rec.key === "string" && rec.key.trim()
        ? toFieldKey(rec.key)
        : toFieldKey(name);
    const key = uniqueName(rawKey, takenKeys);
    takenKeys.add(key);
    const options = Array.isArray(rec.options)
      ? (rec.options as SelectOption[])
      : undefined;

    // 突き合わせは表示名ではなく元の列で行う。名前で引くと、利用者が別の列と
    // 同じ名前（例：「金額-2」を「金額」に戻す）に変えたときに、空欄のセルが
    // 隣の列の値を静かに継承してしまう。
    let sourceHeader: string | null;
    if (typeof rec.sourceHeader === "string" && rec.sourceHeader) {
      if (!headerSet.has(rec.sourceHeader)) {
        // プレビュー時から列が変わっている。ここで続けると全列が1つずつ
        // ずれた状態で取り込まれるため、書き込まずに読み直してもらう。
        throw new ApiError(
          `列「${rec.sourceHeader}」が見つかりません。プレビュー後にGoogle スプレッドシート側の列が変更された可能性があります。もう一度読み込み直してください。`,
          409,
        );
      }
      sourceHeader = rec.sourceHeader;
    } else {
      // sourceHeader を送らない旧クライアント／API直叩き用の後方互換。
      // 「絞り込んだ後の位置」ではなく「元の配列での位置」で対応させる。
      sourceHeader = index < headers.length ? headers[index] : null;
    }
    fields.push({
      name,
      key,
      type,
      required: rec.required === true,
      options,
      sourceHeader,
    });
  });
  return fields.length ? fields : null;
}

/**
 * 取り込み後に必ず利用者へ見せる注意書き。全て問題なければ null。
 * Notion取り込み（/api/import/notion）の `warning` と同じ契約にそろえてある。
 *
 * 行・列の打ち切り文言はパーサ（sheetWarnings）に集約されている。ここで
 * 独自に書き起こすと、上限を変えたときに画面とログで食い違うため。
 */
function buildWarning(parseWarnings: string[], skipped: number): string | null {
  const parts = [...parseWarnings];
  if (skipped > 0) {
    parts.push(
      `${skipped.toLocaleString()} 件のセルが列の型に合わず、空欄として取り込まれました。「1,234円」のように単位や記号が混じっていないかご確認ください。`,
    );
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

interface PreparedJob {
  collectionName: string;
  slug: string;
  fields: FinalField[];
  rows: Record<string, unknown>[];
  sheetName: string;
  truncated: boolean;
  /** パーサが申告した打ち切り警告（行・列）。日本語のまま利用者に見せる。 */
  warnings: string[];
}

export const POST = withAuth(async (req, { user }) => {
  // integrations は有料プランの機能。判定は assertCapability に一本化する。
  assertCapability(user, "integrations");
  const body = await readJson(req, bodySchema);

  const exportUrl = toCsvExportUrl(body.url);
  if (!exportUrl) {
    throw new ApiError("Google SheetsのURLを貼り付けてください。", 400);
  }

  // Cheap guard before we fetch/prepare anything.
  await assertCanCreateCollection(user);

  const buffer = await fetchSheetCsv(exportUrl);
  const plan = getPlan(user.workspace.plan);

  // A CSV export is a single sheet; the wizard still sends a selection array.
  const selections =
    body.sheets && body.sheets.length > 0
      ? body.sheets
      : [{ sheetName: "", collectionName: undefined, fields: undefined }];

  // Existing slugs for uniqueness across the whole batch.
  const existing = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
    select: { slug: true },
  });
  // マスターDBの slug は予約語 — 詳細は master-objects.ts。
  const takenSlugs = takenSlugsWithReserved(existing);

  // --- Prepare + validate every selected sheet BEFORE any write ---

  const jobs: PreparedJob[] = [];
  for (const sel of selections) {
    const parsed = readSheet(buffer, sel.sheetName || undefined);
    const { sheetName, headers, rows, sampleByHeader } = parsed;
    if (headers.length === 0) continue; // skip empty tabs silently
    if (rows.length > plan.limits.recordsPerCollection) {
      throw new ApiError(
        `シート「${sheetName}」の行数がプラン「${plan.name}」の上限（${plan.limits.recordsPerCollection.toLocaleString()}）を超えます。`,
        403,
      );
    }
    // 【回帰防止】上のプラン判定はパーサの読み取り上限より上には効かない。
    // Proの行数上限（50,000）は読み取り上限と同じなので、それを超えるシートでも
    // 条件が成立せず「50,000行を取り込めました」と成功として返っていた。
    // 打ち切りはエラーにせず「警告つきの成功」として必ず利用者に伝える。
    const warnings = sheetWarnings({ ...parsed, sheetName });
    const fields =
      parseFieldsArray(sel.fields, headers) ??
      inferFields(headers, sampleByHeader).map((f) => ({
        ...f,
        required: false,
        // 推定フィールドは列そのものなので、名前がそのまま元の列。
        sourceHeader: f.name,
      }));
    const collectionName =
      (sel.collectionName && sel.collectionName.trim()) ||
      sheetName ||
      "インポート";
    const slug = uniqueName(slugify(collectionName), takenSlugs);
    takenSlugs.add(slug);
    jobs.push({
      collectionName,
      slug,
      fields,
      rows,
      sheetName,
      truncated: parsed.truncated,
      warnings,
    });
  }

  if (jobs.length === 0) {
    throw new ApiError("取り込めるシートがありませんでした", 422);
  }

  // 上限は「実際に作るシートの数」で判定する。選択された数で数えると、
  // 空タブを含むファイルで、実際には収まるのに 403 になってしまう。
  // まだ何も書いていないので、ここで弾いても副作用は無い。
  assertWithinCollectionLimit(plan, existing, jobs.length);

  // --- Group all sheets under one Workbook (the imported Google Sheet) ---
  const workbookName =
    jobs.length === 1 ? jobs[0].collectionName : "Google Sheets";
  const workbook = await db.workbook.create({
    data: {
      workspaceId: user.workspace.id,
      name: workbookName,
      source: "gsheets",
    },
  });

  // --- Create each collection + its records; roll back all on any failure ---
  const created: Array<{
    id: string;
    name: string;
    imported: number;
    skipped: number;
  }> = [];
  const createdIds: string[] = [];
  let position = existing.length;

  try {
    for (const job of jobs) {
      const collection = await db.collection.create({
        data: {
          workspaceId: user.workspace.id,
          workbookId: workbook.id,
          name: job.collectionName,
          slug: job.slug,
          description: "",
          icon: "table",
          color: "khaki",
          template: "custom",
          position: position++,
          fields: {
            create: job.fields.map((f, index) => ({
              key: f.key,
              name: f.name,
              type: f.type,
              required: f.required,
              options: f.options ? toJson(f.options) : undefined,
              position: index,
            })),
          },
        },
      });
      createdIds.push(collection.id);

      let skipped = 0;
      const recordData = job.rows.map((row) => {
        const data: Record<string, unknown> = {};
        for (const f of job.fields) {
          // 読むのは固定された元の列だけ。表示名やキーでの代替探索は行わない
          // （空欄のセルが同名の別列の値を継承してしまうため）。
          const raw =
            f.sourceHeader !== null ? (row[f.sourceHeader] ?? null) : null;
          const result = coerceValue(f.type, raw, f.options);
          if (result.ok) data[f.key] = result.value;
          else {
            data[f.key] = null;
            skipped += 1;
          }
        }
        return data;
      });

      /*
       * 行の書き込み。1バッチ＝1文（createMany）。/api/import と同じ理由で、
       * 500件ぶんの `create` を1トランザクションに詰める形をやめている
       * （トランザクションが1つでも往復は行数ぶん出る。詳細は
       * src/app/api/import/route.ts の BATCH_SIZE のコメント）。
       *
       * id は渡さない（Record.id は cuid の既定値）。巻き戻しは下の catch が
       * Collection ごと消す形なので、書き込み側をトランザクションで囲む必要は
       * ない——Record は cascade で一緒に消える。
       */
      for (let i = 0; i < recordData.length; i += BATCH_SIZE) {
        const batch = recordData.slice(i, i + BATCH_SIZE);
        await db.record.createMany({
          data: batch.map((data) => ({
            collectionId: collection.id,
            createdById: user.id,
            data: toJson(data),
          })),
        });
      }

      created.push({
        id: collection.id,
        name: job.collectionName,
        imported: job.rows.length,
        skipped,
      });
    }
  } catch (err) {
    // All-or-nothing: drop the collections (fields/records cascade) first — the
    // workbook relation is SetNull, so deleting the workbook alone would leave
    // half-imported orphan spreadsheets behind.
    //
    // 【回帰防止】以前は deleteMany を .catch(() => {}) で握りつぶしたうえで、
    // Workbook の削除を無条件に実行していた。Collection の削除だけ失敗すると
    // 「失敗しました」と伝えた裏で、中途半端なシートが親のない状態で一覧に
    // 現れてしまう。順序は「保証」でなければ意味がない。
    // 何が残ってしまったかで案内先が変わるので「失敗した」だけでは足りない。
    // sheet: 中途半端なスプレッドシート（＋その入れ物のファイル）。
    // workbook: 中身のない空のファイルだけ。
    let leftover: "sheet" | "workbook" | null = null;
    if (createdIds.length > 0) {
      try {
        await db.collection.deleteMany({ where: { id: { in: createdIds } } });
      } catch (cleanupErr) {
        leftover = "sheet";
        console.error(
          `Google Sheets import rollback: collections ${createdIds.join(", ")} could not be deleted; workbook ${workbook.id} kept so they are not orphaned`,
          cleanupErr,
        );
      }
    }
    if (leftover === null) {
      try {
        await db.workbook.delete({ where: { id: workbook.id } });
      } catch (cleanupErr) {
        // Collection は消えている（または作られていない）ので孤児は残らない。
        // 残るのは中身のない Workbook＝利用者から見て「空のファイル」だけ。
        leftover = "workbook";
        console.error(
          `Google Sheets import rollback: empty workbook ${workbook.id} could not be deleted`,
          cleanupErr,
        );
      }
    }

    if (leftover !== null) {
      // 片付けきれなかったことは黙らない。探す場所が違うものを一律に
      // 「スプレッドシート一覧を確認」と案内すると、存在しないシートを
      // 探させることになる。
      const base =
        err instanceof ApiError
          ? err.message
          : "インポート中にエラーが発生しました";
      const hint =
        leftover === "sheet"
          ? "取り込み途中のスプレッドシートを削除できませんでした。スプレッドシート一覧をご確認のうえ削除してください"
          : "中身のない空のファイルが残りました。行は取り込まれていません。ファイル一覧から削除してください";
      console.error(
        "Google Sheets import failed and rollback was incomplete:",
        err,
      );
      throw new ApiError(
        `${base}（${hint}）`,
        err instanceof ApiError ? err.status : 500,
      );
    }
    if (err instanceof ApiError) throw err;
    console.error("Google Sheets import failed:", err);
    throw new ApiError("インポート中にエラーが発生しました", 500);
  }

  // 【回帰防止】collection.created の記録は try の中にあり、ロールバックでも
  // 取り消されなかった。失敗した取り込みでも /logs に記録が残り、既に削除された
  // スプレッドシートへのリンクになっていた。全て成功してからまとめて記録する。
  for (const c of created) {
    await logActivity(user.workspace.id, "collection.created", {
      collectionId: c.id,
      name: c.name,
      template: "custom",
      source: "gsheets",
    });
  }

  const totalRows = created.reduce((a, c) => a + c.imported, 0);
  const totalSkipped = created.reduce((a, c) => a + c.skipped, 0);
  const warning = buildWarning(
    jobs.flatMap((j) => j.warnings),
    totalSkipped,
  );
  const truncated = jobs.some((j) => j.truncated);

  await logActivity(user.workspace.id, "import.completed", {
    sheets: created.length,
    rows: totalRows,
    source: "gsheets",
    collectionId: created[0].id,
    workbookId: workbook.id,
    fileName: workbookName,
    sheetNames: created.map((c) => c.name),
    skipped: totalSkipped,
    // 監査ログを見ただけで「全行入ったのか」が分かるようにする。
    truncated,
    ...(warning ? { truncationMessage: warning } : {}),
  });

  return ok({
    collections: created,
    collectionId: created[0].id, // first, for redirect
    workbookId: workbook.id,
    sheetsImported: created.length,
    imported: totalRows,
    skipped: totalSkipped,
    truncated,
    // UIはこの文言をそのまま表示する。null なら注意すべきことは無い。
    warning,
  });
});
