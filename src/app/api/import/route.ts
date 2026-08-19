/**
 * Import commit endpoint (multi-tab).
 * POST multipart/form-data:
 *   - file   : the .xlsx/.xls/.csv to import
 *   - sheets : JSON string of
 *              [{ sheetName, collectionName?,
 *                 fields?: [{name,key,type,sourceHeader?,required?,options?}] }]
 *              — one entry per sheet (tab) the user chose to import.
 *
 * `sourceHeader` pins a field to the column it was read from. The display name
 * is free text the user may rename; the column it reads must never move with it.
 *
 * Back-compat: if `sheets` is absent, falls back to a single-sheet import using
 * `collectionName` + `fields` against the first sheet.
 *
 * Each selected sheet becomes its own Collection (spreadsheet) with typed
 * Fields and one Record per row. Tenant-safe and plan-limited; all-or-nothing
 * (any failure rolls back every collection created in this request).
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { slugify, uniqueName, toFieldKey } from "@/lib/utils";
import { getPlan } from "@/lib/plans";
import {
  assertWithinCollectionLimit,
  takenSlugsWithReserved,
} from "@/lib/master-objects";
import { logActivity } from "@/lib/workspace";
import {
  isFieldType,
  coerceValue,
  type FieldType,
  type SelectOption,
} from "@/lib/field-types";
import {
  readSheet,
  parseWorkbook,
  inferFields,
  sheetWarnings,
  MAX_IMPORT_BYTES,
} from "@/lib/excel";

const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];
const MAX_LABEL = "15MB";
const BATCH_SIZE = 500;

interface FinalField {
  name: string;
  key: string;
  type: FieldType;
  required: boolean;
  options?: SelectOption[];
  /** 値を読み出す元の列名。null なら対応する列が無い＝常に空欄。 */
  sourceHeader: string | null;
}

interface SheetSelection {
  sheetName: string;
  collectionName?: string;
  fields?: unknown;
}

