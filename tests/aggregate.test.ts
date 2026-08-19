import { describe, it, expect } from "vitest";
import {
  computeWidget,
  type AggCollection,
  type AggRecord,
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

describe("date-aware range filters", () => {
  // Regression: Number("2026-07-19") is NaN, so gte/lte on a date column used
  // to match nothing at all — silently. Any dashboard with a date range filter
  // was quietly showing zero.
  const dateCollection = {
    slug: "orders",
    name: "受注",
    fields: [
      { key: "closed", name: "完了日", type: "date", options: null },
      { key: "amount", name: "金額", type: "currency", options: null },
    ],
    records: [
      { id: "1", data: { closed: "2026-01-10", amount: 100 }, createdAt: new Date("2026-01-10"), isSampleData: false },
      { id: "2", data: { closed: "2026-06-15", amount: 200 }, createdAt: new Date("2026-06-15"), isSampleData: false },
      { id: "3", data: { closed: "2026-12-31", amount: 300 }, createdAt: new Date("2026-12-31"), isSampleData: false },
    ],
  };
  const map = new Map([["orders", dateCollection as never]]);

  function countWith(filters: unknown[]): number {
    const data = computeWidget(
      {
        id: "w",
        type: "kpi",
        title: "件数",
        collection: "orders",
        measure: { kind: "count" },
        filters: filters as never,
      } as never,
      map as never,
    );
    return (data as { value: number }).value;
  }

  it("gte on a date column keeps the later rows", () => {
    expect(countWith([{ field: "closed", op: "gte", value: "2026-06-01" }])).toBe(2);
  });

  it("lte on a date column keeps the earlier rows", () => {
    expect(countWith([{ field: "closed", op: "lte", value: "2026-06-15" }])).toBe(2);
  });

  it("a gte+lte pair bounds the range on both sides", () => {
    expect(
      countWith([
        { field: "closed", op: "gte", value: "2026-02-01" },
        { field: "closed", op: "lte", value: "2026-11-30" },
      ]),
    ).toBe(1);
  });

  it("still compares plain numbers numerically", () => {
    expect(countWith([{ field: "amount", op: "gte", value: 200 }])).toBe(2);
  });
});

describe("数値として読めない値は 0 ではなく寄与しない", () => {
  // 回帰: Number("") が 0 で Number.isFinite を通っていたため、空欄・空白のみ・
  // 通貨記号だけのセルが 0 として集計され、最小が 0 に化け、平均が押し下げられて
  // いた（100 / "" / "  " / "¥" で 最小 0・平均 25）。formula エンジン
  // （src/lib/formula/functions.ts）と同じ「空なら null」規則に揃えた。
  const blanks: AggCollection = {
    slug: "blank",
    name: "空欄",
    fields: [{ key: "amount", name: "金額", type: "currency" }],
    records: [
      { id: "1", data: { amount: 100 }, createdAt: NOW },
      { id: "2", data: { amount: "" }, createdAt: NOW },
      { id: "3", data: { amount: "  " }, createdAt: NOW },
      { id: "4", data: { amount: "¥" }, createdAt: NOW },
    ],
  };

  function kpi(col: AggCollection, kind: "sum" | "avg" | "min" | "max"): number {
    const d = computeWidget(
      {
        id: "k", type: "kpi", title: "t", collection: col.slug,
        measure: { kind, field: "amount" },
      } as WidgetSpec,
      mapOf(col),
      NOW,
    );
    return d.type === "kpi" ? d.value : NaN;
  }

  it("空欄・空白・通貨記号だけのセルは最小値を 0 にしない", () => {
    expect(kpi(blanks, "min")).toBe(100);
  });

  it("平均も分母に数えない", () => {
    expect(kpi(blanks, "avg")).toBe(100);
    expect(kpi(blanks, "sum")).toBe(100);
    expect(kpi(blanks, "max")).toBe(100);
  });

  it("一件も数値が無ければ 0（ウィジェットは空表示になる）", () => {
    const none = { ...blanks, slug: "none", records: blanks.records.slice(1) };
    expect(kpi(none, "min")).toBe(0);
    expect(kpi(none, "sum")).toBe(0);
  });

  it("桁区切り・通貨記号つきの数値は今までどおり読む", () => {
    const decorated: AggCollection = {
      ...blanks, slug: "deco",
      records: [
        { id: "1", data: { amount: "¥1,200" }, createdAt: NOW },
        { id: "2", data: { amount: " 800 " }, createdAt: NOW },
      ],
    };
    expect(kpi(decorated, "sum")).toBe(2000);
  });

  it("指数表記は読み、16進などのリテラルは読まない", () => {
    // 決定: "1e3" は表計算ソフトが実際に書き出す形なので 1000 として読む。
    // "0x10" は業務データでは商品コードや型番であって 16 ではないので弾く
    // ——数値扱いすると黙って別の数字に化けるほうが害が大きい。
    const mixed: AggCollection = {
      ...blanks, slug: "mixed",
      records: [
        { id: "1", data: { amount: "1e3" }, createdAt: NOW },
        { id: "2", data: { amount: "0x10" }, createdAt: NOW },
        { id: "3", data: { amount: "Infinity" }, createdAt: NOW },
      ],
    };
    expect(kpi(mixed, "sum")).toBe(1000);
    expect(kpi(mixed, "max")).toBe(1000);
  });
});

describe("大量行でも最小・最大が落ちない", () => {
  // 回帰: Math.min(...nums) は引数を行数ぶんスタックに積むため、13万行で
  // RangeError（Maximum call stack size exceeded）になり、ダッシュボードと
  // 公開共有ページが丸ごと 500 になっていた。Business プランは 100万行まで。
  const rows = 130_000;
  const huge: AggCollection = {
    slug: "huge",
    name: "大量",
    fields: [{ key: "amount", name: "金額", type: "number" }],
    records: Array.from({ length: rows }, (_, i) => ({
      id: String(i),
      data: { amount: i + 1 },
      createdAt: NOW,
    })),
  };

  function kpi(kind: "min" | "max" | "avg" | "sum"): number {
    const d = computeWidget(
      { id: "k", type: "kpi", title: "t", collection: "huge", measure: { kind, field: "amount" } } as WidgetSpec,
      mapOf(huge),
      NOW,
    );
    return d.type === "kpi" ? d.value : NaN;
  }

  it("13万行の最小・最大を例外なく返す", () => {
    expect(() => kpi("min")).not.toThrow();
    expect(kpi("min")).toBe(1);
    expect(kpi("max")).toBe(rows);
  });
});

describe("系列名は必ず一意で、横軸の予約キーを潰さない", () => {
  // 回帰: points は 1 バケット 1 オブジェクトで、系列値は系列名をキーに詰める。
  // 同じラベルの measure が2つあると後勝ちで上書きされ 2本の線が同じ値を描き、
  // ラベルが "x" のときは横軸のキーごと消えていた。
  function series(labels: string[]) {
    const d = computeWidget(
      {
        id: "s", type: "line", title: "t", collection: "sales",
        bucket: "day", rangeCount: 3,
        measures: labels.map((label) => ({ label, measure: { kind: "count" as const } })),
      } as WidgetSpec,
      mapOf(sales),
      NOW,
    );
    if (d.type !== "line") throw new Error("line");
    return d;
  }

  it("同じラベルの measure は別キーになり、値が上書きされない", () => {
    const d = series(["売上", "売上"]);
    expect(d.series.map((s) => s.label)).toEqual(["売上", "売上（2）"]);
    expect(new Set(d.series.map((s) => s.label)).size).toBe(2);
    // 系列名は points のキーそのものなので、両方が残っていること。
    for (const p of d.points) {
      expect(Object.keys(p)).toEqual(["x", "売上", "売上（2）"]);
    }
  });

  it("ラベル「x」は横軸を潰さない", () => {
    const d = series(["x"]);
    expect(d.series[0].label).toBe("x（2）");
    expect(typeof d.points[0].x).toBe("string"); // 横軸ラベルが残っている
    expect(d.points[0].x).toMatch(/^\d{2}\/\d{2}$/);
  });

  it("衝突しないラベルはそのまま", () => {
    expect(series(["件数", "売上"]).series.map((s) => s.label)).toEqual(["件数", "売上"]);
  });
});

describe("in フィルタは配列セルにも効く", () => {
  // 回帰: 両辺が配列のとき、レコード側を String() で潰して "x,y" にしていたため、
  // 複数選択・リレーションのセルは ["x"] に一度も一致せず 0 件になっていた。
  const tagged: AggCollection = {
    slug: "tagged",
    name: "タグ",
    fields: [{ key: "tags", name: "タグ", type: "multiselect" }],
    records: [
      { id: "1", data: { tags: ["x", "y"] }, createdAt: NOW },
      { id: "2", data: { tags: ["z"] }, createdAt: NOW },
      { id: "3", data: { tags: "x" }, createdAt: NOW }, // 単一値
    ],
  };

  function count(value: unknown): number {
    const d = computeWidget(
      {
        id: "k", type: "kpi", title: "t", collection: "tagged",
        measure: { kind: "count" },
        filters: [{ field: "tags", op: "in", value }],
      } as WidgetSpec,
      mapOf(tagged),
      NOW,
    );
    return d.type === "kpi" ? d.value : NaN;
  }

  it("配列セル × 配列指定でも共通要素があれば一致する", () => {
    expect(count(["x"])).toBe(2); // ["x","y"] と "x"
    expect(count(["y", "z"])).toBe(2); // ["x","y"] と ["z"]
    expect(count(["w"])).toBe(0);
  });

  it("単一値の指定も今までどおり", () => {
    expect(count("x")).toBe(2);
    expect(count("z")).toBe(1);
  });
});

describe("バケットは日本時間で切る", () => {
  // 回帰: ローカル時刻（サーバーは UTC）で日付を切っていたため、
  // 2026-08-08 07:00 JST に作られたレコードが 08/07 に入っていた。
  // 9時前に作られたレコードが丸ごと前日に落ちていた。
  function points(records: AggRecord[], bucket: "day" | "week" | "month", now: Date, count = 3) {
    const col: AggCollection = {
      slug: "tz", name: "tz",
      fields: [{ key: "closed", name: "完了日", type: "date" }],
      records,
    };
    const d = computeWidget(
      {
        id: "s", type: "bar", title: "t", collection: "tz",
        bucket, rangeCount: count,
        measures: [{ label: "件数", measure: { kind: "count" } }],
      } as WidgetSpec,
      mapOf(col),
      now,
    );
    if (d.type !== "bar") throw new Error("bar");
    return d.points;
  }

  it("JST 早朝のレコードは当日に入る（前日ではない）", () => {
    // 2026-08-07T22:00Z = 2026-08-08 07:00 JST
    const p = points(
      [{ id: "1", data: {}, createdAt: new Date("2026-08-07T22:00:00Z") }],
      "day",
      new Date("2026-08-08T12:00:00Z"),
    );
    expect(p.map((x) => x.x)).toEqual(["08/06", "08/07", "08/08"]);
    expect(p[2]["件数"]).toBe(1);
    expect(p[1]["件数"]).toBe(0);
  });

  it("JST の月替わりで月バケットが変わる", () => {
    // 2026-07-31T16:00Z = 2026-08-01 01:00 JST
    const p = points(
      [{ id: "1", data: {}, createdAt: new Date("2026-07-31T16:00:00Z") }],
      "month",
      new Date("2026-08-08T12:00:00Z"),
      2,
    );
    expect(p.map((x) => x.x)).toEqual(["2026/07", "2026/08"]);
    expect(p[1]["件数"]).toBe(1);
  });

  it("JST の週替わり（月曜 00:00 JST）で週バケットが変わる", () => {
    // 2026-08-09T20:00Z = 2026-08-10 05:00 JST（月曜）
    const p = points(
      [{ id: "1", data: {}, createdAt: new Date("2026-08-09T20:00:00Z") }],
      "week",
      new Date("2026-08-10T02:00:00Z"),
      2,
    );
    expect(p[1]["件数"]).toBe(1); // 今週
    expect(p[0]["件数"]).toBe(0);
  });

  it("今週の KPI も JST の週境界で切り替わる", () => {
    const col: AggCollection = {
      slug: "tz", name: "tz", fields: [],
      records: [{ id: "1", data: {}, createdAt: new Date("2026-08-09T20:00:00Z") }],
    };
    const d = computeWidget(
      {
        id: "k", type: "kpi", title: "今週", collection: "tz",
        measure: { kind: "count" }, delta: { period: "week" },
      } as WidgetSpec,
      mapOf(col),
      new Date("2026-08-10T02:00:00Z"),
    );
    if (d.type === "kpi") expect(d.value).toBe(1);
  });

  it("日付フィールドを軸にした場合は今までどおり", () => {
    // 日付は "YYYY-MM-DD" で保存され、UTC 0時 → JST 9時。日付は変わらない。
    const col: AggCollection = {
      slug: "tz", name: "tz",
      fields: [{ key: "closed", name: "完了日", type: "date" }],
      records: [{ id: "1", data: { closed: "2026-08-06" }, createdAt: NOW }],
    };
    const d = computeWidget(
      {
        id: "s", type: "bar", title: "t", collection: "tz",
        dateField: "closed", bucket: "day", rangeCount: 3,
        measures: [{ label: "件数", measure: { kind: "count" } }],
      } as WidgetSpec,
      mapOf(col),
      new Date("2026-08-08T12:00:00Z"),
    );
    if (d.type === "bar") {
      expect(d.points.map((p) => p.x)).toEqual(["08/06", "08/07", "08/08"]);
      expect(d.points[0]["件数"]).toBe(1);
    }
  });
});

describe("表の並べ替えは全順序", () => {
  // 回帰: 「両方数値なら引き算、それ以外は localeCompare」は推移律を満たさない
  // （9 < 10 なのに文字列では "10" < "3x" < "9"）。数値と文字列が混ざった列は
  // 入力順しだいで並びが変わり、同じ4値で5通りの結果が出ていた。
  const values = ["9", "10", "3x", "7"];

  function sorted(order: string[], dir: "asc" | "desc" = "asc"): unknown[] {
    const col: AggCollection = {
      slug: "mix", name: "mix",
      fields: [{ key: "v", name: "値", type: "text" }],
      records: order.map((v, i) => ({ id: String(i), data: { v }, createdAt: NOW })),
    };
    const d = computeWidget(
      {
        id: "t", type: "table", title: "t", collection: "mix",
        columns: ["v"], sort: { field: "v", dir }, limit: 50,
      } as WidgetSpec,
      mapOf(col),
      NOW,
    );
    return d.type === "table" ? d.rows.map((r) => r.v) : [];
  }

  function permutations<T>(xs: T[]): T[][] {
    if (xs.length <= 1) return [xs];
    return xs.flatMap((x, i) =>
      permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]),
    );
  }

  it("入力順が変わっても結果の並びは同じ", () => {
    const expected = ["7", "9", "10", "3x"]; // 数値が先、読めない値はその後ろ
    for (const p of permutations(values)) {
      expect(sorted(p), p.join(",")).toEqual(expected);
    }
  });

  it("降順はその逆順", () => {
    expect(sorted(values, "desc")).toEqual(["3x", "10", "9", "7"]);
  });
});

