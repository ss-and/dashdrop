/**
 * 増やしたグラフの集計の検証（ゲージ・ウォーターフォール・100%積み上げ・バブル）。
 *
 * 図の見た目ではなく、**数字が嘘をつかないこと**を固定する。ここで守りたい契約:
 *
 * 1. ゲージの達成度は、目標が0でも壊れない。「小さいほど良い」は engine 側で
 *    反転済みで渡す（描く側ごとに反転していると、片方だけ直し忘れて
 *    超過が達成の色で塗られる）。
 * 2. ウォーターフォールは、段の合計と合計段が必ず一致する。畳んだ残余も
 *    段として残す——黙って捨てると「足りない分はどこへ」を探すことになる。
 * 3. 100%表示は、積み上がっているときだけ有効。
 * 4. バブルの大きさが読めない行も、点としては残す。
 */
import { describe, it, expect } from "vitest";
import { computeWidget, type AggCollection, type CollectionMap } from "@/lib/aggregate";
import type {
  GaugeData,
  ScatterData,
  SeriesData,
  WaterfallData,
  WidgetSpec,
} from "@/lib/widgets";
import { newWidget, canAddWidget } from "@/lib/widget-builder";

const NOW = new Date("2026-08-08T12:00:00Z");
const map = (col: AggCollection): CollectionMap => new Map([[col.slug, col]]);

/* ------------------------------- ゲージ --------------------------------- */

describe("ゲージ — 目標に対する進捗", () => {
  const col: AggCollection = {
    slug: "sales",
    name: "受注",
    fields: [{ key: "amount", name: "金額", type: "currency" }],
    records: [100, 200, 300].map((amount, i) => ({
      id: String(i),
      data: { amount },
      createdAt: NOW,
    })),
  };

  const gauge = (over: Record<string, unknown> = {}): GaugeData =>
    computeWidget(
      {
        id: "g",
        type: "gauge",
        title: "達成",
        collection: "sales",
        measure: { kind: "sum", field: "amount" },
        target: 1000,
        unit: "currency",
        ...over,
      } as WidgetSpec,
      map(col),
      NOW,
    ) as GaugeData;

  it("達成度は 値 / 目標", () => {
    const d = gauge();
    expect(d.value).toBe(600);
    expect(d.ratio).toBe(0.6);
  });

  it("目標が0なら達成度を出さない（0でも1でも嘘になる）", () => {
    const d = gauge({ target: 0 });
    expect(d.ratio).toBeNull();
    expect(d.value).toBe(600);
  });

  it("「小さいほど良い」は engine 側で反転して渡す", () => {
    // 目標1000に対して600 = 400 余裕がある → 達成（1.0超え）。
    const d = gauge({ lowerIsBetter: true });
    expect(d.lowerIsBetter).toBe(true);
    expect(d.ratio).toBeGreaterThan(1);
  });

  it("「小さいほど良い」で値が0でも壊れない", () => {
    const empty: AggCollection = { ...col, records: [] };
    const d = computeWidget(
      {
        id: "g",
        type: "gauge",
        title: "達成",
        collection: "sales",
        measure: { kind: "sum", field: "amount" },
        target: 1000,
        lowerIsBetter: true,
      } as WidgetSpec,
      map(empty),
      NOW,
    ) as GaugeData;
    // 0 で割らず、有限の値を返すこと（Infinity を画面に出さない）。
    expect(d.ratio === null || Number.isFinite(d.ratio)).toBe(true);
  });

  it("データ元が無くても、目標だけは正しく返す", () => {
    const d = computeWidget(
      {
        id: "g",
        type: "gauge",
        title: "達成",
        collection: "missing",
        measure: { kind: "count" },
        target: 50,
      } as WidgetSpec,
      map(col),
      NOW,
    ) as GaugeData;
    expect(d.value).toBe(0);
    expect(d.target).toBe(50);
    expect(d.ratio).toBeNull();
  });
});

/* --------------------------- ウォーターフォール --------------------------- */