/**
 * Normalise a user-supplied fields array into a validated, key-unique schema.
 *
 * 【回帰防止】以前はここで名前が空の項目を「捨て」、レコード生成側が
 * fields[i] と headers[i] を添え字で突き合わせていた。画面の列名は自由入力で
 * 検証も無かったため、例えば ["氏名","部署","入社日"] の「部署」を空にすると
 * フィールドが [氏名, 入社日] に詰まり、入社日が row["部署"]（＝営業部）を
 * 読んで最後の列は丸ごと消えていた。しかもエラーにならず 200 で完了していた。
 * そこで対応は添え字ではなく「元の列名」で固定し、空の列名はそもそも受け付けない。
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
        // プレビュー時と列構成が変わっている。ここで続けると全列が1つずつ
        // ずれた状態で取り込まれるため、書き込まずに読み直してもらう。
        throw new ApiError(
          `列「${rec.sourceHeader}」が見つかりません。取り込み元の内容が変わった可能性があります。もう一度読み込み直してください。`,
          409,
        );
      }
      sourceHeader = rec.sourceHeader;
    } else {
      // sourceHeader を送らない旧クライアント／API直叩き用の後方互換。
      // 「絞り込んだ後の位置」ではなく「元の配列での位置」で対応させる。
      sourceHeader = index < headers.length ? headers[index] : null;
    }
    fields.push({ name, key, type, required: rec.required === true, options, sourceHeader });
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
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError("ファイルを読み取れませんでした。もう一度アップロードしてください。", 400);
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    throw new ApiError("ファイルが指定されていません", 400);
  }
  const fileName = file.name ?? "";
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    throw new ApiError("対応形式は .xlsx / .xls / .csv です", 415);
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ApiError(`ファイルサイズが上限（${MAX_LABEL}）を超えています`, 413);
  }

  // Resolve which sheets to import.
  let selections: SheetSelection[] = [];
  const sheetsRaw = form.get("sheets");
  if (typeof sheetsRaw === "string" && sheetsRaw.trim()) {
    try {
      const parsed = JSON.parse(sheetsRaw);
      if (Array.isArray(parsed)) {
        selections = parsed
          .filter((s) => s && typeof s === "object" && typeof s.sheetName === "string")
          .map((s) => ({
            sheetName: s.sheetName,
            collectionName:
              typeof s.collectionName === "string" ? s.collectionName : undefined,
            fields: s.fields,
          }));
      }
    } catch {
      throw new ApiError("取り込むシートの指定が正しくありません。画面をもう一度読み込んでお試しください。", 400);
    }
  }

  const buffer = await file.arrayBuffer();
  const plan = getPlan(user.workspace.plan);

  // No explicit `sheets` list. Two very different callers land here:
  //
  //   a) a caller that names one sheet's collection/fields — honour that and
  //      import exactly that one sheet (the original back-compat contract), and
  //   b) a bare "here is a file" upload, which is what the home drop zone
  //      sends. That one used to import ONLY THE FIRST TAB and silently throw
  //      the rest away: drop a 3-tab workbook, get one table, no warning. For
  //      a product whose front door is "put your Excel here" that is data loss,
  //      so a bare upload now means every sheet in the file.
  if (selections.length === 0) {
    const nameInput = form.get("collectionName");
    const fieldsInput = form.get("fields");
    let fields: unknown = undefined;
    if (typeof fieldsInput === "string" && fieldsInput.trim()) {
      try {
        fields = JSON.parse(fieldsInput);
      } catch {
        fields = undefined;
      }
    }
    const named = typeof nameInput === "string" && nameInput.trim().length > 0;

    if (named || fields !== undefined) {
      selections = [
        {
          sheetName: "", // first sheet
          collectionName: typeof nameInput === "string" ? nameInput : undefined,
          fields,
        },
      ];
    } else {
      // `parseWorkbook` returns [] for anything it cannot open (and for CSV,
      // one pseudo-sheet). Falling back to the single unnamed sheet keeps the
      // existing error handling — an unreadable file still reports properly.
      const { sheets } = parseWorkbook(buffer);
      selections =
        sheets.length > 0
          ? sheets.map((sheetName) => ({ sheetName }))
          : [{ sheetName: "" }];
    }
  }

  // Existing slugs for uniqueness across the whole batch.
  const existing = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
    select: { slug: true },
  });
  // マスターDBの slug は予約語 — 詳細は master-objects.ts。
  const takenSlugs = takenSlugsWithReserved(existing);

  // --- Prepare + validate every selected sheet BEFORE any write ---

  // 拡張子を落としたファイル名。ファイル（ブック）の名前であり、タブが1枚しか
  // 無いときはシートの名前にもなる。
  const fileBase = fileName.replace(/\.[^.]+$/, "").trim() || "インポート";

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
    // Proの行数上限（50,000）は読み取り上限と同じなので、20万行のファイルでも
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
    /*
     * CSV にはタブが無く、SheetJS は読み込んだ内容に "Sheet1" という既定名を
     * 付ける。それをそのまま使うと、サイドバーに ファイル「売上台帳」→
     * シート「Sheet1」と並び、利用者が付けた名前がどこにも出なかった。
     * タブが1枚しか無いときは、ファイル名の方が中身を表している。
     */
    const isPlaceholderName = /^sheet\s*\d*$/i.test(sheetName.trim());
    const collectionName =
      (sel.collectionName && sel.collectionName.trim()) ||
      (selections.length === 1 && isPlaceholderName ? fileBase : sheetName) ||
      fileBase;
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

  // --- Group all sheets under one Workbook (the file) ---
  const workbook = await db.workbook.create({
    data: {
      workspaceId: user.workspace.id,
      name: fileBase,
      source: ext === ".csv" ? "csv" : "excel",
    },
  });

  // --- Create each collection + its records; roll back all on any failure ---
  const created: Array<{ id: string; name: string; imported: number; skipped: number }> = [];
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
            f.sourceHeader !== null ? row[f.sourceHeader] ?? null : null;
          const result = coerceValue(f.type, raw, f.options);
          if (result.ok) data[f.key] = result.value;
          else {
            data[f.key] = null;
            skipped += 1;
          }
        }
        return data;
      });

      for (let i = 0; i < recordData.length; i += BATCH_SIZE) {
        const batch = recordData.slice(i, i + BATCH_SIZE);
        await db.$transaction(
          batch.map((data) =>
            db.record.create({
              data: {
                collectionId: collection.id,
                createdById: user.id,
                data: toJson(data),
              },
            }),
          ),
        );
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
          `Import rollback: collections ${createdIds.join(", ")} could not be deleted; workbook ${workbook.id} kept so they are not orphaned`,
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
          `Import rollback: empty workbook ${workbook.id} could not be deleted`,
          cleanupErr,
        );
      }
    }

    if (leftover !== null) {
      // 片付けきれなかったことは黙らない。探す場所が違うものを一律に
      // 「スプレッドシート一覧を確認」と案内すると、存在しないシートを
      // 探させることになる。
      const base =
        err instanceof ApiError ? err.message : "インポート中にエラーが発生しました";
      const hint =
        leftover === "sheet"
          ? "取り込み途中のスプレッドシートを削除できませんでした。スプレッドシート一覧をご確認のうえ削除してください"
          : "中身のない空のファイルが残りました。行は取り込まれていません。ファイル一覧から削除してください";
      console.error("Import failed and rollback was incomplete:", err);
      throw new ApiError(
        `${base}（${hint}）`,
        err instanceof ApiError ? err.status : 500,
      );
    }
    if (err instanceof ApiError) throw err;
    console.error("Import failed:", err);
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
      source: "import",
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
    collectionId: created[0].id,
    workbookId: workbook.id,
    fileName,
    source: ext === ".csv" ? "csv" : "excel",
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
