import { describe, it, expect } from "vitest";
import {
  newWidget,
  autoLayout,
  canAddWidget,
  numericFields,
  groupableFields,
  dateFields,
  WIDGET_TYPES,
  type BuilderField,
  type BuilderWidgetType,
} from "@/lib/widget-builder";
import { widgetSchema, dashboardLayoutSchema } from "@/lib/widgets";

// Field fixtures across the shapes a real sheet can take.
const FULL: BuilderField[] = [
  { key: "date", name: "日付", type: "date" },
  { key: "acct", name: "取引先", type: "text" },
  { key: "status", name: "状態", type: "select" },
  { key: "amount", name: "金額", type: "currency" },
  { key: "qty", name: "数量", type: "number" },
];
const TEXT_ONLY: BuilderField[] = [
  { key: "memo", name: "メモ", type: "text" },
  { key: "owner", name: "担当", type: "text" },
];
const NUM_ONLY: BuilderField[] = [
  { key: "a", name: "A", type: "number" },
  { key: "b", name: "B", type: "currency" },
];
const NO_DATE: BuilderField[] = [
  { key: "acct", name: "取引先", type: "text" },
  { key: "amount", name: "金額", type: "currency" },
];
const EMPTY: BuilderField[] = [];

const MATRIX: [string, BuilderField[]][] = [
  ["full", FULL],
  ["text-only", TEXT_ONLY],
  ["numeric-only", NUM_ONLY],
  ["no-date", NO_DATE],
  ["single", [{ key: "name", name: "名前", type: "text" }]],
];

describe("field classifiers", () => {
  it("numericFields picks number/currency", () => {
    expect(numericFields(FULL).map((f) => f.key)).toEqual(["amount", "qty"]);
  });
  it("groupableFields excludes numeric/date", () => {
    expect(groupableFields(FULL).map((f) => f.key)).toEqual([
      "acct",
      "status",
    ]);
  });
  it("dateFields picks only date", () => {
    expect(dateFields(FULL).map((f) => f.key)).toEqual(["date"]);
  });
});

describe("newWidget produces schema-valid specs", () => {
  for (const [label, fields] of MATRIX) {
    for (const type of WIDGET_TYPES) {
      it(`${type} on ${label} sheet`, () => {
        // Only assert validity for combinations the builder actually allows.
        if (!canAddWidget(type as BuilderWidgetType, fields)) return;
        const spec = newWidget(type as BuilderWidgetType, "sheet-slug", fields);
        const parsed = widgetSchema.safeParse(spec);
        expect(parsed.success, JSON.stringify(spec)).toBe(true);
        expect(spec.collection).toBe("sheet-slug");
      });
    }
  }
});

describe("canAddWidget", () => {
  it("blocks breakdown/table on field-less sheets", () => {
    expect(canAddWidget("donut", EMPTY)).toBe(false);
    expect(canAddWidget("hbar", EMPTY)).toBe(false);
    expect(canAddWidget("table", EMPTY)).toBe(false);
  });
  it("always allows kpi/series", () => {
    for (const t of ["kpi", "bar", "line", "area"] as BuilderWidgetType[]) {
      expect(canAddWidget(t, EMPTY)).toBe(true);
    }
  });
});

describe("autoLayout", () => {
  it("returns a full valid layout for a rich sheet", () => {
    const layout = autoLayout([
      { slug: "sales", name: "売上", fields: FULL },
    ]);
    expect(layout.length).toBeGreaterThanOrEqual(4);
    expect(dashboardLayoutSchema.safeParse(layout).success).toBe(true);
    // Every widget bound to the sheet.
    expect(layout.every((w) => w.collection === "sales")).toBe(true);
    // Should include at least one kpi, a series, a breakdown and a table.
    const types = new Set(layout.map((w) => w.type));
    expect(types.has("kpi")).toBe(true);
    expect(types.has("bar")).toBe(true);
    expect(types.has("donut")).toBe(true);
    expect(types.has("table")).toBe(true);
  });

  it("works on a text-only sheet (count-based, no numeric)", () => {
    const layout = autoLayout([
      { slug: "memos", name: "メモ", fields: TEXT_ONLY },
    ]);
    expect(dashboardLayoutSchema.safeParse(layout).success).toBe(true);
    // No sum measures possible → series/breakdown fall back to count.
    const series = layout.find((w) => w.type === "bar");
    expect(series && series.type === "bar" && series.measures[0].measure.kind).toBe(
      "count",
    );
  });

  it("adds a cross-sheet KPI when a second sheet is present", () => {
    const layout = autoLayout([
      { slug: "a", name: "取引先", fields: FULL },
      { slug: "b", name: "明細", fields: NUM_ONLY },
    ]);
    expect(dashboardLayoutSchema.safeParse(layout).success).toBe(true);
    expect(layout.some((w) => w.collection === "b")).toBe(true);
  });

  it("skips field-less sheets and returns [] when nothing usable", () => {
    expect(autoLayout([{ slug: "x", name: "空", fields: EMPTY }])).toEqual([]);
    // primary empty, secondary usable → still builds from the usable one
    const layout = autoLayout([
      { slug: "x", name: "空", fields: EMPTY },
      { slug: "y", name: "実", fields: FULL },
    ]);
    expect(dashboardLayoutSchema.safeParse(layout).success).toBe(true);
    expect(layout.every((w) => w.collection === "y")).toBe(true);
  });

  it("never exceeds the layout cap", () => {
    const layout = autoLayout([{ slug: "s", name: "S", fields: FULL }]);
    expect(layout.length).toBeLessThanOrEqual(24);
  });
});
