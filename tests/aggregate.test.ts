import { describe, it, expect } from "vitest";
import {
  computeWidget,
  type AggCollection,
  type CollectionMap,
} from "@/lib/aggregate";
import type { WidgetSpec } from "@/lib/widgets";
import { generateSampleRows } from "@/lib/sample-data";

function mapOf(col: AggCollection): CollectionMap {
  return new Map([[col.slug, col]]);
}

const NOW = new Date("2026-08-08T12:00:00");

function daysAgo(n: number): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d;
}

const sales: AggCollection = {
  slug: "sales",
  name: "受注",
  fields: [
    { key: "amount", name: "金額", type: "currency" },
    {
      key: "status",
      name: "状況",
      type: "select",
      options: [
        { label: "受注", value: "won", color: "success" },
        { label: "失注", value: "lost", color: "danger" },
      ],
    },
    { key: "region", name: "地域", type: "select" },
  ],
  records: [
    { id: "1", data: { amount: 100, status: "won", region: "東京" }, createdAt: daysAgo(1) },
    { id: "2", data: { amount: 200, status: "won", region: "東京" }, createdAt: daysAgo(2) },
    { id: "3", data: { amount: 300, status: "lost", region: "大阪" }, createdAt: daysAgo(9) },
    { id: "4", data: { amount: 400, status: "won", region: "大阪" }, createdAt: daysAgo(20) },
  ],
};

describe("computeWidget — kpi", () => {
  it("count of all records", () => {
    const w: WidgetSpec = { id: "k", type: "kpi", title: "件数", collection: "sales", measure: { kind: "count" } };
    const d = computeWidget(w, mapOf(sales), NOW);
    expect(d.type).toBe("kpi");
    if (d.type === "kpi") expect(d.value).toBe(4);
  });

  it("sum of a currency field", () => {
    const w: WidgetSpec = { id: "k", type: "kpi", title: "売上", collection: "sales", measure: { kind: "sum", field: "amount" } };
    const d = computeWidget(w, mapOf(sales), NOW);
    if (d.type === "kpi") expect(d.value).toBe(1000);
  });

  it("rateNumerator returns a percent", () => {
    const w: WidgetSpec = {
      id: "k", type: "kpi", title: "受注率", collection: "sales",
      measure: { kind: "count" }, rateNumerator: [{ field: "status", op: "eq", value: "won" }],
    };
    const d = computeWidget(w, mapOf(sales), NOW);
    if (d.type === "kpi") {
      expect(d.unit).toBe("percent");
      expect(d.value).toBe(75); // 3 of 4
    }
  });

  it("delta scopes the value to the current week", () => {
    const w: WidgetSpec = {
      id: "k", type: "kpi", title: "今週の受注", collection: "sales",
      measure: { kind: "count" }, delta: { period: "week" },
    };
    const d = computeWidget(w, mapOf(sales), NOW);
    // NOW is a Friday (2026-08-08). Week starts Monday 08-03; records 1 & 2
    // (1-2 days ago) fall in this week; 3 & 4 do not.
    if (d.type === "kpi") {
      expect(d.value).toBe(2);
      expect(typeof d.deltaPercent).toBe("number");
    }
  });

  it("filters restrict the measure", () => {
    const w: WidgetSpec = {
      id: "k", type: "kpi", title: "失注額", collection: "sales",
      measure: { kind: "sum", field: "amount" }, filters: [{ field: "status", op: "eq", value: "lost" }],
    };
    const d = computeWidget(w, mapOf(sales), NOW);
    if (d.type === "kpi") expect(d.value).toBe(300);
  });
});

