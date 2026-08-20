/**
 * 追加したグラフの回帰テスト。
 *
 * 利用者の要望:「またグラフの種類を増やせそう？Tableauはめちゃくちゃあると
 * 思うので」。増やすこと自体は簡単だが、**数字が合っていない図**を増やすと
 * ダッシュボード全体が信用できなくなる。ここで固定したいのは、
 *
 *  1. 区分別の積み上げは、合計が「区分で割らない同じ図」と一致すること。
 *  2. 1レコードが同じ系列に二重計上されないこと（複数選択の列で起きる）。
 *  3. ファネルは値の大小ではなく段階の順に並ぶこと。
 *  4. ヒストグラムは全件をどこかの区間に必ず入れること（最大値の取りこぼし）。
 *  5. 散布図は、縦横どちらかが数値として読めない行を置かないこと。
 */
import { describe, it, expect } from "vitest";
import { computeWidget, type AggCollection } from "@/lib/aggregate";
import type { WidgetSpec, SeriesData, BreakdownData, ScatterData } from "@/lib/widgets";

const FIELDS = [
  { key: "顧客", name: "顧客", type: "text", options: null },
  { key: "フェーズ", name: "フェーズ", type: "text", options: null },
  { key: "タグ", name: "タグ", type: "multiselect", options: null },
  { key: "金額", name: "金額", type: "number", options: null },
  { key: "数量", name: "数量", type: "number", options: null },
  { key: "受注日", name: "受注日", type: "date", options: null },
];

const PHASES = ["A: 契約完了", "B: 内諾あり", "C: 提案", "D: 初回"];

function col(records: Array<Record<string, unknown>>): AggCollection {
  return {
    slug: "s",
    name: "案件",
    id: "c1",
    fields: FIELDS,
    records: records.map((data, i) => ({
      id: `r${i}`,
      data,
      createdAt: new Date("2026-01-01"),
    })),
  };
}

const ROWS = Array.from({ length: 12 }, (_, i) => ({
  顧客: `顧客${i + 1}`,
  // A が 3件、B が 3件… と均等に散らす。
  フェーズ: PHASES[i % PHASES.length],
  タグ: i === 0 ? ["急ぎ", "重点"] : ["通常"],
  金額: (i + 1) * 1_000_000,
  数量: i % 3 === 0 ? null : i + 1, // 一部は数値として読めない
  受注日: `2026-0${(i % 3) + 1}-10`,
}));

const map = () => new Map([["s", col(ROWS)]]);
const NOW = new Date("2026-06-01");

const baseSeries = {
  id: "w1",
  title: "推移",
  collection: "s",
  dateField: "受注日",
  bucket: "month" as const,
  rangeCount: 12,
  anchor: "data" as const,
  measures: [{ label: "金額", measure: { kind: "sum" as const, field: "金額" } }],
};

describe("区分別の積み上げ（splitBy）", () => {
  const plain = { ...baseSeries, type: "bar" as const };
  const split = { ...plain, splitBy: "フェーズ", stacked: true };

  it("区分ごとに1本ずつ系列ができる", () => {
    const data = computeWidget(split as WidgetSpec, map(), NOW) as SeriesData;
    expect(data.series.map((s) => s.label).sort()).toEqual([...PHASES].sort());
  });

  it("積み上げた合計は、区分で割らない図と1円まで一致する", () => {
    const total = computeWidget(plain as WidgetSpec, map(), NOW) as SeriesData;
    const byPhase = computeWidget(split as WidgetSpec, map(), NOW) as SeriesData;

    expect(byPhase.points.length).toBe(total.points.length);
    byPhase.points.forEach((p, i) => {
      const stacked = byPhase.series.reduce(
        (sum, s) => sum + Number(p[s.label] ?? 0),
        0,
      );
      expect(stacked).toBe(Number(total.points[i]["金額"] ?? 0));
    });
  });

  it("指定しなくても積み上げになる（重ねて描くと読めない）", () => {
    const data = computeWidget(split as WidgetSpec, map(), NOW) as SeriesData;
    expect(data.stacked).toBe(true);
  });

  it("複数選択の列でも、1レコードを同じ系列に二重計上しない", () => {
    // タグは ["急ぎ","重点"] と ["通常"]。上位2本に絞ると、1行目の2つの値は
    // どちらも「その他」に落ちうる——素直に足すと、その行だけ2回数える。
    const w = {
      ...plain,
      splitBy: "タグ",
      splitLimit: 2,
      measures: [{ label: "件数", measure: { kind: "count" as const } }],
    };
    const data = computeWidget(w as WidgetSpec, map(), NOW) as SeriesData;
    const grand = data.points.reduce(
      (sum, p) => sum + data.series.reduce((s, se) => s + Number(p[se.label] ?? 0), 0),
      0,
    );
    expect(grand).toBe(ROWS.length);
  });

  it("区分の列が空でも数字は落とさない（未設定として1本にまとめる）", () => {
    // ドーナツやクロス集計と同じ扱い。値の無い行を黙って捨てると、合計が
    // 区分で割らない図と合わなくなる——それがいちばん困る。
    const total = computeWidget(plain as WidgetSpec, map(), NOW) as SeriesData;
    const data = computeWidget(
      { ...plain, splitBy: "存在しない列" } as WidgetSpec,
      map(),
      NOW,
    ) as SeriesData;
    expect(data.series).toHaveLength(1);
    data.points.forEach((p, i) => {
      expect(Number(p[data.series[0].label] ?? 0)).toBe(
        Number(total.points[i]["金額"] ?? 0),
      );
    });
  });
});

