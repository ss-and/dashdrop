/**
 * 取り込み前の下見エンドポイント。
 * POST multipart/form-data（`file` 1つ、.xlsx/.xls/.csv）。
 *
 * ファイルを1回だけ解析し、
 *   - 全シートの構造（列・型の当たり・見出し行・結合セル・非表示）
 *   - 「どのシートを、どの項目名で入れるか」の提案
 *   - 人に確認したいこと（結合セル、見出し行のずれ、名前の無い列 …）
 * を返す。**データベースには何も書かない。**
 *
 * 提案は `advice`、その出どころは `via`（"anthropic" | "heuristic"）。
 * APIキーが無い環境でも必ず `advice` は返る（決定的なルールで組み立てる）ので、
 * 画面側は via を気にせず同じように描ける。
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { readAllSheets, MAX_IMPORT_BYTES } from "@/lib/excel";
import { adviseImport } from "@/lib/import-advisor";

const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];
const MAX_LABEL = "15MB";

export const POST = withAuth(async (req) => {
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

  const name = file.name ?? "";
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    throw new ApiError("対応形式は .xlsx / .xls / .csv です", 415);
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ApiError(
      `ファイルサイズが上限（${MAX_LABEL}）を超えています`,
      413,
    );
  }

  const buffer = await file.arrayBuffer();
  const sheets = readAllSheets(buffer);

  if (sheets.every((s) => s.empty)) {
    throw new ApiError("シートから列を検出できませんでした", 422);
  }

  const { advice, via } = await adviseImport(sheets);

  return ok({
    fileName: name,
    fileBase: name.replace(/\.[^.]+$/, "").trim(),
    sheets,
    advice,
    via,
  });
});
