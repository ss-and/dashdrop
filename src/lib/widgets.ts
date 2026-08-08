/**
 * Declarative widget & dashboard specification.
 *
 * A Dashboard's `layout` is an array of WidgetSpec objects. Each widget names a
 * source collection (by slug), a measure, and optional filters/grouping. The
 * aggregation engine (src/lib/aggregate.ts) turns a WidgetSpec + the workspace's
 * records into a WidgetData the UI can render. Templates (and the AI generator)
 * only ever produce data conforming to these Zod schemas — so everything stays
 * validated end to end.
 */
import { z } from "zod";
import { FIELD_TYPES } from "./field-types";

/* ------------------------------- measures ------------------------------- */

export const measureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("count") }),
  z.object({ kind: z.literal("sum"), field: z.string().min(1) }),
  z.object({ kind: z.literal("avg"), field: z.string().min(1) }),
  z.object({ kind: z.literal("min"), field: z.string().min(1) }),
  z.object({ kind: z.literal("max"), field: z.string().min(1) }),
]);
export type Measure = z.infer<typeof measureSchema>;

/* -------------------------------- filters ------------------------------- */

export const filterSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "neq", "in", "gt", "gte", "lt", "lte", "truthy", "falsy"]),
  value: z.unknown().optional(),
});
export type Filter = z.infer<typeof filterSchema>;

export const unitSchema = z.enum(["number", "currency", "percent", "days"]);
export type Unit = z.infer<typeof unitSchema>;

const gridSpan = z.number().int().min(1).max(4).optional();

/* -------------------------------- widgets ------------------------------- */

const baseWidget = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  collection: z.string().min(1), // collection slug within the dashboard
  /** Column span on a 4-wide grid (1 = quarter … 4 = full). */
  span: gridSpan,
  filters: z.array(filterSchema).optional(),
});

export const kpiWidgetSchema = baseWidget.extend({
  type: z.literal("kpi"),
  measure: measureSchema,
  unit: unitSchema.optional(),
  icon: z.string().optional(),
  /**
   * Render as a rate (percent). value = matching(rateNumerator) / total(filtered).
   */
  rateNumerator: z.array(filterSchema).optional(),
  /**
   * Compare current period vs the previous one for a delta chip. NOTE: setting
   * `delta` makes the KPI value period-scoped (this week/month), not lifetime —
   * pair it with titles like "今週の…". Omit it for a lifetime total.
   */
  delta: z
    .object({
      dateField: z.string().optional(), // defaults to createdAt
      period: z.enum(["week", "month"]).default("week"),
    })
    .optional(),
  target: z.number().optional(),
});
export type KpiWidget = z.infer<typeof kpiWidgetSchema>;

export const seriesMeasureSchema = z.object({
  label: z.string().min(1),
  measure: measureSchema,
  filters: z.array(filterSchema).optional(),
  color: z.string().optional(), // token name: khaki|success|warning|danger|info
});
export type SeriesMeasure = z.infer<typeof seriesMeasureSchema>;

export const seriesWidgetSchema = baseWidget.extend({
  type: z.enum(["line", "area", "bar"]),
  dateField: z.string().optional(), // defaults to createdAt
  bucket: z.enum(["day", "week", "month"]).default("day"),
  rangeCount: z.number().int().min(2).max(60).default(14),
  measures: z.array(seriesMeasureSchema).min(1).max(4),
  stacked: z.boolean().optional(),
});
export type SeriesWidget = z.infer<typeof seriesWidgetSchema>;

export const breakdownWidgetSchema = baseWidget.extend({
  type: z.enum(["donut", "hbar"]),
  groupBy: z.string().min(1), // field key to group on
  measure: measureSchema.default({ kind: "count" }),
  limit: z.number().int().min(2).max(12).default(6),
});
export type BreakdownWidget = z.infer<typeof breakdownWidgetSchema>;

export const tableWidgetSchema = baseWidget.extend({
  type: z.literal("table"),
  columns: z.array(z.string().min(1)).min(1).max(8),
  sort: z
    .object({ field: z.string().min(1), dir: z.enum(["asc", "desc"]) })
    .optional(),
  limit: z.number().int().min(1).max(50).default(8),
});
export type TableWidget = z.infer<typeof tableWidgetSchema>;

export const widgetSchema = z.discriminatedUnion("type", [
  kpiWidgetSchema,
  seriesWidgetSchema.extend({ type: z.literal("line") }),
  seriesWidgetSchema.extend({ type: z.literal("area") }),
  seriesWidgetSchema.extend({ type: z.literal("bar") }),
  breakdownWidgetSchema.extend({ type: z.literal("donut") }),
  breakdownWidgetSchema.extend({ type: z.literal("hbar") }),
  tableWidgetSchema,
]);
export type WidgetSpec = z.infer<typeof widgetSchema>;

export const dashboardLayoutSchema = z.array(widgetSchema).min(1).max(24);

/* ------------------------ template collection spec ---------------------- */

export const templateFieldSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        color: z.string().optional(),
      }),
    )
    .optional(),
  /** Hint that steers realistic sample-data generation (see sample-data.ts). */
  sample: z
    .object({
      pool: z.array(z.string()).optional(), // pick from these labels/values
      min: z.number().optional(),
      max: z.number().optional(),
      // date spread in days back from today
      daysBack: z.number().optional(),
      // weighting for select options (parallel to options[])
      weights: z.array(z.number()).optional(),
      trend: z.enum(["flat", "up", "down"]).optional(),
    })
    .optional(),
});
export type TemplateField = z.infer<typeof templateFieldSchema>;

export const templateCollectionSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  icon: z.string().default("table"),
  color: z.string().default("khaki"),
  fields: z.array(templateFieldSchema).min(1),
  /** How many sample rows to seed when this template is applied. */
  sampleRows: z.number().int().min(0).max(500).default(60),
});
export type TemplateCollection = z.infer<typeof templateCollectionSchema>;

export const dashboardTemplateSchema = z.object({
  key: z.string().min(1),
  category: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().default("dashboard"),
  color: z.string().default("khaki"),
  collections: z.array(templateCollectionSchema).min(1).max(4),
  widgets: dashboardLayoutSchema,
});
export type DashboardTemplate = z.infer<typeof dashboardTemplateSchema>;

/* ------------------------------ computed data --------------------------- */

export interface KpiData {
  type: "kpi";
  value: number;
  unit: Unit;
  deltaPercent?: number | null;
  target?: number;
}
export interface SeriesData {
  type: "line" | "area" | "bar";
  points: Array<Record<string, string | number>>; // { x, [label]: number }
  series: Array<{ label: string; color?: string }>;
  stacked?: boolean;
}
export interface BreakdownData {
  type: "donut" | "hbar";
  slices: Array<{ label: string; value: number; color?: string }>;
  total: number;
}
export interface TableData {
  type: "table";
  columns: Array<{ key: string; name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
}
export type WidgetData =
  | KpiData
  | SeriesData
  | BreakdownData
  | TableData;
