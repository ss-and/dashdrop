import { describe, it, expect } from "vitest";
import {
  computeWidget,
  type AggCollection,
  type CollectionMap,
} from "@/lib/aggregate";
import type {
  BreakdownData,
  BreakdownWidget,
  KpiData,
  Measure,
  WidgetSpec,
} from "@/lib/widgets";

/**
 * カテゴリ内訳（ドーナツ / 横棒）の集計。
 *
 * ここで守りたい契約は2つ:
 *  - 選んだ measure（件数/合計/平均/最小/最大）がそのまま効くこと。同じ条件の
 *    KPI タイルと答えが一致しない内訳は、ダッシュボード上で嘘をつく。
 *  - 上限を超えた分をまとめる「その他」が、実データの「その他」と混ざらない
 *    こと。「その他」は日本語の業務データではごく普通のカテゴリ値。
 */

const NOW = new Date("2026-08-08T12:00:00Z");

function mapOf(col: AggCollection): CollectionMap {
  return new Map([[col.slug, col]]);
}

function breakdownSpec(over: Partial<BreakdownWidget> = {}): WidgetSpec {
  return {
    id: "b1",
    type: "donut",
    title: "内訳",
    collection: "sales",
    groupBy: "region",
    measure: { kind: "count" },
    limit: 6,
    ...over,
  } as BreakdownWidget as WidgetSpec;
}

function run(
  col: AggCollection,
  over: Partial<BreakdownWidget> = {},
): BreakdownData {
  const d = computeWidget(breakdownSpec(over), mapOf(col), NOW);
  expect(d.type === "donut" || d.type === "hbar").toBe(true);
  return d as BreakdownData;
}

/** ラベルでスライスを引く（並び順に依存しないため）。 */
function slice(d: BreakdownData, label: string) {
  const s = d.slices.find((x) => x.label === label);
  expect(s, `slice ${label}`).toBeTruthy();
  return s!;
}

/* ------------------------------ measures -------------------------------- */

describe("computeBreakdown — 選んだ measure が効く", () => {
  // 回帰: 種類を見ずに合計だけを積んでいたため、平均でも最小でも最大でも
  // 合計（A=300 / B=1200）が出ていた。
  const sales: AggCollection = {
    slug: "sales",
    name: "受注",
    fields: [
      { key: "region", name: "地域", type: "text" },
      { key: "amount", name: "金額", type: "currency" },
    ],
    records: [
      { id: "1", data: { region: "A", amount: 100 }, createdAt: NOW },
      { id: "2", data: { region: "A", amount: 200 }, createdAt: NOW },
      { id: "3", data: { region: "B", amount: 300 }, createdAt: NOW },
      { id: "4", data: { region: "B", amount: 900 }, createdAt: NOW },
    ],
  };

  it("合計はグループ内の和", () => {
    const d = run(sales, { measure: { kind: "sum", field: "amount" } });
    expect(slice(d, "A").value).toBe(300);
    expect(slice(d, "B").value).toBe(1200);
  });

  it("平均はグループ内の平均（合計ではない）", () => {
    const d = run(sales, { measure: { kind: "avg", field: "amount" } });
    expect(slice(d, "A").value).toBe(150);
    expect(slice(d, "B").value).toBe(600);
  });

  it("最小はグループ内の最小（合計ではない）", () => {
    const d = run(sales, { measure: { kind: "min", field: "amount" } });
    expect(slice(d, "A").value).toBe(100);
    expect(slice(d, "B").value).toBe(300);
  });

  it("最大はグループ内の最大（合計ではない）", () => {
    const d = run(sales, { measure: { kind: "max", field: "amount" } });
    expect(slice(d, "A").value).toBe(200);
    expect(slice(d, "B").value).toBe(900);
  });

  it("件数はレコード数", () => {
    const d = run(sales, { measure: { kind: "count" } });
    expect(slice(d, "A").value).toBe(2);
    expect(slice(d, "B").value).toBe(2);
    expect(d.total).toBe(4);
  });

  it("合計値はスライスの足し算ではなく元の値から出す", () => {
    // 平均の合計は平均ではない: (100+200+300+900)/4 = 375。
    expect(run(sales, { measure: { kind: "avg", field: "amount" } }).total).toBe(375);
    // 最小の合計は最小: 100。
    expect(run(sales, { measure: { kind: "min", field: "amount" } }).total).toBe(100);
    expect(run(sales, { measure: { kind: "max", field: "amount" } }).total).toBe(900);
    expect(run(sales, { measure: { kind: "sum", field: "amount" } }).total).toBe(1500);
  });

  it("どの measure でも同条件の KPI タイルと一致する", () => {
    // pivot ↔ KPI の等価性テスト（tests/pivot.test.ts）と同じ形。
    const filters = [{ field: "region", op: "eq" as const, value: "A" }];
    for (const kind of ["sum", "avg", "min", "max"] as const) {
      const measure: Measure = { kind, field: "amount" };
      const d = run(sales, { measure, filters });
      const kpi = computeWidget(
        {
          id: "k",
          type: "kpi",
          title: "同条件の KPI",
          collection: "sales",
          measure,
          filters,
        } as WidgetSpec,
        mapOf(sales),
        NOW,
      ) as KpiData;
      expect(d.slices).toHaveLength(1);
      expect(slice(d, "A").value, kind).toBe(kpi.value);
    }
    // 件数も同じ。
    const countData = run(sales, { measure: { kind: "count" }, filters });
    expect(slice(countData, "A").value).toBe(2);
  });

  it("数値として読めないレコードは 0 ではなく“寄与しない”", () => {
    const messy: AggCollection = {
      ...sales,
      records: [
        { id: "1", data: { region: "A", amount: 100 }, createdAt: NOW },
        { id: "2", data: { region: "A", amount: "" }, createdAt: NOW },
        { id: "3", data: { region: "A", amount: "  " }, createdAt: NOW },
        { id: "4", data: { region: "A", amount: "¥" }, createdAt: NOW },
      ],
    };
    expect(slice(run(messy, { measure: { kind: "min", field: "amount" } }), "A").value).toBe(100);
    expect(slice(run(messy, { measure: { kind: "avg", field: "amount" } }), "A").value).toBe(100);
    // 全部が非数値ならグループごと消える（0 のスライスを描かない）。
    const allBlank = run(
      { ...sales, records: [{ id: "1", data: { region: "A", amount: "—" }, createdAt: NOW }] },
      { measure: { kind: "sum", field: "amount" } },
    );
    expect(allBlank.slices).toEqual([]);
    expect(allBlank.total).toBe(0);
  });

  it("複数選択の値はすべてのバケットに数える", () => {
    const tagged: AggCollection = {
      slug: "sales",
      name: "受注",
      fields: [
        { key: "region", name: "タグ", type: "multiselect" },
        { key: "amount", name: "金額", type: "currency" },
      ],
      records: [
        { id: "1", data: { region: ["x", "y"], amount: 100 }, createdAt: NOW },
        { id: "2", data: { region: ["x"], amount: 10 }, createdAt: NOW },
        { id: "3", data: { region: [], amount: 5 }, createdAt: NOW },
      ],
    };
    const d = run(tagged, { measure: { kind: "sum", field: "amount" } });
    expect(slice(d, "x").value).toBe(110);
    expect(slice(d, "y").value).toBe(100);
    expect(slice(d, "—").value).toBe(5); // 空配列は「値なし」
  });
});

