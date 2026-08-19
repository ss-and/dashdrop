/**
 * Sheet joins — the pure core of the `vlookup` field type.
 *
 * 「シート結合（別ファイル同士をキーで突合）」: you import 売上.xlsx and
 * 顧客マスター.xlsx as two separate spreadsheets and want the customer's 業種
 * on every sales row, matched on 取引先名. That is Excel's VLOOKUP — and with
 * `aggregate: "sum" | "count"` it is SUMIF / COUNTIF too.
 *
 * This module holds everything that does NOT touch the database: key
 * normalisation, the O(n+m) index build, the match, the aggregation, and the
 * config validation. `src/lib/relations.ts` owns the Prisma side and calls in
 * here, which keeps the whole algorithm unit-testable without a database.
 *
 * Cycle safety: a vlookup reads the target sheet's STORED values only. It
 * never triggers resolution of the target's own computed columns, so an
 * A→B→A chain is impossible. Configuring a computed column as the key or as
 * the pulled column is rejected in validation (see `validateVlookupConfig`).
 */
import { ApiError } from "./errors";
import { FIELD_TYPE_META, displayValue, isComputedField, isFieldType, type FieldType } from "./field-types";
import { foldWidthVariants, sanitize, toNumber } from "./formula";

/** How several matching target rows are combined into one cell value. */
export const VLOOKUP_AGGREGATES = [
  "first",
  "sum",
  "avg",
  "count",
  "min",
  "max",
  "concat",
] as const;
export type VlookupAggregate = (typeof VLOOKUP_AGGREGATES)[number];

/** Japanese labels for the aggregate picker (FieldEditor). */
export const VLOOKUP_AGGREGATE_LABELS: Record<VlookupAggregate, string> = {
  first: "最初の1件",
  sum: "合計",
  avg: "平均",
  count: "件数",
  min: "最小",
  max: "最大",
  concat: "連結",
};

/** Aggregates that only make sense on a numeric column. */
export const NUMERIC_VLOOKUP_AGGREGATES: readonly VlookupAggregate[] = [
  "sum",
  "avg",
  "min",
  "max",
];

/**
 * Hard cap on target rows loaded per vlookup field. A join is one query plus
 * one index build, so the cost is O(n+m) — but an unbounded `findMany` on a
 * huge sheet would still blow memory, so we stop at 5,000 target rows.
 *
 * THE CAP IS NOT INVISIBLE. Pro allows 50,000 rows per collection and Business
 * 1,000,000 — 10× to 200× this cap — so on a real 顧客マスター of 20,000 rows
 * three quarters of the keys used to resolve to `null` (or `0` for 件数) while
 * the column looked like a working join. Which rows survive depends on the
 * caller's `orderBy`: relations.ts loads oldest-first, so it is always the
 * NEWEST customers that disappear.
 *
 * The contract for every caller is therefore:
 *  1. load the target rows with a deterministic `orderBy` and `take` this cap;
 *  2. run a `count` on the same `where`, and pass it as `targetTotal`;
 *  3. show {@link VlookupResolution.warning} to the user when `truncated`.
 * {@link resolveVlookupField} returns all three so nothing has to guess.
 */
export const VLOOKUP_TARGET_ROW_CAP = 5000;
/** `concat` keeps at most this many distinct values. */
export const VLOOKUP_CONCAT_LIMIT = 10;
export const VLOOKUP_CONCAT_SEPARATOR = "、";

export interface VlookupConfig {
  /** The spreadsheet to look into. */
  targetCollectionId: string;
  /** Field key on THIS spreadsheet holding the join key. */
  localKey: string;
  /** Field key on the target spreadsheet to match against. */
  targetKey: string;
  /** Field key on the target spreadsheet whose value is pulled. */
  targetField: string;
  /** How to combine when several target rows match. Default "first". */
  aggregate?: VlookupAggregate;
}

/** Minimal row shape: only `data` is read, so both records and fixtures fit. */
export interface VlookupRow {
  data: Record<string, unknown>;
}

