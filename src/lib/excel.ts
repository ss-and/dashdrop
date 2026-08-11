/**
 * Excel / CSV engine — the pure, db-free core of DashDrop's headline feature.
 *
 * Everything here is a pure function so it stays unit-testable: no Prisma, no
 * request context, no side effects. The import API routes read a file into a
 * buffer and hand it to `readSheet` / `inferFields`; the export route feeds a
 * collection's fields + records into `buildExportWorkbook`.
 *
 * The whole module is deliberately defensive: spreadsheets arrive malformed,
 * with blank header rows, duplicate column names, ragged rows, and stray typed
 * cells. We never throw on bad shape — we normalise and carry on.
 */
import * as XLSX from "xlsx";
import { toFieldKey, uniqueName } from "@/lib/utils";
import {
  inferFieldType,
  type FieldType,
} from "@/lib/field-types";

/**
 * Hard ceiling on rows parsed from any single sheet. `.xlsx` is zip-compressed
 * XML, so a small upload can inflate to an enormous matrix; `sheetRows` makes
 * the parser stop early instead of materialising the whole sheet into memory
 * (decompression-bomb / OOM guard). Includes the header row.
 */
export const MAX_IMPORT_ROWS = 50000;

/** Max upload size for a spreadsheet import (raised from 5MB). */
export const MAX_IMPORT_BYTES = 15 * 1024 * 1024; // 15MB

/** Coerce either input flavour into something XLSX.read can consume. */
function toWorkbook(
  buffer: ArrayBuffer | Buffer,
  maxRows: number = MAX_IMPORT_ROWS,
): XLSX.WorkBook {
  // Buffer is a Uint8Array subclass, so "array" reads both flavours safely.
  const data =
    buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;

  // Distinguish real spreadsheet binaries from delimited text (CSV/TSV) by
  // magic bytes: .xlsx/.xlsm are ZIP ("PK"), legacy .xls is an OLE compound
  // file (D0 CF 11 E0). Anything else is treated as text.
  const isZip = data[0] === 0x50 && data[1] === 0x4b;
  const isOle =
    data[0] === 0xd0 &&
    data[1] === 0xcf &&
    data[2] === 0x11 &&
    data[3] === 0xe0;

  if (!isZip && !isOle) {
    // CSV/TSV: decode the bytes as UTF-8 ourselves (stripping any BOM) and read
    // as a string. SheetJS's array reader would otherwise interpret raw UTF-8
    // bytes as CP1252, mojibake-ing Japanese (日付 → æ¥ä») — the common case
    // for exported spreadsheets and Google Sheets CSV.
    let text = new TextDecoder("utf-8").decode(data);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return XLSX.read(text, {
      type: "string",
      cellDates: true,
      sheetRows: maxRows + 1,
    });
  }

  // +1 so we still read the header row on top of the data-row budget.
  return XLSX.read(data, {
    type: "array",
    cellDates: true,
    sheetRows: maxRows + 1,
  });
}

/** Trim a cell to a clean string, treating null/undefined as empty. */
function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

/** True when every cell in a matrix row is empty/blank. */
function isEmptyRow(row: unknown[]): boolean {
  return !row || row.every((c) => cellToString(c) === "");
}

/** List the sheet names in a workbook (lightweight probe). */
export function parseWorkbook(buffer: ArrayBuffer | Buffer): {
  sheets: string[];
} {
  try {
    const wb = toWorkbook(buffer);
    return { sheets: Array.isArray(wb.SheetNames) ? wb.SheetNames : [] };
  } catch {
    return { sheets: [] };
  }
}

export interface ReadSheetResult {
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
  /** Per-header column of non-empty sample values, for type inference. */
  sampleByHeader: Record<string, unknown[]>;
}

const MAX_SAMPLES = 50;

/**
 * Read a single sheet into a clean tabular shape.
 *
 * - Picks the requested sheet (by name) or the first sheet.
 * - Treats the first non-empty row as the header row.
 * - Blank-fills and de-duplicates header names so keys stay unique.
 * - Maps each remaining non-empty row to an object keyed by header.
 */
export function readSheet(
  buffer: ArrayBuffer | Buffer,
  sheetName?: string,
  maxRows: number = MAX_IMPORT_ROWS,
): ReadSheetResult {
  const wb = toWorkbook(buffer, maxRows);
  const names = wb.SheetNames ?? [];
  const chosen =
    sheetName && names.includes(sheetName) ? sheetName : names[0];

  if (!chosen) {
    return { sheetName: "", headers: [], rows: [], sampleByHeader: {} };
  }

  const ws = wb.Sheets[chosen];
  if (!ws) {
    return { sheetName: chosen, headers: [], rows: [], sampleByHeader: {} };
  }

  // Raw matrix: header:1 gives arrays of cells; raw:false stringifies numbers
  // using their display formatting; defval:null keeps column alignment.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: false,
  });

  // Find the first non-empty row — that's the header row.
  let headerIndex = -1;
  for (let i = 0; i < matrix.length; i++) {
    if (!isEmptyRow(matrix[i])) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return { sheetName: chosen, headers: [], rows: [], sampleByHeader: {} };
  }

  const rawHeaders = matrix[headerIndex] ?? [];
  const width = rawHeaders.length;

  // Blank-fill + de-duplicate header names.
  const takenHeaders = new Set<string>();
  const headers: string[] = [];
  for (let c = 0; c < width; c++) {
    const label = cellToString(rawHeaders[c]) || `列${c + 1}`;
    const unique = uniqueName(label, takenHeaders);
    takenHeaders.add(unique);
    headers.push(unique);
  }

  const rows: Record<string, unknown>[] = [];
  const sampleByHeader: Record<string, unknown[]> = {};
  for (const h of headers) sampleByHeader[h] = [];

  for (let r = headerIndex + 1; r < matrix.length; r++) {
    const rawRow = matrix[r];
    if (isEmptyRow(rawRow)) continue;

    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      const raw = rawRow ? rawRow[c] : null;
      // Preserve typed values (Date, boolean, number) but trim loose strings.
      const value =
        typeof raw === "string" ? raw.trim() || null : raw ?? null;
      obj[header] = value;

      if (
        value !== null &&
        value !== undefined &&
        cellToString(value) !== "" &&
        sampleByHeader[header].length < MAX_SAMPLES
      ) {
        sampleByHeader[header].push(value);
      }
    }
    rows.push(obj);
  }

  return { sheetName: chosen, headers, rows, sampleByHeader };
}

