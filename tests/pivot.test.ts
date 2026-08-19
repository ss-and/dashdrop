import { describe, it, expect } from "vitest";
import {
  computeWidget,
  type AggCollection,
  type CollectionMap,
} from "@/lib/aggregate";
import type { PivotData, PivotWidget, WidgetSpec } from "@/lib/widgets";

/**
 * Cross-tab (pivot) aggregation. The contract that matters most here is the
 * difference between "no records matched" (null → 「—」) and "the measure came
 * out at zero" (0) — a pivot that prints 0 for an empty intersection lies.
 */

const NOW = new Date("2026-08-08T12:00:00");

function mapOf(col: AggCollection): CollectionMap {
  return new Map([[col.slug, col]]);
}

/** A schema-shaped pivot spec with sensible defaults. */
function pivotSpec(over: Partial<PivotWidget> = {}): WidgetSpec {
  return {
    id: "p1",
    type: "pivot",
    title: "クロス集計",
    collection: "sales",
    rowField: "region",
    colField: "status",
    measure: { kind: "sum", field: "amount" },
    rowLimit: 12,
    colLimit: 8,
    showTotals: true,
    ...over,
  } as PivotWidget;
}

function run(col: AggCollection, over: Partial<PivotWidget> = {}): PivotData {
  const d = computeWidget(pivotSpec(over), mapOf(col), NOW);
  expect(d.type).toBe("pivot");
  return d as PivotData;
}

/** Look a cell up by its display labels, so tests don't depend on axis order. */
function at(d: PivotData, row: string, col: string): number | null {
  const ri = d.rows.indexOf(row);
  const ci = d.cols.indexOf(col);
  expect(ri, `row ${row}`).toBeGreaterThanOrEqual(0);
  expect(ci, `col ${col}`).toBeGreaterThanOrEqual(0);
  return d.cells[ri][ci];
}

function rowTotal(d: PivotData, row: string): number {
  return d.rowTotals[d.rows.indexOf(row)];
}
function colTotal(d: PivotData, col: string): number {
  return d.colTotals[d.cols.indexOf(col)];
}

/**
 * 5 records over 3 regions × 2 statuses. 大阪 has no 失注 and 名古屋 has no 受注,
 * so the grid is deliberately sparse.
 */
const sales: AggCollection = {
  slug: "sales",
  name: "受注",
  fields: [
    { key: "region", name: "地域", type: "text" },
    {
      key: "status",
      name: "状況",
      type: "select",
      options: [
        { label: "受注", value: "won", color: "success" },
        { label: "失注", value: "lost", color: "danger" },
      ],
    },
    { key: "amount", name: "金額", type: "currency" },
  ],
  records: [
    { id: "1", data: { region: "東京", status: "won", amount: 100 }, createdAt: NOW },
    { id: "2", data: { region: "東京", status: "won", amount: 200 }, createdAt: NOW },
    { id: "3", data: { region: "東京", status: "lost", amount: 50 }, createdAt: NOW },
    { id: "4", data: { region: "大阪", status: "won", amount: 400 }, createdAt: NOW },
    { id: "5", data: { region: "名古屋", status: "lost", amount: 30 }, createdAt: NOW },
  ],
};

describe("computePivot — sum cross-tab", () => {
  it("builds a 3×2 grid with exact cell values", () => {
    const d = run(sales);

    expect(d.rows).toHaveLength(3);
    expect(d.cols).toHaveLength(2);
    expect(new Set(d.rows)).toEqual(new Set(["東京", "大阪", "名古屋"]));

    expect(at(d, "東京", "受注")).toBe(300);
    expect(at(d, "東京", "失注")).toBe(50);
    expect(at(d, "大阪", "受注")).toBe(400);
    expect(at(d, "名古屋", "失注")).toBe(30);
  });

  it("row totals, column totals and the grand total agree", () => {
    const d = run(sales);

    expect(rowTotal(d, "東京")).toBe(350);
    expect(rowTotal(d, "大阪")).toBe(400);
    expect(rowTotal(d, "名古屋")).toBe(30);

    expect(colTotal(d, "受注")).toBe(700);
    expect(colTotal(d, "失注")).toBe(80);

    expect(d.grandTotal).toBe(780); // 100+200+50+400+30
    expect(d.rowTotals.reduce((a, b) => a + b, 0)).toBe(d.grandTotal);
    expect(d.colTotals.reduce((a, b) => a + b, 0)).toBe(d.grandTotal);
  });

  it("orders both axes by weight, heaviest first", () => {
    const d = run(sales);
    expect(d.rows).toEqual(["大阪", "東京", "名古屋"]); // 400 / 350 / 30
    expect(d.cols).toEqual(["受注", "失注"]); // 700 / 80
  });

  it("carries the field names and the spec's unit / showTotals through", () => {
    const d = run(sales, { unit: "currency", showTotals: false });
    expect(d.rowLabel).toBe("地域");
    expect(d.colLabel).toBe("状況");
    expect(d.unit).toBe("currency");
    expect(d.showTotals).toBe(false);
  });

  it("defaults the unit to number when the spec omits it", () => {
    expect(run(sales).unit).toBe("number");
  });
});