/** Minimal field shape used by validation. */
export interface VlookupFieldInfo {
  key: string;
  name: string;
  type: string;
}

export function isVlookupAggregate(v: unknown): v is VlookupAggregate {
  return typeof v === "string" && (VLOOKUP_AGGREGATES as readonly string[]).includes(v);
}

/**
 * Normalise a join key so real-world Excel data actually matches.
 *
 * Rule: NFC → fold width variants → trim → collapse internal whitespace →
 * lower-case.
 *  - NFC only composes canonically-equivalent sequences (「カ」+U+3099 →
 *    「ガ」); by definition it can never merge two different characters.
 *  - width folding makes 「ｱｵｲ」 === 「アオイ」, 「ＡＢＣ」 === 「ABC」 and
 *    「０１２」 === 「012」, and turns the ideographic space U+3000 into a plain
 *    space so 「株式会社アオイ　」 trims away.
 *  - lower-casing makes 「Aoi」 === 「aoi」.
 *  - Anything else keeps its identity: 「①」 ≠ 「1」, 「Ⅰ」 ≠ 「i」,
 *    「㈱」 ≠ 「(株)」, 「㍿」 ≠ 「株式会社」.
 *
 * Regression (P1-13): the rule used to be whole-string NFKC, which merged all
 * of those silently — a 商品コード column mixing 「①②③」 with 「1 2 3」 is two
 * different code systems and the join joined them anyway. The 「０１２」/「012」
 * and 「ＡＢＣ」/「abc」 collisions ARE intended and are kept; the folding now
 * shares `foldWidthVariants` with the formula engine's `toNumber`, so "which
 * characters are the same character" is answered in exactly one place.
 *  - Empty / null / whitespace-only keys return null and NEVER match, so
 *    blank cells cannot all collide into a single bucket.
 */
export function normaliseKey(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let s: string;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    s = raw.map((v) => String(v ?? "")).join(",");
  } else if (typeof raw === "boolean") {
    s = raw ? "true" : "false";
  } else {
    s = String(raw);
  }
  const out = foldWidthVariants(s.normalize("NFC")).trim().replace(/\s+/g, " ").toLowerCase();
  return out === "" ? null : out;
}

/**
 * Parse a cell into a number, tolerating 「1,000」「¥1,000」「１０００」.
 *
 * Delegates to the formula engine's `toNumber` so the two can never drift:
 * there is exactly ONE numeric reading of a cell in this product, documented as
 * rule 2 at the top of src/lib/formula/functions.ts, and `toNumber` in
 * src/lib/aggregate.ts must match it too.
 *
 * Regression: this used to be its own implementation and disagreed with the
 * formula engine on the same cell — 「１２３」 was 123 here and null there, and
 * `%` was stripped so 「50%」 came back as **50**, which is neither 50% nor 0.5.
 * `%` is no longer stripped: an ambiguous percentage now reads as "not a
 * number" instead of silently producing a wrong magnitude.
 */
export function toVlookupNumber(v: unknown): number | null {
  return toNumber(sanitize(v));
}

/**
 * Build the join index ONCE: normalised target key -> matching rows, in the
 * target sheet's own order. Rows with an empty key are dropped. This is the
 * half of the algorithm that makes the join O(n+m) instead of O(n*m).
 */
export function buildKeyIndex(
  rows: VlookupRow[],
  targetKey: string,
): Map<string, VlookupRow[]> {
  const index = new Map<string, VlookupRow[]>();
  if (!targetKey) return index;
  for (const row of rows) {
    const key = normaliseKey(row?.data?.[targetKey]);
    if (key === null) continue;
    const bucket = index.get(key);
    if (bucket) bucket.push(row);
    else index.set(key, [row]);
  }
  return index;
}

function emptyResult(aggregate: VlookupAggregate): unknown {
  return aggregate === "count" ? 0 : null;
}

/**
 * Is this pulled cell blank? null / undefined / "" / whitespace-only / an empty
 * array (a multiselect with nothing chosen).
 */
