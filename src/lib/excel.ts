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
 *
 * 例外は「文字コードを判定できなかったファイル」だけ。文字化けした列名を
 * そのまま取り込むと利用者は原因に辿り着けないため、ここだけは ApiError で
 * 止めて、日本語で対処方法を伝える（decodeDelimitedText を参照）。
 */
import * as XLSX from "xlsx";
import { ApiError } from "@/lib/errors";
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
 *
 * 上限に当たった場合は必ず戻り値の `truncated` で申告する（silent truncation
 * は禁止 — 20万行の売上台帳が黙って5万行になり、呼び出し側が「成功」としか
 * 言えなかったのが元のバグ）。
 */
export const MAX_IMPORT_ROWS = 50000;

/**
 * Hard ceiling on columns parsed from any single sheet.
 *
 * 罫線や書式を「列全体」に適用したブックは `!ref` が A1:XFD200 のように
 * 膨らむ。以前はこの範囲をそのまま列数にしていたため、2列のシートから
 * 16,384 個の見出し（＝16,384 個の Field）が作られ、1シートの解析に1.8秒
 * かかっていた。値が入っている列だけを使い、さらにこの上限で頭打ちにする。
 */
export const MAX_IMPORT_COLUMNS = 256;

/** Max upload size for a spreadsheet import (raised from 5MB). */
export const MAX_IMPORT_BYTES = 15 * 1024 * 1024; // 15MB

/** ヘッダー行を探すときに見る先頭行数（タイトル行・空行の読み飛ばし用）。 */
const HEADER_SCAN_ROWS = 10;

// ---------------------------------------------------------------------------
// 文字コード判定（CSV/TSV）
// ---------------------------------------------------------------------------

/** 判定できた文字コード。UI/ログ向けにそのまま出せる名前にしてある。 */
export type DetectedEncoding = "utf-8" | "utf-16le" | "utf-16be" | "shift_jis";

/**
 * Shift_JIS(CP932) デコーダ。Node は full-icu ビルドなら "shift_jis" ラベルを
 * サポートする（WHATWG の shift_jis インデックスは Windows-31J＝CP932 相当で、
 * Excel の「CSV (カンマ区切り)」が書き出すものと一致する）。
 *
 * small-icu ビルドでは生成に失敗する。その場合に UTF-8 で読み直すと文字化けを
 * 黙って通してしまうので、フォールバックせず null を返し、呼び出し側が
 * 「UTF-8 で保存し直してください」と案内できるようにする。
 */
function shiftJisDecoder(): TextDecoder | null {
  try {
    return new TextDecoder("shift_jis", { fatal: true });
  } catch {
    return null;
  }
}

/** BOM 無しの UTF-16 を NUL バイトの偏りから推定する（無ければ null）。 */
function sniffBomlessUtf16(data: Uint8Array): "utf-16le" | "utf-16be" | null {
  // UTF-8 にも CP932 にも NUL は現れない。ASCII 主体の UTF-16 は必ず片側の
  // バイトが NUL になるので、その偏りだけで判別できる。
  const scan = Math.min(data.length, 512);
  if (scan < 4) return null;
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < scan; i++) {
    if (data[i] !== 0x00) continue;
    if (i % 2 === 0) evenNul++;
    else oddNul++;
  }
  const total = evenNul + oddNul;
  if (total < scan * 0.2) return null;
  if (oddNul > evenNul * 3) return "utf-16le"; // 上位バイト（奇数位置）が NUL
  if (evenNul > oddNul * 3) return "utf-16be";
  return null;
}

/** 先頭の BOM 文字（U+FEFF）を落とす。デコード後に一度だけ行う。 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * CSV/TSV のバイト列を文字列に直す。判定順は次の理由でこの並びに固定している。
 *
 * 1. BOM — ゼロコストで decisive。UTF-8 BOM 付きは Excel の「CSV UTF-8」、
 *    UTF-16LE BOM は Excel の「Unicode テキスト」が書き出す形。
 * 2. BOM 無し UTF-16 — NUL バイトは他の候補には現れないので誤判定しにくい。
 * 3. UTF-8 の厳密検証（fatal） — 安く、かつ decisive。CP932 の日本語は
 *    ほぼ確実に UTF-8 として不正になる（0x93 のような先頭バイトは UTF-8 の
 *    継続バイト域に当たる）。
 * 4. CP932(Shift_JIS) — 最後に試すのが重要。CP932 デコーダは UTF-8 の
 *    バイト列も「読めてしまう」（E6 97 が有効な2バイト文字になる等）ため、
 *    先に試すと UTF-8 ファイルを黙って文字化けさせる。逆順は成立しない。
 *
 * どれでも確信を持って読めなかったファイルは、文字化けした列名を作らずに
 * ApiError で止める。
 */