/* ------------------------------ 「その他」 ------------------------------- */

describe("computeBreakdown — 実データの「その他」と残余を取り違えない", () => {
  // 回帰: 残余の番兵が素の "その他" だったため、実データの「その他」と同じ
  // ラベルのスライスが2つ並び（React の key も重複）、どちらが実データか
  // 区別できなくなっていた。
  const withOther: AggCollection = {
    slug: "sales",
    name: "受注",
    fields: [
      { key: "region", name: "区分", type: "text" },
      { key: "amount", name: "金額", type: "currency" },
    ],
    records: [
      { id: "1", data: { region: "その他", amount: 100 }, createdAt: NOW },
      { id: "2", data: { region: "A", amount: 10 }, createdAt: NOW },
      { id: "3", data: { region: "B", amount: 5 }, createdAt: NOW },
      { id: "4", data: { region: "C", amount: 1 }, createdAt: NOW },
    ],
  };

  it("実データの「その他」はそのまま残り、残余は別名になる", () => {
    const d = run(withOther, { measure: { kind: "sum", field: "amount" }, limit: 2 });

    expect(d.slices).toHaveLength(2);
    expect(slice(d, "その他").value).toBe(100); // 実データの「その他」
    expect(slice(d, "その他（上位以外）").value).toBe(16); // A+B+C
    expect(d.total).toBe(116);
  });

  it("ラベルは必ず一意（描画側の key が重複しない）", () => {
    const d = run(withOther, { measure: { kind: "sum", field: "amount" }, limit: 2 });
    expect(new Set(d.slices.map((s) => s.label)).size).toBe(d.slices.length);
  });

  it("選択肢ラベルが「その他」でも衝突しない", () => {
    // テンプレートやサンプルシートは { label: "その他", value: "other" } を持つ。
    const optioned: AggCollection = {
      ...withOther,
      fields: [
        {
          key: "region",
          name: "区分",
          type: "select",
          options: [{ label: "その他", value: "other", color: "khaki" }],
        },
        withOther.fields[1],
      ],
      records: [
        { id: "1", data: { region: "other", amount: 100 }, createdAt: NOW },
        ...withOther.records.slice(1),
      ],
    };
    const d = run(optioned, { measure: { kind: "sum", field: "amount" }, limit: 2 });
    expect(slice(d, "その他").value).toBe(100);
    expect(slice(d, "その他（上位以外）").value).toBe(16);
    expect(new Set(d.slices.map((s) => s.label)).size).toBe(2);
  });

  it("衝突しないときは従来どおり「その他」のまま", () => {
    const plain: AggCollection = {
      ...withOther,
      records: [
        { id: "1", data: { region: "Z", amount: 100 }, createdAt: NOW },
        ...withOther.records.slice(1),
      ],
    };
    const d = run(plain, { measure: { kind: "sum", field: "amount" }, limit: 2 });
    expect(d.slices.map((s) => s.label)).toEqual(["Z", "その他"]);
    expect(slice(d, "その他").color).toBe("neutral");
  });

  it("残余も元の値から集計する（平均の残余は平均のまま）", () => {
    const d = run(withOther, { measure: { kind: "avg", field: "amount" }, limit: 2 });
    // 残余 = (10 + 5 + 1) / 3 = 5.33 — 16 でも 5+1 でもない。
    expect(slice(d, "その他（上位以外）").value).toBeCloseTo(5.33, 2);
    // 全体平均 = (100 + 10 + 5 + 1) / 4 = 29
    expect(d.total).toBe(29);
  });
});