describe("computePivot — empty intersections", () => {
  it("renders a combination with no records as null, NOT 0", () => {
    const d = run(sales);
    expect(at(d, "大阪", "失注")).toBeNull();
    expect(at(d, "名古屋", "受注")).toBeNull();
    // The distinction has to survive: a real zero stays 0.
    const withZero = run({
      ...sales,
      records: [
        ...sales.records,
        { id: "6", data: { region: "大阪", status: "lost", amount: 0 }, createdAt: NOW },
      ],
    });
    expect(at(withZero, "大阪", "失注")).toBe(0);
    expect(at(withZero, "名古屋", "受注")).toBeNull();
  });
});

describe("computePivot — measures", () => {
  it("count measure counts records per intersection", () => {
    const d = run(sales, { measure: { kind: "count" } });

    expect(at(d, "東京", "受注")).toBe(2);
    expect(at(d, "東京", "失注")).toBe(1);
    expect(at(d, "大阪", "受注")).toBe(1);
    expect(at(d, "大阪", "失注")).toBeNull();
    expect(at(d, "名古屋", "受注")).toBeNull();
    expect(at(d, "名古屋", "失注")).toBe(1);

    expect(rowTotal(d, "東京")).toBe(3);
    expect(colTotal(d, "受注")).toBe(3);
    expect(d.grandTotal).toBe(5);
  });

  it("avg measure averages within each cell", () => {
    const d = run(sales, { measure: { kind: "avg", field: "amount" } });
    expect(at(d, "東京", "受注")).toBe(150); // (100 + 200) / 2
    expect(at(d, "東京", "失注")).toBe(50);
    expect(at(d, "大阪", "受注")).toBe(400);
  });

  it("avg totals re-average the underlying records, not the cell averages", () => {
    const d = run(sales, { measure: { kind: "avg", field: "amount" } });

    // 東京 = (100 + 200 + 50) / 3 = 116.67 — NOT 150 + 50 = 200.
    expect(rowTotal(d, "東京")).toBeCloseTo(116.67, 2);
    expect(rowTotal(d, "東京")).not.toBe(200);

    // 受注 = (100 + 200 + 400) / 3 = 233.33 — NOT 150 + 400 = 550.
    expect(colTotal(d, "受注")).toBeCloseTo(233.33, 2);
    expect(colTotal(d, "失注")).toBe(40); // (50 + 30) / 2

    // Grand = 780 / 5 = 156, not the sum of any of the above.
    expect(d.grandTotal).toBe(156);
  });
});

describe("computePivot — labels", () => {
  it("uses select option labels on both axes, not the stored values", () => {
    const withOptions: AggCollection = {
      ...sales,
      fields: [
        {
          key: "region",
          name: "地域",
          type: "select",
          options: [
            { label: "関東", value: "東京" },
            { label: "関西", value: "大阪" },
          ],
        },
        ...sales.fields.slice(1),
      ],
    };
    const d = run(withOptions);
    expect(d.rows).toContain("関東");
    expect(d.rows).toContain("関西");
    expect(d.rows).not.toContain("東京");
    // An option-less value falls back to the raw stored value.
    expect(d.rows).toContain("名古屋");
    // Columns keep resolving too.
    expect(d.cols).toEqual(["受注", "失注"]);
    expect(at(d, "関東", "受注")).toBe(300);
  });

  it("buckets empty / null grouping values into 「—」", () => {
    const messy: AggCollection = {
      ...sales,
      records: [
        { id: "1", data: { region: "東京", status: "won", amount: 100 }, createdAt: NOW },
        { id: "2", data: { region: "", status: "won", amount: 20 }, createdAt: NOW },
        { id: "3", data: { region: null, status: "won", amount: 5 }, createdAt: NOW },
        { id: "4", data: { status: "won", amount: 1 }, createdAt: NOW }, // key absent
        { id: "5", data: { region: "東京", amount: 7 }, createdAt: NOW }, // no column value
      ],
    };
    const d = run(messy);

    expect(d.rows).toContain("—");
    expect(d.cols).toContain("—");
    // "", null and a missing key all land in the same bucket.
    expect(at(d, "—", "受注")).toBe(26);
    expect(at(d, "東京", "—")).toBe(7);
  });
});

