/**
 * Client-safe helpers for the drag-and-drop dashboard builder.
 *
 * Pure functions only (no DB / server imports) so they can run in the browser:
 * they turn the fields of a chosen spreadsheet into sensible widget defaults and
 * classify which fields can serve as a measure / group / date axis. The specs
 * produced here conform to the Zod schemas in `./widgets`, so the same layout
 * validates end-to-end when saved.
 */
import { FIELD_TYPE_META, type FieldType } from "./field-types";
import type { WidgetSpec } from "./widgets";

export type BuilderWidgetType =
  | "kpi"
  | "bar"
  | "line"
  | "area"
  | "donut"
  | "hbar"
  | "table";

/** A field as the builder sees it (subset of the DB Field). */
export interface BuilderField {
  key: string;
  name: string;
  type: string;
}

export interface WidgetMeta {
  label: string;
  /** icon name understood by CollectionIcon/NavIcon */
  icon: string;
  hint: string;
  defaultSpan: number;
  /** Group shown in the palette. */
  group: "指標" | "グラフ" | "明細";
}

/** Palette order = display order. */
export const WIDGET_TYPES: BuilderWidgetType[] = [
  "kpi",
  "bar",
  "line",
  "area",
  "donut",
  "hbar",
  "table",
];

export const WIDGET_META: Record<BuilderWidgetType, WidgetMeta> = {
  kpi: {
    label: "KPI 数値",
    icon: "dashboard",
    hint: "合計・件数などの単一指標",
    defaultSpan: 1,
    group: "指標",
  },
  bar: {
    label: "棒グラフ",
    icon: "report",
    hint: "期間ごとの推移（棒）",
    defaultSpan: 2,
    group: "グラフ",
  },
  line: {
    label: "折れ線グラフ",
    icon: "report",
    hint: "期間ごとの推移（線）",
    defaultSpan: 2,
    group: "グラフ",
  },
  area: {
    label: "エリアグラフ",
    icon: "report",
    hint: "期間ごとの積み上げ推移",
    defaultSpan: 2,
    group: "グラフ",
  },
  donut: {
    label: "ドーナツ",
    icon: "report",
    hint: "項目別の構成比",
    defaultSpan: 1,
    group: "グラフ",
  },
  hbar: {
    label: "横棒ランキング",
    icon: "report",
    hint: "項目別のランキング",
    defaultSpan: 2,
    group: "グラフ",
  },
  table: {
    label: "表",
    icon: "table",
    hint: "明細をそのまま表示",
    defaultSpan: 2,
    group: "明細",
  },
};

function meta(type: string) {
  return FIELD_TYPE_META[type as FieldType];
}

/** Fields whose values are numeric — eligible for sum/avg/min/max. */
export function numericFields(fields: BuilderField[]): BuilderField[] {
  return fields.filter((f) => meta(f.type)?.numeric);
}

/** Fields you can group/break down by (categorical or text-ish). */
export function groupableFields(fields: BuilderField[]): BuilderField[] {
  return fields.filter((f) =>
    [
      "select",
      "multiselect",
      "text",
      "checkbox",
      "relation",
      "lookup",
      "email",
      "phone",
    ].includes(f.type),
  );
}

/** Date fields — usable as the time axis of a series widget. */
export function dateFields(fields: BuilderField[]): BuilderField[] {
  return fields.filter((f) => f.type === "date");
}

/**
 * Whether a widget of `type` can be built for a sheet with these `fields`.
 * KPI and series always work (they fall back to a count). Breakdown widgets need
 * a field to group on, and tables need at least one column — so on a field-less
 * sheet those are blocked (a valid spec is impossible).
 */
export function canAddWidget(
  type: BuilderWidgetType,
  fields: BuilderField[],
): boolean {
  switch (type) {
    case "donut":
    case "hbar":
    case "table":
      return fields.length > 0;
    default:
      return true;
  }
}

let _seq = 0;
/** Stable-ish unique widget id (client only). */
export function genWidgetId(): string {
  _seq += 1;
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `w_${rand}${_seq}`;
}

/**
 * Build a ready-to-render widget of `type` bound to `collectionSlug`, choosing
 * sensible defaults from the sheet's `fields`. Always returns a spec that passes
 * the widget schema (falling back to a count / first field when needed).
 */
export function newWidget(
  type: BuilderWidgetType,
  collectionSlug: string,
  fields: BuilderField[],
): WidgetSpec {
  const id = genWidgetId();
  const nums = numericFields(fields);
  const groups = groupableFields(fields);
  const dates = dateFields(fields);
  const base = { id, collection: collectionSlug, span: WIDGET_META[type].defaultSpan };

  switch (type) {
    case "kpi":
      return {
        ...base,
        type: "kpi",
        title: nums[0] ? `${nums[0].name}の合計` : "件数",
        measure: nums[0]
          ? { kind: "sum", field: nums[0].key }
          : { kind: "count" },
        unit: nums[0]?.type === "currency" ? "currency" : "number",
      };
    case "line":
    case "area":
    case "bar":
      return {
        ...base,
        type,
        title: "推移",
        dateField: dates[0]?.key,
        bucket: "month",
        rangeCount: 12,
        measures: [
          nums[0]
            ? { label: nums[0].name, measure: { kind: "sum", field: nums[0].key } }
            : { label: "件数", measure: { kind: "count" } },
        ],
      };
    case "donut":
    case "hbar":
      return {
        ...base,
        type,
        title: groups[0] ? `${groups[0].name}別` : "内訳",
        groupBy: groups[0]?.key ?? fields[0]?.key ?? "",
        measure: nums[0]
          ? { kind: "sum", field: nums[0].key }
          : { kind: "count" },
        limit: 6,
      };
    case "table":
      return {
        ...base,
        type: "table",
        title: "明細",
        columns: fields.slice(0, 5).map((f) => f.key),
        limit: 8,
      };
  }
}
