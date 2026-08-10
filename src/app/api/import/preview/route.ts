/**
 * Import preview endpoint.
 * POST multipart/form-data with a single `file` field (.xlsx/.xls/.csv).
 *
 * Parses EVERY sheet in the workbook and infers a candidate field schema for
 * each WITHOUT writing anything to the database — this powers the mapping /
 * sheet-selection step of the import wizard (multi-tab support).
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { readAllSheets, MAX_IMPORT_BYTES } from "@/lib/excel";

const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];
const MAX_LABEL = "15MB";

export const POST = withAuth(async (req) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError("multipart/form-data の解析に失敗しました", 400);
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
    throw new ApiError(`ファイルサイズが上限（${MAX_LABEL}）を超えています`, 413);
  }

  const buffer = await file.arrayBuffer();
  const sheets = readAllSheets(buffer);
  const usable = sheets.filter((s) => !s.empty);

  if (usable.length === 0) {
    throw new ApiError("シートから列を検出できませんでした", 422);
  }

  return ok({
    fileName: name,
    sheetCount: usable.length,
    sheets: usable,
  });
});