describe("ウォーターフォール — 増減の内訳", () => {
  /** 予実差異。プラスとマイナスが混ざるのが、この図が要る場面。 */
  const col: AggCollection = {
    slug: "budget",
    name: "予実",
    fields: [
      { key: "dept", name: "部門", type: "text" },
      { key: "diff", name: "差異", type: "currency" },
    ],
    records: [
      ["営業", 500],
      ["開発", -200],
      ["管理", 100],
      ["物流", -50],
    ].map(([dept, diff], i) => ({
      id: String(i),
      data: { dept, diff },
      createdAt: NOW,
    })),
  };

  const run = (over: Record<string, unknown> = {}): WaterfallData =>
    computeWidget(
      {
        id: "w",
        type: "waterfall",
        title: "差異の内訳",
        collection: "budget",
        groupBy: "dept",
        measure: { kind: "sum", field: "diff" },
        limit: 8,
        showTotal: true,
        unit: "currency",
        ...over,
      } as WidgetSpec,
      map(col),
      NOW,
    ) as WaterfallData;

  it("段の合計と、合計段が一致する", () => {
    const d = run();
    const parts = d.steps.filter((s) => s.kind !== "total");
    const sum = parts.reduce((n, s) => n + s.value, 0);
    expect(sum).toBe(350); // 500 - 200 + 100 - 50
    expect(d.total).toBe(350);
    expect(d.steps.at(-1)!.kind).toBe("total");
    expect(d.steps.at(-1)!.value).toBe(350);
  });

  it("段は前の段の終わりから積み上がる（浮いた棒の位置）", () => {
    const d = run({ order: "label" });
    const parts = d.steps.filter((s) => s.kind !== "total");
    let running = 0;
    for (const s of parts) {
      const next = running + s.value;
      expect(s.start).toBe(Math.min(running, next));
      expect(s.end).toBe(Math.max(running, next));
      running = next;
    }
  });

  it("増加と減少を取り違えない", () => {
    const d = run();
    const byLabel = new Map(d.steps.map((s) => [s.label, s]));
    expect(byLabel.get("営業")!.kind).toBe("increase");
    expect(byLabel.get("開発")!.kind).toBe("decrease");
  });

  it("上限を超えた分も段として残す（黙って捨てない）", () => {
    const d = run({ limit: 3 });
    const parts = d.steps.filter((s) => s.kind !== "total");
    // 上位2つ + 残余の段。
    expect(parts).toHaveLength(3);
    expect(parts.at(-1)!.synthetic).toBe(true);
    // 畳んでも合計は変わらない。ここがずれると図が嘘になる。
    expect(parts.reduce((n, s) => n + s.value, 0)).toBe(350);
    expect(d.total).toBe(350);
  });

  it("合計段を出さない設定でも、内訳の合計は total に載る", () => {
    const d = run({ showTotal: false });
    expect(d.steps.some((s) => s.kind === "total")).toBe(false);
    expect(d.total).toBe(350);
  });

  it("全部の区分が差引ゼロでも、段は返す（描く側が言葉で断る）", () => {
    /*
     * 予実差異のようにプラスとマイナスが完全に相殺される列では普通に起きる。
     * ここで空配列を返してしまうと「データなし」になり、**データはあるのに
     * 取り込めていない**ように読める。値が0であることは、無いこととは違う。
     */
    const flat: AggCollection = {
      slug: "budget",
      name: "予実",
      fields: col.fields,
      records: [
        ["営業", 100],
        ["営業", -100],
        ["開発", 50],
        ["開発", -50],
      ].map(([dept, diff], i) => ({
        id: String(i),
        data: { dept, diff },
        createdAt: NOW,
      })),
    };
    const d = computeWidget(
      {
        id: "w",
        type: "waterfall",
        title: "差異",
        collection: "budget",
        groupBy: "dept",
        measure: { kind: "sum", field: "diff" },
        limit: 8,
        showTotal: true,
      } as WidgetSpec,
      map(flat),
      NOW,
    ) as WaterfallData;
    expect(d.steps.filter((s) => s.kind !== "total")).toHaveLength(2);
    expect(d.steps.every((s) => s.value === 0)).toBe(true);
    expect(d.total).toBe(0);
  });

  it("残余と合計はドリルダウンの対象にしない", () => {
    const d = run({ limit: 3 });
    for (const s of d.steps) {
      if (s.synthetic) expect(s.key).toBeUndefined();
    }
  });
});

/* ----------------------------- 100%積み上げ ------------------------------ */

describe("100%積み上げ — 構成比の推移", () => {
  const col: AggCollection = {
    slug: "sales",
    name: "受注",
    fields: [
      { key: "phase", name: "フェーズ", type: "text" },
      { key: "amount", name: "金額", type: "currency" },
      { key: "d", name: "日付", type: "date" },
    ],
    records: [
      ["A", 100, "2026-01-10"],
      ["B", 300, "2026-01-11"],
      ["A", 400, "2026-02-10"],
      ["B", 400, "2026-02-11"],
    ].map(([phase, amount, d], i) => ({
      id: String(i),
      data: { phase, amount, d },
      createdAt: NOW,
    })),
  };

  const run = (over: Record<string, unknown>): SeriesData =>
    computeWidget(
      {
        id: "s",
        type: "bar",
        title: "構成比",
        collection: "sales",
        dateField: "d",
        bucket: "month",
        rangeCount: 6,
        anchor: "data",
        measures: [{ label: "金額", measure: { kind: "sum", field: "amount" } }],
        ...over,
      } as WidgetSpec,
      map(col),
      NOW,
    ) as SeriesData;

  it("積み上げているときだけ 100% 表示になる", () => {
    expect(run({ splitBy: "phase", stackMode: "percent" }).stackMode).toBe("percent");
    /*
     * 積み上げていない1本の棒を100%に伸ばしても、常に全部が1色になるだけ。
     * 設定として受け取っても、描く側には渡さない。
     */
    expect(run({ stacked: false, stackMode: "percent" }).stackMode).toBeUndefined();
  });

  it("値そのものは実数のまま返す（正規化は描画側の仕事）", () => {
    // ツールチップには実数を出したいので、集計を割合に潰してはいけない。
    const d = run({ splitBy: "phase", stackMode: "percent" });
    const all = d.points.flatMap((p) =>
      Object.entries(p).filter(([k]) => k !== "x").map(([, v]) => Number(v)),
    );
    expect(all.some((v) => v >= 100)).toBe(true);
  });
});

