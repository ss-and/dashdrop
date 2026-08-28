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
 *   - mode   : "replace"（同名ファイルを上書き）| "add"（別ファイルとして追加）
 *   - workbookId : 上書き先のファイル（省略時は同名のものを探す）
 *
 * Back-compat: if `sheets` is absent, falls back to a single-sheet import using
 * `collectionName` + `fields` against the first sheet. `mode` を省略すると
 * "add"（従来どおり毎回新しいファイルとして追加）になる。
 *
 * Each selected sheet becomes its own Collection (spreadsheet) with typed
 * Fields and one Record per row. Tenant-safe and plan-limited; all-or-nothing
 * (any failure rolls back every collection created in this request).
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { slugify, uniqueName, toFieldKey } from "@/lib/utils";
import { getPlan, limitOf, plansEnforced } from "@/lib/plans";
import {
  assertWithinCollectionLimit,
  takenSlugsWithReserved,
} from "@/lib/master-objects";
import { assertCanCreateWorkbook, logActivity } from "@/lib/workspace";
import { createNotification } from "@/lib/notify";
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
/** 利用者に見せる上限の表記。MAX_IMPORT_BYTES と必ず一致させること。 */
const MAX_LABEL = "4MB";

/**
 * 1回の書き込みにまとめる行数。
 *
 * 【500件ずつの `create` から `createMany` にした理由】
 * 以前はこのバッチを `$transaction([create, create, ...])` に詰めていた。
 * トランザクションは1つでも、中身は行数ぶんの INSERT 文＝行数ぶんの往復で、
 * 手元の SQLite（ファイル直叩き、往復ほぼ0秒）では速く見えていた。本番の
 * マネージド PostgreSQL は1文あたり数〜十数ミリ秒かかるので、5,000行の台帳で
 * 5,000往復＝それだけで数十秒。ルートの制限時間を先に使い切って、しかも
 * all-or-nothing で巻き戻すため、利用者から見ると「長時間待たされた末に
 * 何も起きずに失敗した」になっていた。
 *
 * `createMany` は1バッチが1文になるので、往復は行数ぶんから 1/BATCH_SIZE に減る。
 * それでも上限を残す理由は往復ではなくクエリの方——PostgreSQL の
 * バインドパラメータ上限（1文あたり 65,535）と、1文が長くなりすぎたときの
 * メモリ。Prisma は既定値の列も一緒に送るので1行あたり 6〜7 個ほど使うが、
 * 2,000行なら 15,000 弱で収まる。ここを1万行などに上げるときは、
 * 「行 × 列 < 65,535」を必ず先に確かめること。
 */
const BATCH_SIZE = 2000;

/**
 * 解析（全シート）＋ 行の一括書き込み ＋ 上書き時の入れ替えに与える上限（秒）。
 *
 * 宣言が無いと Vercel の既定（10〜15秒）で切られる。この取り込みは
 * all-or-nothing で巻き戻すので、途中で切られると「時間をかけた末に何も
 * 起きずに失敗した」になり、利用者には何が悪かったのかも残らない。
 *
 * 60 なのは、Vercel Pro は最大800秒まで伸ばせるが、Hobby も、他の
 * ホスティングも通る値がここだからで、cron の2本（/api/cron/alerts,
 * /api/reports/dispatch）と Notion 取り込みも同じ 60 でそろえてある。
 * 上限に張り付くようなら、まず createMany のバッチではなく行数上限
 * （MAX_IMPORT_ROWS）と、そもそも同期で取り込む設計の方を見直すこと。
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
  /**
   * 作成に使う slug。上書きするシートでは**仮の slug**（`…-tmp`）になる。
   * 本来の slug は既存のシートがまだ握っているため、入れ替えが済むまで使えない。
   */
  slug: string;
  fields: FinalField[];
  rows: Record<string, unknown>[];
  sheetName: string;
  truncated: boolean;
  /** パーサが申告した打ち切り警告（行・列）。日本語のまま利用者に見せる。 */
  warnings: string[];
  /** 置き換える既存シート。null なら新規追加。 */
  replaces: { id: string; slug: string; position: number } | null;
}