export function decodeDelimitedText(data: Uint8Array): {
  text: string;
  encoding: DetectedEncoding;
} {
  if (data.length === 0) return { text: "", encoding: "utf-8" };

  // 1. BOM
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return {
      text: stripBom(new TextDecoder("utf-8").decode(data.subarray(3))),
      encoding: "utf-8",
    };
  }
  if (data[0] === 0xff && data[1] === 0xfe) {
    return {
      text: stripBom(new TextDecoder("utf-16le").decode(data.subarray(2))),
      encoding: "utf-16le",
    };
  }
  if (data[0] === 0xfe && data[1] === 0xff) {
    return {
      text: stripBom(new TextDecoder("utf-16be").decode(data.subarray(2))),
      encoding: "utf-16be",
    };
  }

  // 2. BOM 無し UTF-16
  const utf16 = sniffBomlessUtf16(data);
  if (utf16) {
    return { text: stripBom(new TextDecoder(utf16).decode(data)), encoding: utf16 };
  }

  // 3. UTF-8（厳密）
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    return { text: stripBom(text), encoding: "utf-8" };
  } catch {
    // UTF-8 ではない → CP932 を試す
  }

  // 4. CP932 / Shift_JIS
  const sjis = shiftJisDecoder();
  if (!sjis) {
    throw new ApiError(
      "このファイルの文字コード（Shift_JIS と思われます）を、現在の実行環境では読み取れません。Excel で「名前を付けて保存」→「CSV UTF-8 (コンマ区切り)」を選んで保存し直してから、もう一度アップロードしてください。",
      422,
    );
  }
  try {
    return { text: stripBom(sjis.decode(data)), encoding: "shift_jis" };
  } catch {
    throw new ApiError(
      "ファイルの文字コードを判別できませんでした（UTF-8 / Shift_JIS のいずれとしても読み取れません）。Excel で「名前を付けて保存」→「CSV UTF-8 (コンマ区切り)」を選んで保存し直すか、.xlsx 形式で保存してからアップロードしてください。",
      422,
    );
  }
}

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

  // +2 = ヘッダー行 + maxRows 行の予算 + 打ち切り検知用の1行。最後の1行が
  // 読めたかどうかで「上限を超える行がまだあった」ことを判定する（CSV は
  // `!fullref` を持たないため、この余分な1行が唯一の確実な手掛かり）。
  const sheetRows = maxRows + 2;

  if (!isZip && !isOle) {
    // CSV/TSV: バイト列の文字コードを自前で判定してから文字列として読ませる。
    // SheetJS の array リーダーに渡すと UTF-8 のバイト列を CP1252 と解釈して
    // 日本語が文字化けする（日付 → æ¥ä»˜）。
    //
    // 【回帰防止】以前はここで無条件に UTF-8 デコードしていたため、Excel が
    // 日本語 Windows で書き出す CP932 の CSV（93 FA 95 74 … ＝「日付」）が
    // 「��t」のような文字列になり、そのまま列名・フィールドキーに
    // 化けて 200 で取り込まれていた。
    const { text } = decodeDelimitedText(data);
    return XLSX.read(text, {
      type: "string",
      /*
       * 【回帰防止】CSV はセルを解釈させず、書かれたままの文字列で受け取る。
       *
       * SheetJS の CSV パスは日付文字列を JS の `new Date(...)` に渡すため、
       * 仕様どおり「日付のみ」は UTC、「日付＋時刻」はローカルとして解釈される。
       * JST では 2024-04-01 が UTC 0時＝ローカル 9時になり、取り込み結果が
       * "2024-04-01 09:00:00" に化けていた（日本の実務CSVで最も多い形が壊れる）。
       * しかも Date になった時点で "2024-04-01" と "2024-04-01 09:00:00" は
       * 同じ値になり、後段では区別できない。
       *
       * `cellDates: false` にすると今度は日付シリアル＋既定書式に落ちて
       * "4/1/24" が復活するので、`raw` で文字列のまま止めるのが唯一の正解。
       * カレンダー上の日付にタイムゾーンは無い。正規化は coerceValue に任せる。
       */
      raw: true,
      sheetRows,
    });
  }

  return XLSX.read(data, {
    type: "array",
    cellDates: true,
    sheetRows,
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

/** 2桁ゼロ埋め。 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 日付セルを曖昧さの無い正規形にする。
 *
 * 【回帰防止】以前は `sheet_to_json(..., { raw: false })` の整形済みテキストを
 * そのまま使っていた。SheetJS の既定書式は `m/d/yy` なので、受注日 2026/04/01 が
 * 文字列 "4/1/26" になって DB に入っていた（年が切れ、月日が米国順、
 * ソートも集計もできず、日本語UIに外国式で表示される）。
 *
 * SheetJS の Date は「ローカル時刻の0時」で作られるため、`toISOString()` を
 * 使うと JST では前日にずれる。年月日はローカル値から直接組み立てる。
 * 時刻を持つセルだけ "YYYY-MM-DD HH:mm:ss" にして情報を落とさない。
 */
function canonicalDate(d: Date): string {
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  if (h === 0 && m === 0 && s === 0) return date;
  return `${date} ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/**
 * 1セルを取り込み用の値にする。日付セルだけは書式に依らず正規化し、それ以外は
 * 従来どおり表示書式（`raw:false` 相当）を使う。
 */
/**
 * 日付「らしい」テキストを YYYY-MM-DD（時刻があれば + HH:mm:ss）に揃える。
 *
 * CSV は `raw: true` で読むので、セルは書かれたままの文字列で届く。ここで
 * 文字列のまま整えることで、`2026/04/01` も `2026.4.1` も同じ正規形になり、
 * Date を経由しないのでタイムゾーンによるずれが原理的に起きない。
 *
 * 判定は完全一致のみ。「2024-01-01〜2024-03-31」のような文章や、日付を含む
 * ただのテキストには触れない。
 */
function normalizeDateText(s: string): string | null {
  const m = s.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!m) return null;

  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  const date = `${y}-${pad2(mo)}-${pad2(d)}`;
  if (m[4] === undefined) return date;

  const [h, mi, sec] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (h > 23 || mi > 59 || sec > 59) return null;
  if (h === 0 && mi === 0 && sec === 0) return date;
  return `${date} ${pad2(h)}:${pad2(mi)}:${pad2(sec)}`;
}

function cellValue(cell: XLSX.CellObject | undefined): unknown {
  if (!cell || cell.t === "z") return null;
  if (cell.v === undefined || cell.v === null) return null;
  if (cell.v instanceof Date) return canonicalDate(cell.v);
  // CSV（raw 読み）の文字列セル。日付表記だけ正規形に揃える。
  if (typeof cell.v === "string") {
    const trimmed = cell.v.trim();
    if (trimmed === "") return null;
    return normalizeDateText(trimmed) ?? trimmed;
  }
  const formatted = XLSX.utils.format_cell(cell);
  return formatted === "" ? null : formatted;
}

/** 値が入っているセルの右下端。`!ref` が膨らんでいても実データだけを見る。 */
function usedBounds(ws: XLSX.WorkSheet): { endRow: number; endCol: number } | null {
  let endRow = -1;
  let endCol = -1;
  for (const key of Object.keys(ws)) {
    if (key.charCodeAt(0) === 0x21) continue; // "!ref" 等のメタキー
    const cell = ws[key] as XLSX.CellObject | undefined;
    if (!cell || cell.t === "z") continue;
    if (cell.v === undefined || cell.v === null) continue;
    if (typeof cell.v === "string" && cell.v.trim() === "") continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r > endRow) endRow = r;
    if (c > endCol) endCol = c;
  }
  return endRow < 0 ? null : { endRow, endCol };
}

/**
 * 1行ぶんのセルを配列にする。列名（A, B, ...）は行ごとに作り直さず、
 * 呼び出し側で1度だけ組み立てたものを使い回す（5万行×列数ぶんの文字列生成を
 * 避けるため）。
 */
function readRow(
  ws: XLSX.WorkSheet,
  r: number,
  colNames: string[],
): unknown[] {
  const rowNumber = String(r + 1);
  const row: unknown[] = new Array(colNames.length);
  for (let i = 0; i < colNames.length; i++) {
    row[i] = cellValue(ws[colNames[i] + rowNumber] as XLSX.CellObject | undefined);
  }
  return row;
}

/**
 * ヘッダーらしい行を選ぶ。
 *
 * 先頭の非空行を無条件にヘッダーにすると、「2026年度 売上表」のようなタイトル行が
 * ヘッダーになり、本物の見出し行がデータとして取り込まれてしまう。先頭
 * HEADER_SCAN_ROWS 行のうち「埋まっているセル数」が最大値の6割以上ある最初の行を
 * 採用する（タイトル行は1セルしか埋まらないので自然に外れ、ヘッダーの一部が
 * 空欄でも本物のヘッダーが残る）。選んだ行は `headerRowIndex` で必ず外に出し、
 * UI が「N行目を見出しとして認識」と表示・訂正できるようにする。
 */
function detectHeaderRow(
  candidates: { index: number; filled: number }[],
): number {
  if (candidates.length === 0) return -1;
  const maxFilled = candidates.reduce((m, c) => Math.max(m, c.filled), 0);
  const threshold = Math.max(1, maxFilled * 0.6);
  const hit = candidates.find((c) => c.filled >= threshold);
  return (hit ?? candidates[0]).index;
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

/** 行・列の打ち切り状況。呼び出し側は必ず利用者に伝えること。 */
export interface SheetLimitInfo {
  /** 行数上限に当たり、末尾の行を捨てたか。 */
  truncated: boolean;
  /** この読み取りに適用した実効の行上限。 */
  rowLimit: number;
  /** 列数上限に当たり、右端の列を捨てたか。 */
  columnsTruncated: boolean;
  /** 切り捨て前に値が入っていた列数。 */
  totalColumns: number;
  /** この読み取りに適用した列上限。 */
  columnLimit: number;
}

export interface ReadSheetResult extends SheetLimitInfo {
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
  /** Per-header column of non-empty sample values, for type inference. */
  sampleByHeader: Record<string, unknown[]>;
  /** 見出しとして採用したシート上の行番号（0始まり）。無ければ -1。 */
  headerRowIndex: number;
}

const MAX_SAMPLES = 50;

function emptyResult(
  sheetName: string,
  rowLimit: number,
): ReadSheetResult {
  return {
    sheetName,
    headers: [],
    rows: [],
    sampleByHeader: {},
    headerRowIndex: -1,
    truncated: false,
    rowLimit,
    columnsTruncated: false,
    totalColumns: 0,
    columnLimit: MAX_IMPORT_COLUMNS,
  };
}

/**
 * 打ち切りを利用者向けの日本語にする。切り捨てが無ければ空配列。
 * 呼び出し側はこの文字列をAPIレスポンス（警告付きの成功）に載せる。
 */
export function sheetWarnings(info: SheetLimitInfo & { sheetName?: string }): string[] {
  const out: string[] = [];
  const label = info.sheetName ? `シート「${info.sheetName}」の` : "";
  if (info.truncated) {
    out.push(
      `${label}行数が1回の取り込みの上限（${info.rowLimit.toLocaleString()}行）を超えたため、先頭${info.rowLimit.toLocaleString()}行のみ取り込みました。残りの行は取り込まれていません。`,
    );
  }
  if (info.columnsTruncated) {
    out.push(
      `${label}列数が上限（${info.columnLimit.toLocaleString()}列）を超えたため、左から${info.columnLimit.toLocaleString()}列のみ取り込みました（元の列数: ${info.totalColumns.toLocaleString()}）。`,
    );
  }
  return out;
}

/**
 * Read a single sheet into a clean tabular shape.
 *
 * - Picks the requested sheet (by name) or the first sheet.
 * - 見出しらしい行を選ぶ（タイトル行は読み飛ばす / `headerRowIndex` で申告）。
 * - Blank-fills and de-duplicates header names so keys stay unique.
 * - Maps each remaining non-empty row to an object keyed by header.
 * - 行・列の上限に当たったら `truncated` / `columnsTruncated` で申告する。
 */
export function readSheet(
  buffer: ArrayBuffer | Buffer,
  sheetName?: string,
  maxRows: number = MAX_IMPORT_ROWS,
): ReadSheetResult {
  const wb = toWorkbook(buffer, maxRows);
  return readSheetFromWorkbook(wb, sheetName, maxRows);
}

/**
 * 既に読み込み済みのワークブックから1シートを取り出す。
 * `readAllSheets` が同じファイルを何度も `XLSX.read` しないための分割点。
 */
function readSheetFromWorkbook(
  wb: XLSX.WorkBook,
  sheetName: string | undefined,
  maxRows: number,
): ReadSheetResult {
  const names = wb.SheetNames ?? [];
  const chosen =
    sheetName && names.includes(sheetName) ? sheetName : names[0];

  if (!chosen) return emptyResult("", maxRows);

  const ws = wb.Sheets[chosen];
  if (!ws) return emptyResult(chosen, maxRows);

  const ref = typeof ws["!ref"] === "string" ? ws["!ref"] : null;
  const range = ref ? XLSX.utils.decode_range(ref) : null;
  const used = usedBounds(ws);
  if (!used) return emptyResult(chosen, maxRows);

  const startRow = range ? Math.max(0, range.s.r) : 0;
  const startCol = range ? Math.max(0, range.s.c) : 0;
  // `!ref` は書式だけの列まで含んで膨らむので、実際に値のある右下端で頭打ちにする。
  const lastRow = range ? Math.min(used.endRow, range.e.r) : used.endRow;
  const totalColumns = Math.max(0, used.endCol - startCol + 1);
  const columnsTruncated = totalColumns > MAX_IMPORT_COLUMNS;
  const lastCol = columnsTruncated
    ? startCol + MAX_IMPORT_COLUMNS - 1
    : used.endCol;

  if (lastRow < startRow || lastCol < startCol) {
    return { ...emptyResult(chosen, maxRows), totalColumns };
  }

  const colNames: string[] = [];
  for (let c = startCol; c <= lastCol; c++) colNames.push(XLSX.utils.encode_col(c));

  // --- ヘッダー行の決定（先頭 HEADER_SCAN_ROWS 行の非空行だけ見る） ---
  const scanned: { index: number; row: unknown[]; filled: number }[] = [];
  for (let r = startRow; r <= lastRow && scanned.length < HEADER_SCAN_ROWS; r++) {
    const row = readRow(ws, r, colNames);
    if (isEmptyRow(row)) continue;
    scanned.push({
      index: r,
      row,
      filled: row.filter((c) => cellToString(c) !== "").length,
    });
  }
  const headerRowIndex = detectHeaderRow(scanned);
  if (headerRowIndex === -1) {
    return { ...emptyResult(chosen, maxRows), totalColumns };
  }

  const rawHeaders =
    scanned.find((s) => s.index === headerRowIndex)?.row ?? [];
  // 幅は「値が入っている列の範囲」で決める。見出しセルが空でも下にデータが
  // あれば列として残す（列N の見出しを立てる）。末尾の完全に空の列は
  // usedBounds の時点で既に落ちている。
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

  let truncated = false;
  for (let r = headerRowIndex + 1; r <= lastRow; r++) {
    const rawRow = readRow(ws, r, colNames);
    if (isEmptyRow(rawRow)) continue;
    if (rows.length >= maxRows) {
      // 予算を超える「実データの行」が存在した ＝ 確実に打ち切っている。
      truncated = true;
      break;
    }

    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      const raw = rawRow[c];
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

  if (!truncated) {
    // .xlsx は sheetRows で切ると元の範囲が `!fullref` に残る（これが最も確実）。
    const fullref = (ws as unknown as Record<string, unknown>)["!fullref"];
    if (typeof fullref === "string") {
      try {
        if (XLSX.utils.decode_range(fullref).e.r > (range ? range.e.r : lastRow)) {
          truncated = true;
        }
      } catch {
        // 壊れた範囲文字列は無視（打ち切り判定は下の行数チェックに任せる）。
      }
    }
    // CSV には `!fullref` が無い。タイトル行などで予算が前倒しに消費された場合も
    // 拾えるよう、読み取り上限（maxRows + 2 行）いっぱいまで行があったかを見る。
    if (!truncated && lastRow - startRow + 1 >= maxRows + 2) truncated = true;
  }

  return {
    sheetName: chosen,
    headers,
    rows,
    sampleByHeader,
    headerRowIndex,
    truncated,
    rowLimit: maxRows,
    columnsTruncated,
    totalColumns,
    columnLimit: MAX_IMPORT_COLUMNS,
  };
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

export interface SheetParse extends SheetLimitInfo {
  sheetName: string;
  headers: string[];
  rowCount: number;
  inferredFields: InferredField[];
  previewRows: Record<string, unknown>[];
  /** True when the sheet has no detectable header/rows (skippable). */
  empty: boolean;
  /** Excel 上で非表示（または veryHidden）のシートか。既定選択から外す判断用。 */
  hidden: boolean;
  /** 見出しとして採用したシート上の行番号（0始まり）。無ければ -1。 */
  headerRowIndex: number;
  /** 打ち切りなどの日本語警告文（無ければ空配列）。 */
  warnings: string[];
  /** 結合セルの状況。人が作った表ほど見出しが結合されている。 */
  merges: MergeInfo;
}

/**
 * 結合セルの要約。
 *
 * 結合は「人間向けに整形された表」の一番強い手掛かりで、そのまま取り込むと
 * 静かに壊れる。結合された見出し（例: 上段に「2026年度」、下段に「上期/下期」）は
 * 片方のセルにしか値が無いため、列名が空欄になったり、意味が半分失われたりする。
 * 取り込む前に利用者へ知らせるための材料として、件数と位置だけを持つ。
 */
export interface MergeInfo {
  /** 結合範囲の総数。 */
  count: number;
  /** 見出しとして採用した行に掛かっている結合の数。 */
  inHeaderRow: number;
  /** 見出し行より上（表題や注記の可能性が高い領域）に掛かっている結合の数。 */
  aboveHeaderRow: number;
  /** 人が読める範囲表記の先頭いくつか（例 "A1:C1"）。 */
  examples: string[];
}

const MAX_MERGE_EXAMPLES = 5;

/** シートの結合セルを要約する。`!merges` が無いシートは全ゼロ。 */
function mergeInfo(ws: XLSX.WorkSheet, headerRowIndex: number): MergeInfo {
  const merges = (ws?.["!merges"] as XLSX.Range[] | undefined) ?? [];
  if (!Array.isArray(merges) || merges.length === 0) {
    return { count: 0, inHeaderRow: 0, aboveHeaderRow: 0, examples: [] };
  }

  let inHeaderRow = 0;
  let aboveHeaderRow = 0;
  const examples: string[] = [];
  for (const m of merges) {
    if (!m?.s || !m?.e) continue;
    if (headerRowIndex >= 0) {
      if (m.s.r <= headerRowIndex && m.e.r >= headerRowIndex) inHeaderRow += 1;
      else if (m.e.r < headerRowIndex) aboveHeaderRow += 1;
    }
    if (examples.length < MAX_MERGE_EXAMPLES) {
      examples.push(XLSX.utils.encode_range(m));
    }
  }
  return { count: merges.length, inHeaderRow, aboveHeaderRow, examples };
}

/** ワークブックのシート表示状態（0=表示 / 1=非表示 / 2=veryHidden）。 */
function hiddenSheetNames(wb: XLSX.WorkBook): Set<string> {
  const out = new Set<string>();
  const meta = wb.Workbook?.Sheets;
  if (!Array.isArray(meta)) return out;
  meta.forEach((s, i) => {
    if (!s) return;
    const name = typeof s.name === "string" ? s.name : wb.SheetNames?.[i];
    if (name && typeof s.Hidden === "number" && s.Hidden > 0) out.add(name);
  });
  return out;
}

/**
 * Parse EVERY sheet in a workbook into a preview-friendly shape. Powers
 * multi-tab import: each non-empty sheet becomes its own spreadsheet. Rows are
 * capped per sheet by `maxRows` (decompression-bomb / memory guard).
 *
 * ファイルの解析は1回だけ。以前は `parseWorkbook` ＋ シートごとの `readSheet` で
 * 同じバッファを N+1 回 `XLSX.read` していて、20タブのブックはプレビュー
 * エンドポイントだけで21回パースされていた。
 */
export function readAllSheets(
  buffer: ArrayBuffer | Buffer,
  maxRows: number = MAX_IMPORT_ROWS,
  previewCount = 8,
): SheetParse[] {
  const wb = toWorkbook(buffer, maxRows);
  const names = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
  const hidden = hiddenSheetNames(wb);

  const out: SheetParse[] = [];
  for (const name of names) {
    const parsed = readSheetFromWorkbook(wb, name, maxRows);
    const { sheetName, headers, rows, sampleByHeader } = parsed;
    const empty = headers.length === 0 || rows.length === 0;
    out.push({
      sheetName: sheetName || name,
      headers,
      rowCount: rows.length,
      inferredFields: empty ? [] : inferFields(headers, sampleByHeader),
      previewRows: rows.slice(0, previewCount),
      empty,
      hidden: hidden.has(name),
      headerRowIndex: parsed.headerRowIndex,
      truncated: parsed.truncated,
      rowLimit: parsed.rowLimit,
      columnsTruncated: parsed.columnsTruncated,
      totalColumns: parsed.totalColumns,
      columnLimit: parsed.columnLimit,
      warnings: sheetWarnings({ ...parsed, sheetName: sheetName || name }),
      merges: mergeInfo(wb.Sheets?.[name], parsed.headerRowIndex),
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