describe("computePivot — limits", () => {
  const wide: AggCollection = {
    slug: "sales",
    name: "受注",
    fields: [
      { key: "region", name: "地域", type: "text" },
      { key: "status", name: "状況", type: "text" },
      { key: "amount", name: "金額", type: "currency" },
    ],
    // 20 distinct regions, one column, weights 1…20.
    records: Array.from({ length: 20 }, (_, i) => ({
      id: String(i + 1),
      data: {
        region: `R${String(i + 1).padStart(2, "0")}`,
        status: "won",
        amount: i + 1,
      },
      createdAt: NOW,
    })),
  };

  it("rowLimit keeps the heaviest rows and folds the tail into 「その他」", () => {
    const d = run(wide, { rowLimit: 5, colLimit: 2 });

    expect(d.rows).toHaveLength(5);
    expect(d.rows[4]).toBe("その他");
    // The four heaviest survive by name.
    expect(d.rows.slice(0, 4)).toEqual(["R20", "R19", "R18", "R17"]);

    // The tail's values are genuinely folded in: 1…16 = 136.
    const dropped = 136;
    expect(rowTotal(d, "その他")).toBe(dropped);
    expect(at(d, "その他", "won")).toBe(dropped);

    // Nothing is lost — the grand total still covers all 20 records.
    expect(d.grandTotal).toBe(210);
    expect(d.rowTotals.reduce((a, b) => a + b, 0)).toBe(210);
  });

  it("colLimit folds the column tail the same way", () => {
    const flipped = run(wide, {
      rowField: "status",
      colField: "region",
      rowLimit: 2,
      colLimit: 4,
    });

    expect(flipped.cols).toHaveLength(4);
    expect(flipped.cols[3]).toBe("その他");
    expect(flipped.cols.slice(0, 3)).toEqual(["R20", "R19", "R18"]);
    // 1…17 = 153.
    expect(colTotal(flipped, "その他")).toBe(153);
    expect(flipped.grandTotal).toBe(210);
  });

  it("leaves both axes alone when they already fit under the limits", () => {
    const d = run(wide, { rowLimit: 50, colLimit: 20 });
    expect(d.rows).toHaveLength(20);
    expect(d.rows).not.toContain("その他");
  });
});

describe("computePivot — multiselect", () => {
  const tagged: AggCollection = {
    slug: "sales",
    name: "受注",
    fields: [
      { key: "region", name: "地域", type: "text" },
      {
        key: "tags",
        name: "タグ",
        type: "multiselect",
        options: [
          { label: "急ぎ", value: "rush" },
          { label: "新規", value: "new" },
        ],
      },
      { key: "amount", name: "金額", type: "currency" },
    ],
    records: [
      { id: "1", data: { region: "東京", tags: ["rush", "new"], amount: 100 }, createdAt: NOW },
      { id: "2", data: { region: "東京", tags: ["rush"], amount: 10 }, createdAt: NOW },
      { id: "3", data: { region: "大阪", tags: [], amount: 5 }, createdAt: NOW },
    ],
  };

  it("counts an array value into every one of its buckets", () => {
    const d = run(tagged, { colField: "tags" });

    expect(d.cols).toContain("急ぎ");
    expect(d.cols).toContain("新規");

    // Record 1 lands in BOTH tag columns.
    expect(at(d, "東京", "急ぎ")).toBe(110); // 100 + 10
    expect(at(d, "東京", "新規")).toBe(100);
    // An empty array is a missing value, not a bucket of its own.
    expect(at(d, "大阪", "—")).toBe(5);
    expect(at(d, "東京", "—")).toBeNull();
  });

  it("also multiplies across the row axis", () => {
    const d = run(tagged, {
      rowField: "tags",
      colField: "region",
      measure: { kind: "count" },
    });
    expect(at(d, "急ぎ", "東京")).toBe(2);
    expect(at(d, "新規", "東京")).toBe(1);
  });
});

