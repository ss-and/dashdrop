/**
 * Formatting helpers for alert rules — shared by the server page and the client
 * form so a rule always reads the same way (e.g. "件数 ≥ 10").
 */
import type { AlertMetric } from "./alerts";
import type { Measure } from "./widgets";

/** Operator → comparison symbol used in rule condition text. */
export const OP_SYMBOL: Record<string, string> = {
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
};

/** Full-width operator options for the form's 演算子 select. */
export const OPERATOR_OPTIONS: { value: string; label: string }[] = [
  { value: "gt", label: "＞ を超える" },
  { value: "gte", label: "≧ 以上" },
  { value: "lt", label: "＜ を下回る" },
  { value: "lte", label: "≦ 以下" },
];

const MEASURE_KIND_LABEL: Record<string, string> = {
  count: "件数",
  sum: "合計",
  avg: "平均",
  min: "最小",
  max: "最大",
};

export interface FieldLite {
  key: string;
  name: string;
  type?: string;
}

/** Human label of a measure, e.g. "件数" or "合計（金額）". */
export function measureLabel(measure: Measure, fields: FieldLite[] = []): string {
  if (measure.kind === "count") return "件数";
  const field = fields.find((f) => f.key === measure.field);
  const fieldName = field?.name ?? measure.field;
  return `${MEASURE_KIND_LABEL[measure.kind] ?? measure.kind}（${fieldName}）`;
}

/** Full metric label including any filter hint, e.g. "未対応 の 件数". */
export function metricLabel(metric: AlertMetric, fields: FieldLite[] = []): string {
  const base = measureLabel(metric.measure, fields);
  const filters = metric.filters ?? [];
  if (filters.length === 0) return base;
  const f = filters[0];
  const field = fields.find((ff) => ff.key === f.field);
  const fieldName = field?.name ?? f.field;
  const hint =
    f.value !== undefined && f.value !== null && f.value !== ""
      ? `${fieldName}=${String(f.value)}`
      : fieldName;
  const suffix = filters.length > 1 ? ` 他${filters.length - 1}件` : "";
  return `${hint}${suffix} の ${base}`;
}

/** Full condition sentence: "<metric label> <op symbol> <threshold>". */
export function conditionText(
  metric: AlertMetric,
  operator: string,
  threshold: number,
  fields: FieldLite[] = [],
): string {
  return `${metricLabel(metric, fields)} ${OP_SYMBOL[operator] ?? operator} ${threshold}`;
}
