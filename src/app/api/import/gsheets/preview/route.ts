/**
 * Google Sheets import preview endpoint (no OAuth).
 * POST JSON: { url } — a public / link-shared Google Sheets URL.
 *
 * Derives the CSV export URL, fetches it publicly, then parses it with the SAME
 * engine as file uploads (`readAllSheets`) WITHOUT writing anything to the
 * database. Returns the same `{ sheets }` shape as /api/import/preview so the
 * import wizard can reuse its sheet-selection / mapping UI. A CSV export yields
 * exactly one sheet.
 */
import { withAuth, ok, ApiError, readJson } from "@/lib/api";
import { z } from "zod";
import { readAllSheets } from "@/lib/excel";
import { toCsvExportUrl, fetchSheetCsv } from "@/lib/gsheets";

const bodySchema = z.object({ url: z.string() });

export const POST = withAuth(async (req) => {
  const { url } = await readJson(req, bodySchema);

  const exportUrl = toCsvExportUrl(url);
  if (!exportUrl) {
    throw new ApiError("Google SheetsのURLを貼り付けてください。", 400);
  }

  const buffer = await fetchSheetCsv(exportUrl);
  const sheets = readAllSheets(buffer);
  const usable = sheets.filter((s) => !s.empty);

  if (usable.length === 0) {
    throw new ApiError("シートから列を検出できませんでした", 422);
  }

  return ok({
    sheetCount: usable.length,
    sheets: usable,
  });
});
