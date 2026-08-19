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
 * Rule: NFKC → trim → collapse internal whitespace → lower-case.
 *  - NFKC folds full-width to half-width, so 「ｱｵｲ」 === 「アオイ」 and
 *    「ＡＢＣ」 === 「ABC」, and turns the ideographic space U+3000 into a
 *    plain space so 「株式会社アオイ　」 trims away.
 *  - lower-casing makes 「Aoi」 === 「aoi」.
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
  const out = s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return out === "" ? null : out;
}

/** Parse a cell into a number, tolerating 「1,000」「¥1,000」「１０００」. */
export function toVlookupNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v !== "string") return null;
  const cleaned = v.normalize("NFKC").replace(/[,\s¥$€£%]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
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

function aggregateMatches(
  aggregate: VlookupAggregate,
  matches: VlookupRow[],
  targetField: string,
  targetFieldType: FieldType,
): unknown {
  if (aggregate === "count") return matches.length;

  if (aggregate === "first") {
    const v = matches[0]?.data?.[targetField];
    return v === undefined || v === "" ? null : v;
  }

  if (aggregate === "concat") {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of matches) {
      const raw = m?.data?.[targetField];
      if (raw === null || raw === undefined || raw === "") continue;
      const text = displayValue(targetFieldType, raw);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
      if (out.length >= VLOOKUP_CONCAT_LIMIT) break;
    }
    return out.length === 0 ? null : out.join(VLOOKUP_CONCAT_SEPARATOR);
  }

  // Numeric aggregates: unparseable values are simply ignored.
  const nums: number[] = [];
  for (const m of matches) {
    const n = toVlookupNumber(m?.data?.[targetField]);
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

/**
 * Resolve one vlookup field for a whole page of rows.
 *
 * Returns one value per local row, in the same order. One index build, one
 * pass over the local rows — never a nested scan.
 *
 * No match → null, except `count` → 0.
 */
export function resolveVlookupValues(
  config: VlookupConfig,
  localRows: VlookupRow[],
  targetRows: VlookupRow[],
  targetFieldType: FieldType = "text",
): unknown[] {
  const aggregate = isVlookupAggregate(config?.aggregate) ? config.aggregate : "first";
  const blank = emptyResult(aggregate);
  const localKey = config?.localKey ?? "";
  const targetKey = config?.targetKey ?? "";
  const targetField = config?.targetField ?? "";
  if (!localKey || !targetKey || !targetField) {
    return localRows.map(() => blank);
  }

  const index = buildKeyIndex(targetRows, targetKey);

  return localRows.map((row) => {
    const key = normaliseKey(row?.data?.[localKey]);
    if (key === null) return blank;
    const matches = index.get(key);
    if (!matches || matches.length === 0) return blank;
    return aggregateMatches(aggregate, matches, targetField, targetFieldType);
  });
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
