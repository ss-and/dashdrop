"use client";

import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { formatValue } from "@/lib/utils";
import { seriesColor, CHART_TEXT as TEXT } from "@/lib/palette";
import { usePalette } from "../PaletteContext";
import type { SankeyData } from "@/lib/widgets";

/**
 * サンキー — どこから来て、どこへ行ったか。
 *
 * クロス集計でも同じ数字は出せるが、「どこが太いか」は数字の表からは掴めない。
 * 帯の太さがそのまま量なので、主要な流れが一目で分かる。
 *
 * 節点は集計側で左右に分けてある（同じ値が出発側と到着側の両方に現れると
 * 自分自身へ戻る輪ができ、サンキーは輪を描けずに黙って崩れる）。
 */

/** 節点1つ。名前は箱の外側に置く——中に入れると細い節点で文字が消える。 */
function Node({
  x,
  y,
  width,
  height,
  index,
  payload,
  colors,
}: {
  /* 座標は Recharts が注入する（Link と同じ理由で任意）。 */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  payload?: { label?: string; side?: "from" | "to"; value?: number };
  colors: string[];
}) {
  const isFrom = payload?.side === "from";
  const color = colors[(index ?? 0) % colors.length];
  const [X, Y, W, H] = [x ?? 0, y ?? 0, width ?? 0, height ?? 0];
  return (
    <Layer key={`node-${index}`}>
      <Rectangle x={X} y={Y} width={W} height={H} fill={color} fillOpacity={0.9} />
      <text
        // 左の節点は右側へ、右の節点は左側へ書く。図の外へはみ出さない。
        textAnchor={isFrom ? "start" : "end"}
        x={isFrom ? X + W + 6 : X - 6}
        y={Y + H / 2}
        dominantBaseline="middle"
        fontSize={11}
        fill={TEXT}
      >
        {(payload?.label ?? "").length > 8
          ? `${(payload?.label ?? "").slice(0, 7)}…`
          : payload?.label}
      </text>
      {H > 14 && (
        <text
          textAnchor={isFrom ? "start" : "end"}
          x={isFrom ? X + W + 6 : X - 6}
          y={Y + H / 2 + 12}
          dominantBaseline="middle"
          fontSize={9}
          fill="#8a877c"
        >
          {payload?.value}
        </text>
      )}
    </Layer>
  );
}

/**
 * 帯1本。出発側の節点の色で塗る。
 * Recharts は `sourceX/targetX` などの座標を props で渡してくるので、
 * ベジェ曲線を自分で組み立てる。
 */
function Link({
  sourceX,
  targetX,
  sourceY,
  targetY,
  sourceControlX,
  targetControlX,
  linkWidth,
  index,
  colors,
  sources,
}: {
  /*
   * 座標は Recharts が clone のときに注入する。呼び出し側は colors しか
   * 渡さないので、型のうえでは任意にしておく（必須にすると、ダミーの
   * 0 を並べた無意味な JSX を書くことになる）。
   */
  sourceX?: number;
  targetX?: number;
  sourceY?: number;
  targetY?: number;
  sourceControlX?: number;
  targetControlX?: number;
  linkWidth?: number;
  index?: number;
  colors: string[];
  /**
   * 帯ごとの出発節点の番号。Recharts が渡す payload から取ろうとすると
   * 内部形式に依存して、版が上がった途端に**全部が同じ色**になる（実際に
   * なった）。自分のデータから引くほうが確実で、読んでも意図が分かる。
   */
  sources: number[];
}) {
  const from = sources[index ?? 0] ?? 0;
  return (
    <path
      key={`link-${index}`}
      d={`M${sourceX ?? 0},${sourceY ?? 0}C${sourceControlX ?? 0},${sourceY ?? 0} ${targetControlX ?? 0},${targetY ?? 0} ${targetX ?? 0},${targetY ?? 0}`}
      fill="none"
      stroke={colors[from % colors.length]}
      strokeWidth={linkWidth ?? 1}
      strokeOpacity={0.3}
    />
  );
}

export function SankeyFlow({ data }: { data: SankeyData }) {
  const palette = usePalette();
  const { nodes, links, unit, fromLabel, toLabel } = data;

  if (links.length === 0) {
    return (
      <div className="flex h-60 w-full items-center justify-center text-sm text-ink-faint">
        データなし
      </div>
    );
  }

  const colors = nodes.map((_, i) => seriesColor(palette, i));

  return (
    <div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={{ nodes: nodes.map((n) => ({ ...n, name: n.label })), links }}
            nodePadding={18}
            nodeWidth={10}
            // 名前を節点の外に書くぶん、左右に余白が要る。
            margin={{ top: 8, right: 92, bottom: 8, left: 8 }}
            /*
              帯は出発側の色を継ぐ。全部を同じ色にすると、どの出発点から
              出た流れなのかが帯を目で辿らないと分からない——サンキーは
              「どこが太いか」を一目で見るための図なので、辿らせた時点で負け。
            */
            link={<Link colors={colors} sources={links.map((l) => l.source)} />}
            node={<Node colors={colors} />}
          >
            <Tooltip
              contentStyle={{
                borderRadius: 4,
                border: "1px solid #e2ded1",
                background: "#fbfaf6",
                fontSize: 12,
              }}
              formatter={(v: number) => formatValue(v, unit)}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>
      {/* どちらが出発でどちらが到着かは、図からは読み取れない。必ず書く。 */}
      <p className="mt-1 text-2xs text-ink-faint">
        左 {fromLabel} ／ 右 {toLabel}
      </p>
    </div>
  );
}
