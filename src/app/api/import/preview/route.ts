/**
 * Import preview endpoint.
 * POST multipart/form-data with a single `file` field (.xlsx/.xls/.csv).
 *
 * Parses EVERY sheet in the workbook and infers a candidate field schema for
 * each WITHOUT writing anything to the database — this powers the mapping /
 * sheet-selection step of the import wizard (multi-tab support).
 *
 * 併せて `existing`（同じ名前で既に入っているファイル）も返す。形は
 * /api/import/analyze と同じ（src/lib/import-mode.ts の ExistingWorkbook）。
 * これが無かったあいだ、/import の画面は同名を置き換えられず、同じ台帳を
 * 毎月入れる人のファイルが増え続けていた。
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { readAllSheets, MAX_IMPORT_BYTES } from "@/lib/excel";
import { findExistingWorkbook } from "@/lib/existing-workbook";
import { workbookBaseName } from "@/lib/import-mode";

const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];
/** 利用者に見せる上限の表記。MAX_IMPORT_BYTES と必ず一致させること。 */
const MAX_LABEL = "4MB";

/**
 * ブックの全シートを解析するだけだが、書き込みが無いぶん解析そのものが
 * この関数の実行時間になる（結合セルの多い .xlsx は展開後の行列が大きい）。
 * 宣言が無いと Vercel の既定（10〜15秒）で切られ、取り込みの入口である
 * この画面で「読み込み中のまま失敗」になる。
 *
 * 60 は Vercel Pro の最大（800秒）ではなく、Hobby でも他のホスティングでも
 * 通る値。/api/import と同じ値でそろえてある。
 */
export const maxDuration = 60;

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

  const name = file.name ?? "";
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    throw new ApiError("対応形式は .xlsx / .xls / .csv です", 415);
  }
  if (file.size > MAX_IMPORT_BYTES) {
    // 断るだけでは次の一手が分からない。何MBだったのかと、手元でできる
    // 減らし方をその場で書く（上限の根拠は MAX_IMPORT_BYTES のコメント）。
    throw new ApiError(
      `ファイルサイズが上限（${MAX_LABEL}）を超えています（このファイルは約${(file.size / (1024 * 1024)).toFixed(1)}MB）。シートを分けて取り込むか、不要な列や行を削ってから、もう一度お試しください。`,
      413,
    );
  }

  const buffer = await file.arrayBuffer();
  const sheets = readAllSheets(buffer);
  const usable = sheets.filter((s) => !s.empty);

  if (usable.length === 0) {
    throw new ApiError("シートから列を検出できませんでした", 422);
  }

  /*
   * 同じ名前のファイルが既に入っていないかを見る。
   *
   * ここが無かったせいで、/import の画面は同名を知らず**常に新規追加**して
   * いた。毎月同じ「売上台帳」を入れ直す人のファイルが積み上がり、どれが最新か
   * 分からなくなる。ホームのドロップゾーン（/api/import/analyze）は最初から
   * 返していたので、同じ形・同じヘルパでそろえた。
   *
   * ここでは判定材料を返すだけで、上書きするかどうかは利用者が選ぶ
   * （画面が /api/import へ mode を送る）。
   * ワークスペースの絞りはヘルパ側の必須引数。他社のブック名が
   * 「同名のファイルがあります」の形で漏れないようにするため。
   */
  const existing = await findExistingWorkbook(user.workspace.id, name);

  return ok({
    fileName: name,
    // 取り込み後に付くブック名。画面が「何を置き換えるのか」を出すのに使う。
    fileBase: workbookBaseName(name),
    sheetCount: usable.length,
    sheets: usable,
    existing,
  });
});