describe("computePivot — filters", () => {
  it("applies widget filters before pivoting", () => {
    const d = run(sales, {
      filters: [{ field: "status", op: "eq", value: "won" }],
    });

    expect(d.cols).toEqual(["受注"]);
    expect(d.rows).toEqual(["大阪", "東京"]); // 名古屋 was 失注-only
    expect(at(d, "東京", "受注")).toBe(300);
    expect(d.grandTotal).toBe(700);
  });

  it("a filter that matches nothing yields an empty grid, not a crash", () => {
    const d = run(sales, {
      filters: [{ field: "status", op: "eq", value: "nope" }],
    });
    expect(d.rows).toEqual([]);
    expect(d.cols).toEqual([]);
    expect(d.cells).toEqual([]);
    expect(d.grandTotal).toBe(0);
  });
});

describe("computePivot — missing collection", () => {
  it("returns the empty PivotData fallback without throwing", () => {
    const spec = pivotSpec({ collection: "missing" });
    expect(() => computeWidget(spec, new Map(), NOW)).not.toThrow();

    const d = computeWidget(spec, new Map(), NOW) as PivotData;
    expect(d.type).toBe("pivot");
    expect(d.rows).toEqual([]);
    expect(d.cols).toEqual([]);
    expect(d.cells).toEqual([]);
    expect(d.rowTotals).toEqual([]);
    expect(d.colTotals).toEqual([]);
    expect(d.grandTotal).toBe(0);
    expect(d.showTotals).toBe(false);
  });
});

describe("computePivot — measure semantics must match every other widget", () => {
  // Regression: min/max fell through to the sum branch (10 and 30 printed 40),
  // and avg counted records whose measure value wasn't numeric (dragging the
  // average below the equivalent KPI tile).
  const col = {
    slug: "deals",
    name: "商談",
    fields: [
      { key: "region", name: "地域", type: "text", options: null },
      { key: "stage", name: "状況", type: "text", options: null },
      { key: "amount", name: "金額", type: "currency", options: null },
    ],
    records: [
      { id: "1", data: { region: "東京", stage: "受注", amount: 10 }, createdAt: new Date("2026-01-01"), isSampleData: false },
      { id: "2", data: { region: "東京", stage: "受注", amount: 30 }, createdAt: new Date("2026-01-02"), isSampleData: false },
      // Non-numeric: every other widget drops this record entirely.
      { id: "3", data: { region: "東京", stage: "受注", amount: "—" }, createdAt: new Date("2026-01-03"), isSampleData: false },
    ],
  };
  const map = new Map([["deals", col as never]]);

  function pivotWith(kind: "sum" | "avg" | "min" | "max") {
    return computeWidget(
      {
        id: "p",
        type: "pivot",
        title: "t",
        collection: "deals",
        rowField: "region",
        colField: "stage",
        measure: { kind, field: "amount" },
        rowLimit: 12,
        colLimit: 8,
        showTotals: true,
      } as never,
      map as never,
    ) as { cells: (number | null)[][]; rowTotals: number[]; grandTotal: number };
  }

  function kpiWith(kind: "sum" | "avg" | "min" | "max") {
    return (
      computeWidget(
        {
          id: "k",
          type: "kpi",
          title: "t",
          collection: "deals",
          measure: { kind, field: "amount" },
        } as never,
        map as never,
      ) as { value: number }
    ).value;
  }

  it("min reports the smallest value, not the sum", () => {
    expect(pivotWith("min").cells[0][0]).toBe(10);
  });

  it("max reports the largest value, not the sum", () => {
    expect(pivotWith("max").cells[0][0]).toBe(30);
  });

  it("avg ignores non-numeric records, like every other widget", () => {
    // (10 + 30) / 2 = 20 — not 40/3 = 13.33
    expect(pivotWith("avg").cells[0][0]).toBe(20);
  });

  it("agrees with the equivalent KPI tile for every measure", () => {
    for (const kind of ["sum", "avg", "min", "max"] as const) {
      expect(pivotWith(kind).cells[0][0], kind).toBe(
        Math.round(kpiWith(kind) * 100) / 100,
      );
    }
  });

  it("totals are computed from the values, not from the cells", () => {
    // A total of minimums must be the overall minimum, never a sum of them.
    const withTwoCols = {
      ...col,
      records: [
        ...col.records,
        { id: "4", data: { region: "東京", stage: "商談中", amount: 5 }, createdAt: new Date("2026-01-04"), isSampleData: false },
      ],
    };
    const m = new Map([["deals", withTwoCols as never]]);
    const data = computeWidget(
      {
        id: "p2",
        type: "pivot",
        title: "t",
        collection: "deals",
        rowField: "region",
        colField: "stage",
        measure: { kind: "min", field: "amount" },
        rowLimit: 12,
        colLimit: 8,
        showTotals: true,
      } as never,
      m as never,
    ) as { rowTotals: number[]; grandTotal: number };
    expect(data.rowTotals[0]).toBe(5);
    expect(data.grandTotal).toBe(5);
  });
});