function isBlankCell(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * The non-blank values of the pulled column across the matching rows, in the
 * target sheet's own order.
 *
 * EVERY aggregate works off this one list, which is the whole point: `first`
 * used to return the first ROW's value even when it was blank — producing a
 * blank cell that is indistinguishable from "no match" — while `concat` skipped
 * blanks, and `count` counted rows whose value was blank, so a 件数 of 5 sat
 * next to a 合計 of 30 and implied an average of 6 while 平均 reported 15.
 *
 * The rule is now one line: A BLANK CELL IS NOT A DATA POINT, for every mode.
 * 件数 × 平均 = 合計 then holds on any numeric column, and it always is one:
 * `validateVlookupConfig` only allows 合計/平均/最小/最大 on a numeric field, so
 * the "non-blank" set and the "parses as a number" set coincide. (Text left in
 * a numeric column by a stale import is the one residual gap: numeric modes
 * ignore it, 件数 still counts it. Ignoring is right there — poisoning the whole
 * column because one row says 「未定」 would be worse.)
 */
function matchedValues(matches: VlookupRow[], targetField: string): unknown[] {
  const out: unknown[] = [];
  for (const m of matches) {
    const v = m?.data?.[targetField];
    if (!isBlankCell(v)) out.push(v);
  }
  return out;
}

function aggregateMatches(
  aggregate: VlookupAggregate,
  matches: VlookupRow[],
  targetField: string,
  targetFieldType: FieldType,
): unknown {
  const values = matchedValues(matches, targetField);

  if (aggregate === "count") return values.length;

  if (aggregate === "first") return values.length === 0 ? null : values[0];

  if (aggregate === "concat") {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of values) {
      const text = displayValue(targetFieldType, raw);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
      if (out.length >= VLOOKUP_CONCAT_LIMIT) break;
    }
    return out.length === 0 ? null : out.join(VLOOKUP_CONCAT_SEPARATOR);
  }

  // Numeric aggregates: unparseable values are simply ignored (see above).
  const nums: number[] = [];
  for (const v of values) {
    const n = toVlookupNumber(v);
    if (n !== null) nums.push(n);
  }
  if (nums.length === 0) return null;
  switch (aggregate) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
    default:
      return null;
  }
}

/** What the caller knows about the target set it loaded. */
export interface VlookupResolveOptions {
  /**
   * Total number of rows in the target sheet — the result of a `count` on the
   * SAME `where` the rows were loaded with, NOT `targetRows.length`.
   *
   * Without it truncation can only be detected when the caller hands over more
   * rows than the cap, which a caller that already applied `take` never does.
   */
  targetTotal?: number;
}

/** The result of one vlookup field, plus what the caller must tell the user. */
export interface VlookupResolution {
  /** One value per local row, in the same order. */
  values: unknown[];
  /** Target rows actually indexed (never more than VLOOKUP_TARGET_ROW_CAP). */
  loaded: number;
  /** Target rows that exist, as far as the caller could tell us. */
  total: number;
  /** True when rows were dropped, i.e. some of these values are wrong. */
  truncated: boolean;
  /** Japanese, user-facing; null unless `truncated`. */
  warning: string | null;
}

const JA_NUM = (n: number): string => n.toLocaleString("ja-JP");

/** The message to put in front of the user when the target set was cut. */
export function vlookupTruncationWarning(loaded: number, total: number): string {
  return (
    `参照先シートの行数（${JA_NUM(total)}件）が突き合わせの上限（${JA_NUM(VLOOKUP_TARGET_ROW_CAP)}件）を超えているため、` +
    `先頭の${JA_NUM(loaded)}件だけを突き合わせています。` +
    `残り${JA_NUM(Math.max(0, total - loaded))}件は一致しても空欄（件数は0）になります。` +
    `参照先シートを絞り込むか、不要な行を減らしてからご利用ください。`
  );
}