export const POST = withAuth(async (req, { user }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(
      "ファイルを読み取れませんでした。もう一度アップロードしてください。",
      400,
    );
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
    // 断るだけでは利用者は次の一手を選べない。何MBだったのかと、手元で
    // できる減らし方をその場で書く（上限を 4MB に下げたぶん、ここに来る人が
    // 増える。詳しい理由は MAX_IMPORT_BYTES のコメントを参照）。
    throw new ApiError(
      `ファイルサイズが上限（${MAX_LABEL}）を超えています（このファイルは約${(file.size / (1024 * 1024)).toFixed(1)}MB）。シートを分けて取り込むか、不要な列や行を削ってから、もう一度お試しください。`,
      413,
    );
  }

  // Resolve which sheets to import.
  let selections: SheetSelection[] = [];
  const sheetsRaw = form.get("sheets");
  if (typeof sheetsRaw === "string" && sheetsRaw.trim()) {
    try {
      const parsed = JSON.parse(sheetsRaw);
      if (Array.isArray(parsed)) {
        selections = parsed
          .filter(
            (s) =>
              s && typeof s === "object" && typeof s.sheetName === "string",
          )
          .map((s) => ({
            sheetName: s.sheetName,
            collectionName:
              typeof s.collectionName === "string"
                ? s.collectionName
                : undefined,
            fields: s.fields,
          }));
      }
    } catch {
      throw new ApiError(
        "取り込むシートの指定が正しくありません。画面をもう一度読み込んでお試しください。",
        400,
      );
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

  /*
   * 上書きするか、別のファイルとして足すか。
   *
   * 毎月同じ台帳を入れ直すのが普通の使い方なので、既定は上書き…にはしない。
   * 指定が無いときは従来どおり「追加」にしておく（API を直接叩いている
   * 呼び出し元の意味を、こちらの都合で変えてしまわないため）。画面からは
   * 必ず明示的に送る。
   */
  const modeRaw = form.get("mode");
  const mode = modeRaw === "replace" ? "replace" : "add";
  const workbookIdRaw = form.get("workbookId");

  const target =
    mode === "replace"
      ? await db.workbook.findFirst({
          where: {
            workspaceId: user.workspace.id,
            ...(typeof workbookIdRaw === "string" && workbookIdRaw
              ? { id: workbookIdRaw }
              : { name: fileBase }),
          },
          orderBy: { createdAt: "desc" },
          include: {
            collections: {
              orderBy: { position: "asc" },
              select: { id: true, name: true, slug: true, position: true },
            },
          },
        })
      : null;

  /*
   * ファイル数の上限。
   *
   * 上書き（replace）は新しいブックを作らないので数えない——毎月同じ台帳を
   * 入れ直す使い方が、上限に当たって止まってしまう。「増える」ときだけ止める。
   */
  if (!target) {
    await assertCanCreateWorkbook(user);
  }

  // 同じ既存シートを2つの取り込みシートが取り合わないようにする。
  const claimed = new Set<string>();

  const jobs: PreparedJob[] = [];
  for (const sel of selections) {
    const parsed = readSheet(buffer, sel.sheetName || undefined);
    const { sheetName, headers, rows, sampleByHeader } = parsed;
    if (headers.length === 0) continue; // skip empty tabs silently
    if (plansEnforced && rows.length > limitOf(plan.id, "recordsPerCollection")) {
      throw new ApiError(
        `シート「${sheetName}」の行数がプラン「${plan.name}」の上限（${limitOf(plan.id, "recordsPerCollection").toLocaleString()}）を超えます。`,
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
    /*
     * 上書き先を探す。突き合わせは「利用者が付けた名前」→「Excelのタブ名」の順。
     * 画面でシート名を変えていても、タブ名が同じなら同じシートの更新として扱う。
     */
    const replaces =
      target?.collections.find(
        (c) => !claimed.has(c.id) && c.name === collectionName,
      ) ??
      target?.collections.find(
        (c) => !claimed.has(c.id) && c.name === sheetName,
      ) ??
      null;
    if (replaces) claimed.add(replaces.id);

    /*
     * 上書きするシートは、まず**仮の slug** で作る。
     *
     * 本来の slug は既存のシートがまだ握っているので、先に消してから作ると
     * 「新しい方の作成に失敗したときに、古い方も消えている」という最悪の結果に
     * なる。新しい中身を全部作り終えてから、最後に入れ替える。
     */
    const slug = replaces
      ? uniqueName(`${replaces.slug}-tmp`, takenSlugs)
      : uniqueName(slugify(collectionName), takenSlugs);
    takenSlugs.add(slug);
    jobs.push({
      collectionName,
      slug,
      fields,
      rows,
      sheetName,
      truncated: parsed.truncated,
      warnings,
      replaces,
    });
  }

  if (jobs.length === 0) {
    throw new ApiError("取り込めるシートがありませんでした", 422);
  }

  // 上限は「実際に増えるシートの数」で判定する。選択された数で数えると、
  // 空タブを含むファイルで、実際には収まるのに 403 になってしまう。上書きは
  // 差し引きゼロなので数えない（入れ替えの一瞬だけ1枚多くなるが、同じ要求の
  // 中で必ず解消する）。まだ何も書いていないので、ここで弾いても副作用は無い。
  assertWithinCollectionLimit(
    plan,
    existing,
    jobs.filter((j) => !j.replaces).length,
  );

  // --- Group all sheets under one Workbook (the file) ---
  /*
   * 上書きなら既存のファイルをそのまま使う。追加のときは、同じ名前が既に
   * あれば「(2)」を付けて区別できるようにする——サイドバーに同じ名前が2つ
   * 並ぶと、どちらが今入れたものか分からなくなる。
   */
  const sameName = await db.workbook.count({
    where: { workspaceId: user.workspace.id, name: fileBase },
  });
  const workbook =
    target ??
    (await db.workbook.create({
      data: {
        workspaceId: user.workspace.id,
        name: sameName > 0 ? `${fileBase} (${sameName + 1})` : fileBase,
        source: ext === ".csv" ? "csv" : "excel",
      },
    }));

  // --- Create each collection + its records; roll back all on any failure ---
  const created: Array<{
    id: string;
    name: string;
    imported: number;
    skipped: number;
    /** 既存シートを置き換えたか（false なら新規追加）。 */
    replaced: boolean;
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
       * 行の書き込み。1バッチ＝1文（createMany）。
       *
       * id は渡さない。Record.id は cuid の既定値なので、Prisma 側で採番させる
       * （こちらで振ると SQLite と PostgreSQL で採番の癖が分かれる）。
       *
       * トランザクションで囲まないのは、ここで落ちたときの後始末を下の catch が
       * 引き受けているため。`createdIds` に積んだ Collection ごと削除すれば、
       * 何行書けていようと Record は cascade で消える——巻き戻しの単位は
       * 「バッチ」ではなく「このリクエストが作った Collection 全部」で、
       * それは createMany に変えても変わらない。
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
        replaced: job.replaces !== null,
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
    // 上書き先として既にあったファイルは、こちらが作ったものではない。
    // 失敗したからといって消してはいけない（中の既存シートごと消える）。
    if (leftover === null && target === null) {
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
        err instanceof ApiError
          ? err.message
          : "インポート中にエラーが発生しました";
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

  /*
   * 入れ替え。ここまで来た時点で、新しい中身は全部そろっている。
   *
   * **この処理は上のロールバックの外に置くこと。** 中に入れると、3枚目の
   * 入れ替えで落ちたときに「巻き戻し」が1〜2枚目の新しいシートまで消してしまう
   * ——古い方は既に消えているので、そのシートは丸ごと失われる。ここまで来たら
   * 巻き戻さない方が安全で、最悪でも「古い中身のまま」か「仮名のシートが残る」
   * で済む。
   *
   * 古いシートを消してから新しい slug を名乗るまでは1つのトランザクションに
   * 入れる。分けると、消した直後に落ちたときに、その slug を誰も持たない
   * （ダッシュボードから見てリンク切れの）状態が残る。
   *
   * 通知ルールは Collection への外部キーではなく id を持っているだけなので、
   * 消す前にこちらで新しい id へ付け替える。放っておくと、存在しないシートを
   * 見張り続ける壊れたルールになる。
   */
  const swapFailed: string[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (!job.replaces) continue;
    const newId = created[i].id;
    try {
      await db.$transaction([
        db.alertRule.updateMany({
          where: {
            workspaceId: user.workspace.id,
            collectionId: job.replaces.id,
          },
          data: { collectionId: newId },
        }),
        db.collection.delete({ where: { id: job.replaces.id } }),
        db.collection.update({
          where: { id: newId },
          data: { slug: job.replaces.slug, position: job.replaces.position },
        }),
      ]);
    } catch (swapErr) {
      console.error(
        `Import replace: could not swap collection ${job.replaces.id} -> ${newId}`,
        swapErr,
      );
      swapFailed.push(job.collectionName);
    }
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
      replaced: c.replaced,
    });
  }

  const replacedCount = created.filter((c) => c.replaced).length;
  // 上書きしたが、今回のファイルに入っていなかった既存シート。勝手に消すことは
  // しない（利用者が別の用途で使っているかもしれない）が、黙っていると
  // 「古い数字が混ざったまま」に気づけないので必ず知らせる。
  const untouched = (target?.collections ?? [])
    .filter((c) => !claimed.has(c.id))
    .map((c) => c.name);

  const totalRows = created.reduce((a, c) => a + c.imported, 0);
  const totalSkipped = created.reduce((a, c) => a + c.skipped, 0);
  /*
   * 「知らせるだけ」と「止めて読ませる」を分ける。
   *
   * 行が落ちた・列の型に合わなかった、は数字が変わる話なので、グラフに進む前に
   * 必ず読ませる。一方「今回入っていなかったシートは残した」は、何も失われて
   * いない事実の共有でしかない。これで毎回グラフへの導線を止めると、上書きの
   * たびに寄り道させることになる。
   */
  const notice =
    untouched.length > 0
      ? `今回のファイルに無かったシートは、そのまま残しています: ${untouched.join("、")}。古い数字が混ざって見えないかご確認ください。`
      : null;

  // 画面から離れても後で確認できるように、受信箱にも残す。
  if (notice) {
    await createNotification(user.workspace.id, {
      type: "system",
      title: `${workbook.name} を上書きしました`,
      body: notice,
      url: `/f/${workbook.id}`,
    });
  }

  const warning = buildWarning(
    [
      ...jobs.flatMap((j) => j.warnings),
      ...(swapFailed.length > 0
        ? [
            `${swapFailed.join("、")} は新しい内容で取り込めましたが、古いシートとの入れ替えに失敗しました。「${swapFailed[0]}」で始まる仮のシートが残っているので、内容を確認して不要な方を削除してください。`,
          ]
        : []),
    ],
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
    /** 既存シートを置き換えた枚数。0 なら全部が新規。 */
    sheetsReplaced: replacedCount,
    mode,
    imported: totalRows,
    skipped: totalSkipped,
    truncated,
    // UIはこの文言をそのまま表示する。null なら注意すべきことは無い。
    warning,
    /** 進行は止めずに知らせるだけの文言（上書きで残したシートなど）。 */
    notice,
  });
});
