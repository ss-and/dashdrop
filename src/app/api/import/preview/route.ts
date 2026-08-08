/**
 * Import preview endpoint.
 * POST multipart/form-data with a single `file` field (.xlsx/.xls/.csv).
 *
 * Reads the sheet and infers a candidate field schema WITHOUT writing anything
 * to the database — this powers the mapping step of the import wizard.
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { readSheet, inferFields } from "@/lib/excel";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];
const PREVIEW_ROWS = 10;

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
    throw new ApiError(
      "対応形式は .xlsx / .xls / .csv です",
      415,
    );
  }

  if (file.size > MAX_BYTES) {
    throw new ApiError("ファイルサイズが上限（5MB）を超えています", 413);
  }

  const buffer = await file.arrayBuffer();
  const { sheetName, headers, rows, sampleByHeader } = readSheet(buffer);

  if (headers.length === 0) {
    throw new ApiError("シートから列を検出できませんでした", 422);
  }

  const inferredFields = inferFields(headers, sampleByHeader);

  return ok({
    sheetName,
    headers,
    inferredFields,
    rowCount: rows.length,
    previewRows: rows.slice(0, PREVIEW_ROWS),
  });
});