describe("複合グラフ（combo）", () => {
  it("系列ごとに描き方と軸を持ち回る", () => {
    const w = {
      ...baseSeries,
      type: "combo" as const,
      measures: [
        { label: "件数", measure: { kind: "count" as const }, as: "bar" as const, axis: "left" as const },
        {
          label: "金額",
          measure: { kind: "sum" as const, field: "金額" },
          as: "line" as const,
          axis: "right" as const,
        },
      ],
    };
    const data = computeWidget(w as WidgetSpec, map(), NOW) as SeriesData;
    expect(data.type).toBe("combo");
    expect(data.series[0]).toMatchObject({ as: "bar", axis: "left" });
    expect(data.series[1]).toMatchObject({ as: "line", axis: "right" });
  });
});

describe("ファネル", () => {
  const funnel = {
    id: "w2",
    type: "funnel" as const,
    title: "段階別",
    collection: "s",
    groupBy: "フェーズ",
    measure: { kind: "count" as const },
    limit: 8,
  };

  it("値の大小ではなく段階の順に並ぶ", () => {
    const data = computeWidget(funnel as WidgetSpec, map(), NOW) as BreakdownData;
    expect(data.slices.map((s) => s.label)).toEqual(PHASES);
  });

  it("order を value にすれば、これまでどおり多い順になる", () => {
    const rows = [
      ...ROWS,
      { ...ROWS[3] }, // D をもう1件足して、Dだけ多くする
    ];
    const data = computeWidget(
      { ...funnel, order: "value" } as WidgetSpec,
      new Map([["s", col(rows)]]),
      NOW,
    ) as BreakdownData;
    expect(data.slices[0].label).toBe("D: 初回");
  });

  it("ドーナツと同じ数字になる（並びだけの違い）", () => {
    const f = computeWidget(funnel as WidgetSpec, map(), NOW) as BreakdownData;
    const d = computeWidget(
      { ...funnel, type: "donut" } as WidgetSpec,
      map(),
      NOW,
    ) as BreakdownData;
    expect(f.total).toBe(d.total);
    for (const s of f.slices) {
      expect(d.slices.find((x) => x.label === s.label)?.value).toBe(s.value);
    }
  });
});

describe("ヒストグラム", () => {
  const hist = {
    id: "w3",
    type: "histogram" as const,
    title: "分布",
    collection: "s",
    field: "金額",
    bins: 5,
  };

  it("全件がどこかの区間に入る（最大値を取りこぼさない）", () => {
    const data = computeWidget(hist as WidgetSpec, map(), NOW) as SeriesData;
    const total = data.points.reduce((n, p) => n + Number(p["件数"] ?? 0), 0);
    expect(total).toBe(ROWS.length);
  });

  it("全部同じ値なら区間を切らずに1本だけ立てる", () => {
    const rows = Array.from({ length: 5 }, () => ({ 金額: 1000 }));
    const data = computeWidget(
      hist as WidgetSpec,
      new Map([["s", col(rows)]]),
      NOW,
    ) as SeriesData;
    expect(data.points).toHaveLength(1);
    expect(data.points[0]["件数"]).toBe(5);
  });

  it("数値が1つも無ければ空（0本の棒を並べない）", () => {
    const data = computeWidget(
      { ...hist, field: "顧客" } as WidgetSpec,
      map(),
      NOW,
    ) as SeriesData;
    expect(data.points).toEqual([]);
  });
});

describe("散布図", () => {
  const scatter = {
    id: "w4",
    type: "scatter" as const,
    title: "金額 × 数量",
    collection: "s",
    xField: "金額",
    yField: "数量",
    colorBy: "フェーズ",
    labelField: "顧客",
    limit: 500,
  };

  it("縦横どちらかが数値として読めない行は置かない", () => {
    const data = computeWidget(scatter as WidgetSpec, map(), NOW) as ScatterData;
    // 数量が null の行（3の倍数の位置）は座標が決まらない。
    const expected = ROWS.filter((r) => r.数量 !== null).length;
    expect(data.points).toHaveLength(expected);
    expect(data.omitted).toBe(0);
  });

  it("どの行かが分かるラベルと、開くためのIDを持つ", () => {
    const data = computeWidget(scatter as WidgetSpec, map(), NOW) as ScatterData;
    expect(data.points[0].label).toMatch(/^顧客/);
    expect(data.points[0].id).toBeTruthy();
    expect(data.collectionId).toBe("c1");
  });

  it("上限を超えた分は描かず、落とした数を申告する", () => {
    // 黙って間引くと「これで全部」と読まれる。落とした数は必ず返す。
    const usable = ROWS.filter((r) => r.数量 !== null).length;
    const data = computeWidget(
      { ...scatter, limit: 10 } as WidgetSpec,
      new Map([["s", col([...ROWS, ...ROWS])]]),
      NOW,
    ) as ScatterData;
    expect(data.points).toHaveLength(10);
    expect(data.points.length + data.omitted).toBe(usable * 2);
  });
});

describe("ヒートマップ", () => {
  it("クロス集計とまったく同じ数字を返す（描き方だけが違う）", () => {
    const base = {
      id: "w5",
      title: "行×列",
      collection: "s",
      rowField: "フェーズ",
      colField: "顧客",
      measure: { kind: "sum" as const, field: "金額" },
      rowLimit: 12,
      colLimit: 8,
      showTotals: true,
    };
    const pivot = computeWidget({ ...base, type: "pivot" } as WidgetSpec, map(), NOW);
    const heat = computeWidget({ ...base, type: "heatmap" } as WidgetSpec, map(), NOW);
    expect(heat.type).toBe("heatmap");
    expect({ ...heat, type: "pivot" }).toEqual(pivot);
  });
});