describe("computePivot — 実データの「その他」と残余を取り違えない", () => {
  // 回帰: 残余の番兵が素の文字列 "その他" だったため、実データに「その他」が
  // あると同じキーが軸に2度並び、列合計は rowKeys を舐めるので同じ行を二度
  // 足していた（rowLimit:2 で colTotals [232] なのに grandTotal 116 という、
  // 同じ表の中で食い違う数字が出ていた）。
  const withOther: AggCollection = {
    slug: "sales",
    name: "受注",
    fields: [
      { key: "region", name: "区分", type: "text" },
      { key: "status", name: "状況", type: "text" },
      { key: "amount", name: "金額", type: "currency" },
    ],
    records: [
      { id: "1", data: { region: "その他", status: "X", amount: 100 }, createdAt: NOW },
      { id: "2", data: { region: "A", status: "X", amount: 10 }, createdAt: NOW },
      { id: "3", data: { region: "B", status: "X", amount: 5 }, createdAt: NOW },
      { id: "4", data: { region: "C", status: "X", amount: 1 }, createdAt: NOW },
    ],
  };

  it("実データの「その他」の行はそのまま、残余は別名の行になる", () => {
    const d = run(withOther, { rowLimit: 2, colLimit: 8 });

    expect(d.rows).toEqual(["その他", "その他（上位以外）"]);
    expect(new Set(d.rows).size).toBe(d.rows.length); // 描画側の key が重複しない
    expect(at(d, "その他", "X")).toBe(100);
    expect(at(d, "その他（上位以外）", "X")).toBe(16); // A+B+C
  });

  it("合計が表の中で食い違わない", () => {
    const d = run(withOther, { rowLimit: 2, colLimit: 8 });

    expect(rowTotal(d, "その他")).toBe(100);
    expect(rowTotal(d, "その他（上位以外）")).toBe(16);
    expect(colTotal(d, "X")).toBe(116);
    expect(d.grandTotal).toBe(116);
    expect(d.rowTotals.reduce((a, b) => a + b, 0)).toBe(d.grandTotal);
    expect(d.colTotals.reduce((a, b) => a + b, 0)).toBe(d.grandTotal);
  });

  it("列軸でも同じように分かれる", () => {
    const d = run(withOther, {
      rowField: "status",
      colField: "region",
      rowLimit: 8,
      colLimit: 2,
    });
    expect(d.cols).toEqual(["その他", "その他（上位以外）"]);
    expect(colTotal(d, "その他")).toBe(100);
    expect(colTotal(d, "その他（上位以外）")).toBe(16);
    expect(d.grandTotal).toBe(116);
  });

  it("選択肢ラベルが「その他」でも衝突しない", () => {
    // テンプレートとサンプルシートは { label: "その他", value: "other" } を持つ。
    const optioned: AggCollection = {
      ...withOther,
      fields: [
        {
          key: "region",
          name: "区分",
          type: "select",
          options: [{ label: "その他", value: "other" }],
        },
        ...withOther.fields.slice(1),
      ],
      records: [
        { id: "1", data: { region: "other", status: "X", amount: 100 }, createdAt: NOW },
        ...withOther.records.slice(1),
      ],
    };
    const d = run(optioned, { rowLimit: 2, colLimit: 8 });
    expect(d.rows).toEqual(["その他", "その他（上位以外）"]);
    expect(at(d, "その他", "X")).toBe(100);
    expect(d.grandTotal).toBe(116);
  });

  it("衝突しないときは従来どおり「その他」のまま", () => {
    const plain: AggCollection = {
      ...withOther,
      records: [
        { id: "1", data: { region: "Z", status: "X", amount: 100 }, createdAt: NOW },
        ...withOther.records.slice(1),
      ],
    };
    const d = run(plain, { rowLimit: 2, colLimit: 8 });
    expect(d.rows).toEqual(["Z", "その他"]);
  });
});