describe("computeWidget — breakdown", () => {
  it("groups by a select field and applies option colors", () => {
    const w: WidgetSpec = {
      id: "b", type: "donut", title: "状況", collection: "sales",
      groupBy: "status", measure: { kind: "count" }, limit: 6,
    };
    const d = computeWidget(w, mapOf(sales), NOW);
    if (d.type === "donut") {
      const won = d.slices.find((s) => s.label === "受注");
      expect(won?.value).toBe(3);
      expect(won?.color).toBe("success");
      expect(d.total).toBe(4);
    }
  });

  it("sum measure aggregates numeric values per group", () => {
    const w: WidgetSpec = {
      id: "b", type: "hbar", title: "地域別売上", collection: "sales",
      groupBy: "region", measure: { kind: "sum", field: "amount" }, limit: 6,
    };
    const d = computeWidget(w, mapOf(sales), NOW);
    if (d.type === "hbar") {
      const tokyo = d.slices.find((s) => s.label === "東京");
      const osaka = d.slices.find((s) => s.label === "大阪");
      expect(tokyo?.value).toBe(300);
      expect(osaka?.value).toBe(700);
    }
  });

  it("collapses the long tail into その他", () => {
    const many: AggCollection = {
      slug: "x", name: "x",
      fields: [{ key: "g", name: "g", type: "text" }],
      records: Array.from({ length: 10 }, (_, i) => ({ id: String(i), data: { g: `G${i}` }, createdAt: NOW })),
    };
    const w: WidgetSpec = { id: "b", type: "hbar", title: "g", collection: "x", groupBy: "g", measure: { kind: "count" }, limit: 4 };
    const d = computeWidget(w, mapOf(many), NOW);
    if (d.type === "hbar") {
      expect(d.slices.length).toBe(4);
      expect(d.slices[d.slices.length - 1].label).toBe("その他");
    }
  });
});

describe("computeWidget — series", () => {
  it("produces one point per bucket with per-measure values", () => {
    const w: WidgetSpec = {
      id: "s", type: "area", title: "推移", collection: "sales",
      bucket: "day", rangeCount: 10,
      measures: [
        { label: "件数", measure: { kind: "count" } },
        { label: "売上", measure: { kind: "sum", field: "amount" } },
      ],
    };
    const d = computeWidget(w, mapOf(sales), NOW);
    if (d.type === "area") {
      expect(d.points.length).toBe(10);
      expect(d.series.map((s) => s.label)).toEqual(["件数", "売上"]);
      // last bucket = today; no records today -> zeros
      const last = d.points[d.points.length - 1];
      expect(last["件数"]).toBe(0);
    }
  });
});

describe("computeWidget — table", () => {
  it("sorts desc and limits", () => {
    const w: WidgetSpec = {
      id: "t", type: "table", title: "一覧", collection: "sales",
      columns: ["amount", "status"], sort: { field: "amount", dir: "desc" }, limit: 2,
    };
    const d = computeWidget(w, mapOf(sales), NOW);
    if (d.type === "table") {
      expect(d.rows.length).toBe(2);
      expect(d.rows[0].amount).toBe(400);
      expect(d.columns[0].name).toBe("金額");
    }
  });
});

describe("computeWidget — missing collection", () => {
  it("returns an empty widget instead of throwing", () => {
    const w: WidgetSpec = { id: "k", type: "kpi", title: "x", collection: "nope", measure: { kind: "count" } };
    const d = computeWidget(w, new Map(), NOW);
    if (d.type === "kpi") expect(d.value).toBe(0);
  });
});

describe("generateSampleRows", () => {
  it("is deterministic for a given slug and count", () => {
    const col = {
      name: "t", slug: "deterministic", icon: "table", color: "khaki", sampleRows: 20,
      fields: [
        { key: "amount", name: "金額", type: "currency" as const, sample: { min: 1000, max: 5000 } },
        { key: "d", name: "日付", type: "date" as const, sample: { daysBack: 30 } },
      ],
    };
    const a = generateSampleRows(col, 20);
    const b = generateSampleRows(col, 20);
    expect(a.length).toBe(20);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("respects numeric ranges and produces dates", () => {
    const col = {
      name: "t", slug: "ranges", icon: "table", color: "khaki", sampleRows: 30,
      fields: [
        { key: "n", name: "n", type: "number" as const, sample: { min: 10, max: 20 } },
        { key: "d", name: "d", type: "date" as const, sample: { daysBack: 15 } },
      ],
    };
    const rows = generateSampleRows(col, 30);
    for (const r of rows) {
      expect(r.data.n as number).toBeGreaterThanOrEqual(10);
      expect(r.data.n as number).toBeLessThanOrEqual(20);
      expect(String(r.data.d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