/* -------------------------------- バブル -------------------------------- */

describe("バブル — 散布図に3つ目の量", () => {
  const col: AggCollection = {
    slug: "sales",
    name: "受注",
    fields: [
      { key: "x", name: "単価", type: "number" },
      { key: "y", name: "数量", type: "number" },
      { key: "z", name: "金額", type: "currency" },
      { key: "name", name: "案件名", type: "text" },
    ],
    records: [
      { x: 10, y: 2, z: 20, name: "A" },
      { x: 20, y: 3, z: 60, name: "B" },
      // 大きさだけ読めない行。置く場所は決まるので、落としてはいけない。
      { x: 30, y: 4, z: null, name: "C" },
    ].map((data, i) => ({ id: String(i), data, createdAt: NOW })),
  };

  const run = (over: Record<string, unknown> = {}): ScatterData =>
    computeWidget(
      {
        id: "b",
        type: "scatter",
        title: "バブル",
        collection: "sales",
        xField: "x",
        yField: "y",
        sizeField: "z",
        labelField: "name",
        limit: 500,
        sizeUnit: "currency",
        ...over,
      } as WidgetSpec,
      map(col),
      NOW,
    ) as ScatterData;

  it("大きさが読めない行も、点としては残る", () => {
    const d = run();
    expect(d.points).toHaveLength(3);
    expect(d.points.find((p) => p.label === "C")!.z).toBeUndefined();
  });

  it("大きさの列名と単位を返す（図では大小しか読めないので）", () => {
    const d = run();
    expect(d.sizeLabel).toBe("金額");
    expect(d.sizeUnit).toBe("currency");
  });

  it("大きさを指定しなければ、名前も単位も返さない", () => {
    const d = run({ sizeField: undefined });
    expect(d.sizeLabel).toBeUndefined();
    expect(d.points.every((p) => p.z === undefined)).toBe(true);
  });

  it("負の大きさは0に丸める（面積は負にできない）", () => {
    const neg: AggCollection = {
      ...col,
      records: [{ id: "9", data: { x: 1, y: 1, z: -5, name: "赤字" }, createdAt: NOW }],
    };
    const d = computeWidget(
      {
        id: "b",
        type: "scatter",
        title: "バブル",
        collection: "sales",
        xField: "x",
        yField: "y",
        sizeField: "z",
        limit: 500,
      } as WidgetSpec,
      map(neg),
      NOW,
    ) as ScatterData;
    expect(d.points[0].z).toBe(0);
  });
});

/* ------------------------------ ビルダー -------------------------------- */

describe("ビルダーの既定値", () => {
  const fields = [
    { key: "phase", name: "フェーズ", type: "text" },
    { key: "amount", name: "金額", type: "currency" },
    { key: "qty", name: "数量", type: "number" },
    { key: "cost", name: "原価", type: "currency" },
  ];

  it("ゲージの目標は、データから推測せず仮の値を置く", () => {
    const w = newWidget("gauge", "sales", fields) as { target: number };
    /*
     * 今の合計を切り上げて目標にすると、必ず達成しているゲージが出来上がる。
     * それらしく見えるので誰も直さない——明らかに仮の値を置いて、
     * 人に入れさせる。
     */
    expect(w.target).toBe(100);
  });

  it("100%積み上げは、区分と積み上げが最初から入っている", () => {
    const w = newWidget("stacked100", "sales", fields) as {
      type: string;
      stacked?: boolean;
      stackMode?: string;
      splitBy?: string;
    };
    expect(w.type).toBe("bar");
    expect(w.stacked).toBe(true);
    expect(w.stackMode).toBe("percent");
    expect(w.splitBy).toBe("phase");
  });

  it("バブルは3本目の数値を大きさに割り当てる", () => {
    const w = newWidget("bubble", "sales", fields) as { sizeField?: string };
    expect(w.sizeField).toBeDefined();
    expect(["amount", "qty", "cost"]).toContain(w.sizeField);
  });

  it("作れない組み合わせは、パレットで押させない", () => {
    const oneNum = [fields[0], fields[1]];
    expect(canAddWidget("bubble", oneNum)).toBe(false); // 数値3本が要る
    expect(canAddWidget("bubble", fields)).toBe(true);
    expect(canAddWidget("waterfall", [fields[1]])).toBe(false); // 分解する軸が無い
    expect(canAddWidget("waterfall", fields)).toBe(true);
    // ゲージは件数に対する目標もあり得るので、数値が無くても作れる。
    expect(canAddWidget("gauge", [])).toBe(true);
  });
});
