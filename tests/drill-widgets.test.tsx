/**
 * グラフから行へ飛ぶリンク（送信側）。
 *
 * ## ここで何を守るのか
 *
 * この製品が Looker Studio / Power BI と決定的に違うのは「棒を押すと、その裏の
 * 行が出る」こと。ところが URL の書き方が3種類に割れていて、うち3つの
 * ウィジェット（箱ひげ・ウォーターフォール・日本地図）は受け側がまったく
 * 読まない `?f_列=値` を送っていた。**遷移はする**ので画面は開く——ただし
 * 絞り込まれていない全件の表が、何の説明も無く。型が無いので、コンパイルでも
 * 実行時でも誰も気づけなかった。
 *
 * だからここでは「押せること」ではなく **URLの形と演算子の選び方** を固定する。
 *
 *   1. 4つとも `?d=<json>` を出す（`?f=` も `?f_` も出さない）
 *   2. 空グループ（—）は `empty`。`eq` で「—」を送ると、実データに「—」と
 *      書かれた行しか出ない
 *   3. 「その他」は押せない。集計側に元のキー一覧が残っていないので、押せると
 *      必ず 0 件になる
 *   4. 日本地図は表示名（東京都）ではなく**生キー**（東京・13・住所…）で絞る
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cloneElement, isValidElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { computeWidget, type AggCollection, type CollectionMap } from "@/lib/aggregate";
import { parseDrill, type DrillFilter } from "@/lib/drill";
import type {
  BoxplotData,
  BreakdownData,
  JapanMapData,
  WaterfallData,
  WidgetSpec,
} from "@/lib/widgets";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    // jsdom にはレイアウトが無く、本物は 0×0 を配って何も描かない。
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      isValidElement(children)
        ? cloneElement(
            children as React.ReactElement<{ width?: number; height?: number }>,
            { width: 640, height: 320 },
          )
        : null,
  };
});

const { BreakdownChart } = await import(
  "@/components/dashboard/widgets/BreakdownChart"
);
const { BoxPlot } = await import("@/components/dashboard/widgets/BoxPlot");
const { WaterfallChart } = await import(
  "@/components/dashboard/widgets/WaterfallChart"
);
const { JapanMap } = await import("@/components/dashboard/widgets/JapanMap");

beforeEach(() => push.mockClear());

/* --------------------------- 読み取りの補助 ----------------------------- */

/**
 * ウィジェットが出したURLを、受け側と同じやり方で条件に戻す。
 *
 * 文字列を正規表現で覗くのではなく `parseDrill` に通すのは、**受け側が実際に
 * 読める形か**を見たいから。JSONの綴りが少し違っても parseDrill が黙って
 * 捨てるので、ここで条件が空になれば「読めないURL」だと分かる。
 */
function filtersOf(href: string): DrillFilter[] {
  const url = new URL(href, "https://example.test");
  // 旧い形式が残っていたら即座に落とす（これが今回の回帰そのもの）。
  expect(url.searchParams.get("f")).toBeNull();
  expect([...url.searchParams.keys()].filter((k) => k.startsWith("f_"))).toEqual(
    [],
  );
  const parsed = parseDrill(url.searchParams.getAll("d"));
  expect(parsed.dropped).toBe(0);
  return parsed.filters;
}

/** router.push に渡った最後のURLの条件。 */
function pushedFilters(): DrillFilter[] {
  expect(push).toHaveBeenCalled();
  return filtersOf(push.mock.calls[push.mock.calls.length - 1][0] as string);
}

/* ------------------------------ 内訳（円） ------------------------------ */

const BREAKDOWN: BreakdownData = {
  type: "donut",
  slices: [
    // 選択肢型の列。保存値は "parttime" だが、人が読むのは表示名。
    { label: "パート・アルバイト", value: 8, key: "parttime" },
    { label: "正社員", value: 5, key: "fulltime" },
    // 空・null・"" が畳まれたグループ。
    { label: "—", value: 3, key: "—" },
    // 上限を超えた分の残余。元のキー一覧は集計側に残っていない。
    { label: "その他", value: 2, synthetic: true },
  ],
  total: 18,
  groupBy: "employment",
  collectionId: "c1",
};