export interface InferredField {
  name: string;
  key: string;
  type: FieldType;
}

/**
 * Build a candidate field schema from headers + their sample columns.
 * Keys are derived from the header label and kept unique within the set.
 */
export function inferFields(
  headers: string[],
  sampleByHeader: Record<string, unknown[]>,
): InferredField[] {
  const takenKeys = new Set<string>();
  return headers.map((name) => {
    const key = uniqueName(toFieldKey(name), takenKeys);
    takenKeys.add(key);
    const samples = sampleByHeader[name] ?? [];
    const type = inferFieldType(samples);
    return { name, key, type };
  });
}

export interface SheetParse {
  sheetName: string;
  headers: string[];
  rowCount: number;
  inferredFields: InferredField[];
  previewRows: Record<string, unknown>[];
  /** True when the sheet has no detectable header/rows (skippable). */
  empty: boolean;
}

/**
 * Parse EVERY sheet in a workbook into a preview-friendly shape. Powers
 * multi-tab import: each non-empty sheet becomes its own spreadsheet. Rows are
 * capped per sheet by `maxRows` (decompression-bomb / memory guard).
 */
export function readAllSheets(
  buffer: ArrayBuffer | Buffer,
  maxRows: number = MAX_IMPORT_ROWS,
  previewCount = 8,
): SheetParse[] {
  let names: string[] = [];
  try {
    names = parseWorkbook(buffer).sheets;
  } catch {
    names = [];
  }
  const out: SheetParse[] = [];
  for (const name of names) {
    const { sheetName, headers, rows, sampleByHeader } = readSheet(
      buffer,
      name,
      maxRows,
    );
    const empty = headers.length === 0 || rows.length === 0;
    out.push({
      sheetName: sheetName || name,
      headers,
      rowCount: rows.length,
      inferredFields: empty ? [] : inferFields(headers, sampleByHeader),
      previewRows: rows.slice(0, previewCount),
      empty,
    });
  }
  return out;
}

export interface ExportField {
  key: string;
  name: string;
  type: FieldType;
}

export interface ExportRecord {
  data: unknown;
}

/**
 * Render a single stored value into the raw form Excel should hold. Numbers
 * stay numeric so spreadsheet math works; checkboxes become booleans; dates
 * keep the canonical 'YYYY-MM-DD' string; multiselect collapses to a list.
 */
function exportCell(type: FieldType, value: unknown): unknown {
  if (value === null || value === undefined) return "";
  switch (type) {
    case "number":
    case "currency":
      return typeof value === "number" ? value : Number(value) || value;
    case "checkbox":
      return Boolean(value);
    case "multiselect":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "date":
      return String(value);
    default:
      return String(value);
  }
}

/** Sensible column widths (chars) from header + first rows of content. */
function columnWidths(
  fields: ExportField[],
  aoa: unknown[][],
): { wch: number }[] {
  return fields.map((f, i) => {
    let max = f.name.length;
    for (let r = 1; r < aoa.length && r < 200; r++) {
      const cell = aoa[r]?.[i];
      const len = cell === null || cell === undefined ? 0 : String(cell).length;
      if (len > max) max = len;
    }
    return { wch: Math.min(Math.max(max + 2, 8), 60) };
  });
}

/**
 * Assemble a downloadable .xlsx buffer for a collection. Header row uses the
 * human field names; each data row follows the field order.
 */
export function buildExportWorkbook(
  collectionName: string,
  fields: ExportField[],
  records: ExportRecord[],
): Buffer {
  const safeFields = Array.isArray(fields) ? fields : [];
  const header = safeFields.map((f) => f.name);

  const aoa: unknown[][] = [header];
  for (const rec of records ?? []) {
    const data =
      rec && typeof rec.data === "object" && rec.data !== null
        ? (rec.data as Record<string, unknown>)
        : {};
    aoa.push(safeFields.map((f) => exportCell(f.type, data[f.key])));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (safeFields.length) ws["!cols"] = columnWidths(safeFields, aoa);

  const wb = XLSX.utils.book_new();
  // Excel caps sheet names at 31 chars and forbids a handful of characters.
  const sheetName =
    (collectionName || "Sheet1").replace(/[\\/?*[\]:]/g, " ").slice(0, 31) ||
    "Sheet1";
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return out as Buffer;
}