describe("時系列の集計は行数に比例する", () => {
  // 回帰（性能）: バケット × measure ごとに全レコードを filter し直し、その
  // たびに new Date を作っていたため、50,000行・60バケット・2系列で 1.3 秒、
  // 同じウィジェット6枚で 8 秒かかっていた。1回のパスで積むよう変更。
  it("50,000行 × 60バケット × 4系列 のウィジェット6枚が数秒で終わる", () => {
    const rows = 50_000;
    const big: AggCollection = {
      slug: "big", name: "big",
      fields: [{ key: "amount", name: "金額", type: "number" }],
      records: Array.from({ length: rows }, (_, i) => ({
        id: String(i),
        data: { amount: i % 500 },
        createdAt: new Date(NOW.getTime() - (i % 60) * 24 * 60 * 60 * 1000),
      })),
    };
    const w = {
      id: "s", type: "line", title: "t", collection: "big",
      bucket: "day", rangeCount: 60,
      measures: [
        { label: "件数", measure: { kind: "count" } },
        { label: "合計", measure: { kind: "sum", field: "amount" } },
        { label: "平均", measure: { kind: "avg", field: "amount" } },
        { label: "最大", measure: { kind: "max", field: "amount" } },
      ],
    } as WidgetSpec;

    const started = Date.now();
    for (let i = 0; i < 6; i++) computeWidget(w, mapOf(big), NOW);
    const elapsed = Date.now() - started;
    // 修正前はこの形で 16 秒前後。遅いマシンでも余裕を見て 3 秒を上限にする。
    expect(elapsed).toBeLessThan(3000);
  });

  it("バケットを増やしても結果は変わらない（一回パス化の等価性）", () => {
    const col: AggCollection = {
      slug: "eq", name: "eq",
      fields: [{ key: "amount", name: "金額", type: "number" }],
      records: [
        { id: "1", data: { amount: 10 }, createdAt: daysAgo(0) },
        { id: "2", data: { amount: 30 }, createdAt: daysAgo(0) },
        { id: "3", data: { amount: 5 }, createdAt: daysAgo(1) },
      ],
    };
    const d = computeWidget(
      {
        id: "s", type: "line", title: "t", collection: "eq",
        bucket: "day", rangeCount: 2,
        measures: [
          { label: "件数", measure: { kind: "count" } },
          { label: "最小", measure: { kind: "min", field: "amount" } },
          { label: "平均", measure: { kind: "avg", field: "amount" } },
        ],
      } as WidgetSpec,
      mapOf(col),
      NOW,
    );
    if (d.type === "line") {
      expect(d.points[1]["件数"]).toBe(2);
      expect(d.points[1]["最小"]).toBe(10);
      expect(d.points[1]["平均"]).toBe(20);
      expect(d.points[0]["最小"]).toBe(5);
    }
  });
});