describe("内訳（ドーナツ）", () => {
  it("凡例のリンクが ?d= 形式で、表示名をラベルに載せる", () => {
    render(<BreakdownChart data={BREAKDOWN} />);
    const link = screen.getByRole("link", { name: /パート・アルバイト/ });
    const filters = filtersOf(link.getAttribute("href")!);
    expect(filters).toEqual([
      {
        op: "eq",
        field: "employment",
        value: "parttime",
        label: "パート・アルバイト",
      },
    ]);
  });

  it("空グループは empty で送る（「—」という値で絞らない）", () => {
    render(<BreakdownChart data={BREAKDOWN} />);
    const link = screen.getByRole("link", { name: /—/ });
    expect(filtersOf(link.getAttribute("href")!)).toEqual([
      { op: "empty", field: "employment" },
    ]);
  });

  it("「その他」はリンクにしない（押せても必ず 0 件になる）", () => {
    render(<BreakdownChart data={BREAKDOWN} />);
    expect(screen.queryByRole("link", { name: /その他/ })).toBeNull();
    // 本物の3項目ぶんだけがリンクになっている。
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("残余は key を持っていても押せない（synthetic が最後の砦）", () => {
    /*
     * 集計側の残余には今のところ key が入らないが、それは実装の都合であって
     * 約束ではない。判定は必ず synthetic で行い、key の有無に頼らない
     * ——将来 key（畳んだうちの1つ）が入った日に、静かに「上位以外の合計」を
     * 押すと1区分だけの表が開く、という嘘の画面になる。
     */
    const withKey: BreakdownData = {
      ...BREAKDOWN,
      slices: [
        { label: "正社員", value: 5, key: "fulltime" },
        { label: "その他", value: 2, key: "contract", synthetic: true },
      ],
      total: 7,
    };
    render(<BreakdownChart data={withKey} />);
    expect(screen.queryByRole("link", { name: /その他/ })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("実データの「その他」は押せる（ラベル文字列で判定していない）", () => {
    const real: BreakdownData = {
      ...BREAKDOWN,
      slices: [{ label: "その他", value: 4, key: "other" }],
      total: 4,
    };
    render(<BreakdownChart data={real} />);
    const link = screen.getByRole("link", { name: /その他/ });
    expect(filtersOf(link.getAttribute("href")!)).toEqual([
      { op: "eq", field: "employment", value: "other", label: "その他" },
    ]);
  });

  it("絞り込み先が分からないときはリンクを出さない", () => {
    const { container } = render(
      <BreakdownChart data={{ ...BREAKDOWN, collectionId: undefined }} />,
    );
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});

/* -------------------------------- 箱ひげ -------------------------------- */

const BOXPLOT: BoxplotData = {
  type: "boxplot",
  boxes: [
    {
      label: "営業部",
      low: 3,
      q1: 5,
      median: 8,
      q3: 11,
      high: 14,
      outliers: [],
      count: 12,
      key: "sales",
    },
    {
      label: "—",
      low: 1,
      q1: 2,
      median: 3,
      q3: 4,
      high: 5,
      outliers: [],
      count: 4,
      key: "—",
    },
    {
      label: "ほか3区分",
      low: 0,
      q1: 0,
      median: 0,
      q3: 0,
      high: 0,
      outliers: [],
      count: 0,
      synthetic: true,
    },
  ],
  unit: "days",
  fieldLabel: "リードタイム",
  groupBy: "dept",
  collectionId: "c1",
};

/** 箱ひげは自前のSVG。箱ごとの <g> を、中の <title> から引き当てる。 */
function boxGroup(container: HTMLElement, label: string): Element {
  const g = [...container.querySelectorAll("svg > g")].find((el) =>
    el.querySelector("title")?.textContent?.startsWith(label),
  );
  if (!g) throw new Error(`箱が見つからない: ${label}`);
  return g;
}

describe("箱ひげ", () => {
  it("箱を押すと ?d= 形式で遷移する", () => {
    const { container } = render(<BoxPlot data={BOXPLOT} />);
    fireEvent.click(boxGroup(container, "営業部"));
    expect(push.mock.calls[0][0]).toMatch(/^\/c\/c1\?d=/);
    expect(pushedFilters()).toEqual([
      { op: "eq", field: "dept", value: "sales", label: "営業部" },
    ]);
  });

  it("空グループの箱は empty で送る", () => {
    const { container } = render(<BoxPlot data={BOXPLOT} />);
    fireEvent.click(boxGroup(container, "—"));
    expect(pushedFilters()).toEqual([{ op: "empty", field: "dept" }]);
  });

  it("畳んだ区分は箱として描かれない（押しようがない）", () => {
    const { container } = render(<BoxPlot data={BOXPLOT} />);
    expect(() => boxGroup(container, "ほか3区分")).toThrow();
    expect(push).not.toHaveBeenCalled();
  });
});

/* -------------------------- ウォーターフォール --------------------------- */

const WATERFALL: WaterfallData = {
  type: "waterfall",
  steps: [
    { label: "売上", value: 100, start: 0, end: 100, kind: "increase", key: "sales" },
    { label: "原価", value: -40, start: 60, end: 100, kind: "decrease", key: "cogs" },
    {
      label: "その他",
      value: -10,
      start: 50,
      end: 60,
      kind: "decrease",
      synthetic: true,
    },
    { label: "合計", value: 50, start: 0, end: 50, kind: "total", synthetic: true },
  ],
  total: 50,
  unit: "currency",
  groupBy: "item",
  collectionId: "c1",
};

/** 浮遊棒は「透明な下駄 + 色付きの段」の2本積み。押すのは色付きの方。 */
function waterfallBars(container: HTMLElement): Element[] {
  const layers = container.querySelectorAll(".recharts-bar");
  const delta = layers[layers.length - 1];
  return [...delta.querySelectorAll(".recharts-rectangle")];
}

describe("ウォーターフォール", () => {
  it("段を押すと ?d= 形式で遷移する", () => {
    const { container } = render(<WaterfallChart data={WATERFALL} />);
    const bars = waterfallBars(container);
    expect(bars).toHaveLength(WATERFALL.steps.length);
    fireEvent.click(bars[0]);
    expect(push.mock.calls[0][0]).toMatch(/^\/c\/c1\?d=/);
    expect(pushedFilters()).toEqual([
      { op: "eq", field: "item", value: "sales", label: "売上" },
    ]);
  });

  it("残余と合計の段は押しても遷移しない", () => {
    const { container } = render(<WaterfallChart data={WATERFALL} />);
    const bars = waterfallBars(container);
    fireEvent.click(bars[2]); // その他
    fireEvent.click(bars[3]); // 合計
    expect(push).not.toHaveBeenCalled();
  });

  it("残余・合計が key を持っていても押せない（synthetic で判定する）", () => {
    // key の有無ではなく synthetic で切る。合計段に区分のキーが紛れ込んだ日に、
    // 「合計」を押すと1区分だけの表が開く、という嘘の画面にしないため。
    const withKeys: WaterfallData = {
      ...WATERFALL,
      steps: WATERFALL.steps.map((s) =>
        s.synthetic ? { ...s, key: "cogs" } : s,
      ),
    };
    const { container } = render(<WaterfallChart data={withKeys} />);
    const bars = waterfallBars(container);
    fireEvent.click(bars[2]);
    fireEvent.click(bars[3]);
    expect(push).not.toHaveBeenCalled();
  });
});

/* ------------------------------- 日本地図 -------------------------------- */

const JAPAN: JapanMapData = {
  type: "japanmap",
  values: [
    // 表示名は「東京都」だが、実データには「東京都」と「東京」が混在している。
    { code: "13", name: "東京都", value: 300, keys: ["東京都", "東京"] },
    // 住所がそのまま入っていて生キーを取り切れなかった県。
    {
      code: "27",
      name: "大阪府",
      value: 300,
      keys: ["大阪府大阪市北区"],
      keysPartial: true,
    },
  ],
  max: 300,
  min: 300,
  unit: "currency",
  unmatched: { count: 0, samples: [] },
  groupBy: "pref",
  collectionId: "c1",
};

/** 升は <title> に県名を持つ <g>。 */
function prefTile(container: HTMLElement, name: string): Element {
  const g = [...container.querySelectorAll("svg > g")].find((el) =>
    el.querySelector("title")?.textContent?.startsWith(name),
  );
  if (!g) throw new Error(`升が見つからない: ${name}`);
  return g;
}

describe("日本地図", () => {
  it("表示名ではなく生キーで絞る（正規化前の書き方をすべて拾う）", () => {
    const { container } = render(<JapanMap data={JAPAN} />);
    fireEvent.click(prefTile(container, "東京都"));
    expect(push.mock.calls[0][0]).toMatch(/^\/c\/c1\?d=/);
    expect(pushedFilters()).toEqual([
      {
        op: "in",
        field: "pref",
        values: ["東京都", "東京"],
        label: "東京都",
      },
    ]);
  });

  it("生キーを取り切れなかった県は押せない（中途半端に絞らない）", () => {
    const { container } = render(<JapanMap data={JAPAN} />);
    fireEvent.click(prefTile(container, "大阪府"));
    expect(push).not.toHaveBeenCalled();
  });

  it("値の無い県は押せない", () => {
    const { container } = render(<JapanMap data={JAPAN} />);
    fireEvent.click(prefTile(container, "北海道"));
    expect(push).not.toHaveBeenCalled();
  });
});

/* --------------------- 集計側が返す生キー（地図） ----------------------- */

const NOW = new Date("2026-08-08T12:00:00Z");

describe("computeJapanMap が生キーを返す", () => {
  const col: AggCollection = {
    slug: "sales",
    name: "受注",
    fields: [
      { key: "pref", name: "都道府県", type: "text" },
      { key: "amt", name: "金額", type: "currency" },
    ],
    records: [
      { pref: "東京都", amt: 100 },
      { pref: "東京", amt: 200 },
      { pref: "大阪府大阪市北区", amt: 300 },
      { pref: "海外", amt: 999 },
    ].map((d, i) => ({ id: String(i), data: d, createdAt: NOW })),
  };

  const run = (): JapanMapData =>
    computeWidget(
      {
        id: "j",
        type: "japanmap",
        title: "都道府県別",
        collection: "sales",
        field: "pref",
        measure: { kind: "sum", field: "amt" },
        unit: "currency",
      } as WidgetSpec,
      new Map([[col.slug, col]]) as CollectionMap,
      NOW,
    ) as JapanMapData;

  it("1つの県に積まれた書き方を全部返す", () => {
    const tokyo = run().values.find((v) => v.code === "13")!;
    // ここが「東京都」だけだと、「東京」で入っている行に辿り着けない。
    expect(tokyo.keys).toEqual(["東京都", "東京"]);
    expect(tokyo.keysPartial).toBeUndefined();
  });

  it("住所がそのまま入っていても、その値で絞れる", () => {
    const osaka = run().values.find((v) => v.code === "27")!;
    expect(osaka.keys).toEqual(["大阪府大阪市北区"]);
  });

  it("書き方が多すぎる県は、取り切れなかったと申告する", () => {
    /*
     * 住所列は1行1種類になりうる。URLに載せられる値の数には上限があるので、
     * 途中で諦める——ただし黙って諦めない。中途半端に絞った表を出すと、
     * グラフの数字と行数が合わない理由が誰にも分からなくなる。
     */
    const many: AggCollection = {
      ...col,
      records: Array.from({ length: 70 }, (_, i) => ({
        id: `m${i}`,
        data: { pref: `東京都渋谷区${i}丁目`, amt: 1 },
        createdAt: NOW,
      })),
    };
    const d = computeWidget(
      {
        id: "j",
        type: "japanmap",
        title: "都道府県別",
        collection: "sales",
        field: "pref",
        measure: { kind: "sum", field: "amt" },
      } as WidgetSpec,
      new Map([[col.slug, many]]) as CollectionMap,
      NOW,
    ) as JapanMapData;
    const tokyo = d.values.find((v) => v.code === "13")!;
    // 数字そのものは全件ぶん（70件）——絞り込めないだけで、集計は変えない。
    expect(tokyo.value).toBe(70);
    expect(tokyo.keysPartial).toBe(true);
    expect(tokyo.keys.length).toBeLessThanOrEqual(64);
  });
});

/**
 * 複数選択の列だけは `has` でなければならない。
 *
 * 集計側は配列を要素ごとに全バケットへ展開する（aggregate.ts の bucketKeys）
 * ので、複数選択の列に `eq` を送ると**必ず0件**になる。逆に単一値の列にまで
 * `has` を使うと、絞り込みのチップが「部門 に 営業部 を含む」という硬い
 * 文言になってしまう。集計が渡す groupByMulti の1ビットで振り分ける。
 */
describe("複数選択の列だけ has を使う", () => {
  /** 通常のスライスを1つ押したときの条件を返す。 */
  function opFor(groupByMulti: boolean | undefined): string {
    const data: BreakdownData =
      groupByMulti === undefined
        ? BREAKDOWN
        : { ...BREAKDOWN, groupByMulti };
    render(<BreakdownChart data={data} />);
    const link = screen.getByRole("link", { name: /パート・アルバイト/ });
    return filtersOf(link.getAttribute("href")!)[0].op;
  }

  it("単一値の列は eq（チップが「= パート・アルバイト」と読める）", () => {
    expect(opFor(false)).toBe("eq");
  });

  it("複数選択の列は has（eq だと必ず0件になる）", () => {
    expect(opFor(true)).toBe("has");
  });

  it("指定が無ければ eq に倒す（既存のダッシュボードは単一値が大半）", () => {
    expect(opFor(undefined)).toBe("eq");
  });

  /** 空グループは列の型に関わらず empty。値ではないので eq/has では表せない。 */
  it("空グループは複数選択でも empty のまま", () => {
    render(<BreakdownChart data={{ ...BREAKDOWN, groupByMulti: true }} />);
    const link = screen.getByRole("link", { name: /—/ });
    expect(filtersOf(link.getAttribute("href")!)).toEqual([
      { op: "empty", field: "employment" },
    ]);
  });
});

/**
 * 集計側が「その列は1行に複数の値を持つか」を正しく判定していること。
 *
 * ここを通さないと、画面側のテストが groupByMulti を手で渡すだけになり、
 * 判定そのものは一度も検証されない（実際にそうなっていて、判定を常に true に
 * 壊してもテストが落ちなかった）。実際の集計を通して確かめる。
 */
describe("集計が groupByMulti を正しく立てる", () => {
  const makeCol = (type: string): AggCollection => ({
    slug: "staff",
    name: "社員",
    fields: [
      { key: "skills", name: "スキル", type },
      { key: "amt", name: "金額", type: "currency" },
    ],
    records: [
      { skills: type === "multiselect" ? ["A", "B"] : "A", amt: 100 },
      { skills: type === "multiselect" ? ["B"] : "B", amt: 200 },
    ].map((d, i) => ({ id: String(i), data: d, createdAt: NOW })),
  });

  const run = (type: string): BreakdownData => {
    const col = makeCol(type);
    return computeWidget(
      {
        id: "b",
        type: "donut",
        title: "スキル別",
        collection: "staff",
        groupBy: "skills",
        measure: { kind: "sum", field: "amt" },
      } as WidgetSpec,
      new Map([[col.slug, col]]) as CollectionMap,
      NOW,
    ) as BreakdownData;
  };

  it("複数選択の列では true", () => {
    expect(run("multiselect").groupByMulti).toBe(true);
  });

  it("単一値の列では false", () => {
    expect(run("select").groupByMulti).toBe(false);
    expect(run("text").groupByMulti).toBe(false);
  });
});