/**
 * Resolve one vlookup field for a whole page of rows, AND report whether the
 * target set the caller handed over was complete.
 *
 * One index build, one pass over the local rows — never a nested scan.
 * No match → null, except `count` → 0.
 *
 * Truncation is a correctness problem, not a performance note: a value of
 * `null` from a truncated join is indistinguishable from "this key genuinely
 * has no match", so the caller MUST surface `warning` when `truncated` — see
 * {@link VLOOKUP_TARGET_ROW_CAP} for the full caller contract. Rows past the
 * cap are ignored here as well, so the function can never index more than the
 * cap even if a caller forgets its own `take`.
 */
export function resolveVlookupField(
  config: VlookupConfig,
  localRows: VlookupRow[],
  targetRows: VlookupRow[],
  targetFieldType: FieldType = "text",
  options: VlookupResolveOptions = {},
): VlookupResolution {
  const supplied = Array.isArray(targetRows) ? targetRows : [];
  const used = supplied.length > VLOOKUP_TARGET_ROW_CAP
    ? supplied.slice(0, VLOOKUP_TARGET_ROW_CAP)
    : supplied;
  const loaded = used.length;
  // A caller that reports fewer rows than it handed over is reporting nonsense;
  // trust the rows we can see rather than under-reporting the truncation.
  const total = Math.max(
    supplied.length,
    typeof options.targetTotal === "number" && Number.isFinite(options.targetTotal)
      ? Math.trunc(options.targetTotal)
      : 0,
  );
  const truncated = total > loaded;

  const aggregate = isVlookupAggregate(config?.aggregate) ? config.aggregate : "first";
  const blank = emptyResult(aggregate);
  const localKey = config?.localKey ?? "";
  const targetKey = config?.targetKey ?? "";
  const targetField = config?.targetField ?? "";

  // An incomplete config resolves to blanks — but the truncation report above
  // still stands, because it describes the target set, not the config.
  let values: unknown[];
  if (!localKey || !targetKey || !targetField) {
    values = localRows.map(() => blank);
  } else {
    const index = buildKeyIndex(used, targetKey);
    values = localRows.map((row) => {
      const key = normaliseKey(row?.data?.[localKey]);
      if (key === null) return blank;
      const matches = index.get(key);
      if (!matches || matches.length === 0) return blank;
      return aggregateMatches(aggregate, matches, targetField, targetFieldType);
    });
  }

  return {
    values,
    loaded,
    total,
    truncated,
    warning: truncated ? vlookupTruncationWarning(loaded, total) : null,
  };
}

/**
 * Values only — {@link resolveVlookupField} without the truncation report.
 *
 * Convenient for tests and for callers that have already checked the target row
 * count themselves. Anything rendering a sheet should use `resolveVlookupField`
 * instead, so a silently-truncated join cannot reach the user unannounced.
 */
export function resolveVlookupValues(
  config: VlookupConfig,
  localRows: VlookupRow[],
  targetRows: VlookupRow[],
  targetFieldType: FieldType = "text",
): unknown[] {
  return resolveVlookupField(config, localRows, targetRows, targetFieldType).values;
}

export interface VlookupValidationTarget {
  id: string;
  name?: string;
  fields: VlookupFieldInfo[];
}

export interface VlookupValidationContext {
  /** The collection the field is being created on (for the self-join guard). */
  selfCollectionId?: string;
  /** Fields of the collection the field is being created on. */
  localFields: VlookupFieldInfo[];
  /**
   * The target collection, ALREADY loaded workspace-scoped by the caller.
   * `null` means "missing, or belongs to another workspace" — both are the
   * same message to the user, so nothing about other tenants leaks.
   */
  target: VlookupValidationTarget | null;
}

/**
 * Validate + normalise a vlookup field's config at create/update time.
 * Throws ApiError with a Japanese message saying WHY and WHAT TO DO.
 */
