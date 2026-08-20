/**
 * 追加したグラフが**実際に描かれる**ことを確かめる。
 *
 * 集計が正しくても、図が出なければ意味がない。Recharts はここでよく黙って
 * 失敗する——寸法が伝わらない、独自コンポーネントで包んで clone されない、
 * ツリーマップの content が根まで塗ってしまう。どれも例外を投げないので、
 * 型検査もビルドも通ったまま「白い四角」が並ぶ。
 *
 * ResponsiveContainer は jsdom では 0×0 になるため、ここだけ寸法を与える
 * 差し替えを入れて、SVG に中身が出ることを見る。
 */
import { describe, it, expect, vi } from "vitest";
import { cloneElement, isValidElement } from "react";
import { render, screen } from "@testing-library/react";
import type { BreakdownData, SeriesData, ScatterData } from "@/lib/widgets";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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
const { SeriesChart } = await import(
  "@/components/dashboard/widgets/SeriesChart"
);
const { ScatterPlot } = await import(
  "@/components/dashboard/widgets/ScatterPlot"
);

const SLICES = [
  { label: "A: 契約完了", value: 3, color: "khaki", key: "A" },
  { label: "B: 内諾あり", value: 5, color: "info", key: "B" },
  { label: "C: 提案", value: 8, color: "success", key: "C" },
];

function svg(container: HTMLElement): SVGSVGElement {
  const el = container.querySelector("svg");
  if (!el) throw new Error("SVG が描かれていない");
  return el as SVGSVGElement;
}

describe("ツリーマップ", () => {
  const data: BreakdownData = {
    type: "treemap",
    slices: SLICES,
    total: 16,
    groupBy: "phase",
    collectionId: "c1",
  };

  it("区画が塗られ、名前と数字が入る", () => {
    const { container } = render(<BreakdownChart data={data} />);
    const rects = svg(container).querySelectorAll("rect");
    // 根（全体を覆う1枚）を塗ってしまうと、全部同じ色で埋まる。
    expect(rects.length).toBe(SLICES.length);
    expect(screen.getByText("C: 提案")).toBeInTheDocument();
  });
});

describe("ファネル", () => {
  const data: BreakdownData = {
    type: "funnel",
    slices: SLICES,
    total: 16,
    groupBy: "phase",
    collectionId: "c1",
  };

  it("段ごとに図形が描かれ、ラベルと数字が付く", () => {
    const { container } = render(<BreakdownChart data={data} />);
    const shapes = svg(container).querySelectorAll("path, polygon");
    expect(shapes.length).toBeGreaterThanOrEqual(SLICES.length);
    expect(
      screen.getByText((t) => t.startsWith("A: 契約完了")),
    ).toBeInTheDocument();
  });
});

describe("複合グラフ", () => {
  const data: SeriesData = {
    type: "combo",
    points: [
      { x: "2026/01", 件数: 3, 金額: 1_200_000 },
      { x: "2026/02", 件数: 5, 金額: 3_400_000 },
    ],
    series: [
      { label: "件数", color: "khaki", as: "bar", axis: "left" },
      { label: "金額", color: "info", as: "line", axis: "right" },
    ],
  };

  it("棒と線の両方が描かれる（軸を分けても系列が消えない）", () => {
    const { container } = render(<SeriesChart data={data} />);
    const root = svg(container);
    expect(root.querySelectorAll(".recharts-bar").length).toBe(1);
    expect(root.querySelectorAll(".recharts-line").length).toBe(1);
    // 左右2本の軸。片方しか無いと、件数か金額のどちらかが読めなくなる。
    expect(root.querySelectorAll(".recharts-yAxis").length).toBe(2);
  });

  it("右軸を使う系列が無いときは、左軸だけで描く", () => {
    const oneAxis: SeriesData = {
      ...data,
      series: data.series.map((s) => ({ ...s, axis: undefined })),
    };
    const { container } = render(<SeriesChart data={oneAxis} />);
    const root = svg(container);
    expect(root.querySelectorAll(".recharts-yAxis").length).toBe(1);
    expect(root.querySelectorAll(".recharts-line").length).toBe(1);
  });
});

describe("散布図", () => {
  const data: ScatterData = {
    type: "scatter",
    points: [
      { x: 1_000_000, y: 3, label: "山田商事", id: "r1", group: "A" },
      { x: 5_000_000, y: 9, label: "鈴木工業", id: "r2", group: "B" },
    ],
    groups: [
      { label: "A", color: "khaki" },
      { label: "B", color: "info" },
    ],
    xLabel: "金額",
    yLabel: "数量",
    xUnit: "currency",
    yUnit: "number",
    collectionId: "c1",
    omitted: 0,
  };

  it("区分ごとに点が描かれる", () => {
    const { container } = render(<ScatterPlot data={data} />);
    expect(svg(container).querySelectorAll(".recharts-scatter").length).toBe(2);
  });

  it("描き切れなかった点があることを、黙らずに書く", () => {
    render(<ScatterPlot data={{ ...data, omitted: 480 }} />);
    expect(screen.getByText(/480/)).toBeInTheDocument();
  });
});