export function validateVlookupConfig(
  rawConfig: unknown,
  ctx: VlookupValidationContext,
): VlookupConfig {
  const cfg = (rawConfig ?? {}) as Record<string, unknown>;
  const targetCollectionId = String(cfg.targetCollectionId ?? "").trim();

  if (!targetCollectionId) {
    throw new ApiError(
      "参照するシートが選ばれていません。値を引いてくる相手のシート（例：顧客マスター）を選んでください。",
      422,
    );
  }
  if (ctx.selfCollectionId && targetCollectionId === ctx.selfCollectionId) {
    throw new ApiError(
      "同じシートを参照することはできません（自分自身を参照すると循環参照になります）。別のシートを選んでください。",
      422,
    );
  }

  const target = ctx.target;
  if (!target) {
    throw new ApiError(
      "選んだ参照先シートが見つかりません（削除された、または別のワークスペースのシートです）。参照するシートを選び直してください。",
      404,
    );
  }

  const localKey = String(cfg.localKey ?? "").trim();
  if (!localKey) {
    throw new ApiError(
      "このシートのキー項目が選ばれていません。突き合わせに使う列（例：取引先名）を選んでください。",
      422,
    );
  }
  const localField = ctx.localFields.find((f) => f.key === localKey);
  if (!localField) {
    throw new ApiError(
      `このシートに「${localKey}」という項目がありません。キー項目をこのシートの列から選び直してください。`,
      422,
    );
  }
  if (isComputedField(localField.type)) {
    throw new ApiError(
      `キー項目「${localField.name}」は自動計算の列（数式・ルックアップなど）です。突き合わせのキーには、実際に値が入っている列を選んでください。`,
      422,
    );
  }

  const targetKey = String(cfg.targetKey ?? "").trim();
  if (!targetKey) {
    throw new ApiError(
      "参照先のキー項目が選ばれていません。参照先シートで突き合わせる列を選んでください。",
      422,
    );
  }
  const targetKeyField = target.fields.find((f) => f.key === targetKey);
  if (!targetKeyField) {
    throw new ApiError(
      `参照先シートに「${targetKey}」という項目がありません。参照先のキー項目を選び直してください。`,
      422,
    );
  }
  if (isComputedField(targetKeyField.type)) {
    throw new ApiError(
      `参照先のキー項目「${targetKeyField.name}」は自動計算の列です。突き合わせのキーには、実際に値が入っている列を選んでください。`,
      422,
    );
  }

  const targetField = String(cfg.targetField ?? "").trim();
  if (!targetField) {
    throw new ApiError(
      "取得する項目が選ばれていません。参照先シートから引いてくる列（例：業種）を選んでください。",
      422,
    );
  }
  const targetValueField = target.fields.find((f) => f.key === targetField);
  if (!targetValueField) {
    throw new ApiError(
      `参照先シートに「${targetField}」という項目がありません。取得する項目を選び直してください。`,
      422,
    );
  }
  if (isComputedField(targetValueField.type)) {
    throw new ApiError(
      `取得する項目「${targetValueField.name}」は自動計算の列（数式・ルックアップ・集計）です。計算列を続けて引くことはできません（循環参照を防ぐため）。実際に値が入っている列を選んでください。`,
      422,
    );
  }

  const rawAggregate = cfg.aggregate === undefined || cfg.aggregate === null || cfg.aggregate === ""
    ? "first"
    : cfg.aggregate;
  if (!isVlookupAggregate(rawAggregate)) {
    throw new ApiError(
      "複数一致したときの扱いを、最初の1件／合計／平均／件数／最小／最大／連結のいずれかから選んでください。",
      422,
    );
  }
  const aggregate: VlookupAggregate = rawAggregate;

  if (NUMERIC_VLOOKUP_AGGREGATES.includes(aggregate)) {
    const type = targetValueField.type;
    const numeric = isFieldType(type) && FIELD_TYPE_META[type].numeric;
    if (!numeric) {
      throw new ApiError(
        `取得する項目「${targetValueField.name}」は数値の列ではないため、${VLOOKUP_AGGREGATE_LABELS[aggregate]}では集計できません。数値・通貨の列を選ぶか、「最初の1件」または「件数」に変更してください。`,
        422,
      );
    }
  }

  return { targetCollectionId, localKey, targetKey, targetField, aggregate };
}
