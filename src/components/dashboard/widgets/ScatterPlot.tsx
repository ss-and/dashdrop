"use client";

import { useRouter } from "next/navigation";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  CartesianGrid,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  Legend,
} from "recharts";
import { formatCompact } from "@/lib/utils";
import type { ScatterData } from "@/lib/widgets";

/**
 * 散布図。1行 = 1点。
 *
 * 集計は必ず何かを均す。「平均1,000万」で終わると、1億が1件あって残りが
 * 100万なのか、全部が1,000万前後なのかが区別できない。点をそのまま置けば
 * それが一目で分かるし、外れ値を押せばその行まで辿れる。
 */

import {
  seriesColor,
  CHART_GRID as GRID,
  CHART_TEXT as TEXT,
} from "@/lib/palette";
import { usePalette } from "../PaletteContext";

const axisTick = { fill: TEXT, fontSize: 12 } as const;

type Point = ScatterData["points"][number];

function PointTooltip({
  active,
  payload,
  xLabel,
  yLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Point }>;
  xLabel: string;
  yLabel: string;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-md border border-ink-line bg-paper-raised px-3 py-2 text-xs shadow-raised">
      {/* 見出しは「どの行なのか」。数字だけ出しても、どれのことか分からない。 */}
      {p.label && <p className="mb-1 font-medium text-ink">{p.label}</p>}
      {p.group && <p className="mb-1 text-ink-muted">{p.group}</p>}
      <p className="text-ink-soft">
        {xLabel}
        <span className="ml-2 tabular-nums font-medium text-ink">
          {formatCompact(p.x)}
        </span>
      </p>
      <p className="text-ink-soft">
        {yLabel}
        <span className="ml-2 tabular-nums font-medium text-ink">
          {formatCompact(p.y)}
        </span>
      </p>
    </div>
  );
}

export function ScatterPlot({ data }: { data: ScatterData }) {
  const palette = usePalette();
  const { points, groups, xLabel, yLabel, collectionId, omitted } = data;
  const router = useRouter();

  if (points.length === 0) {
    return (
      <div className="flex h-60 w-full items-center justify-center text-sm text-ink-faint">
        データなし
      </div>
    );
  }

  const canDrill = Boolean(collectionId);
  const open = (p: Point) => {
    if (!canDrill || !p.id) return;
    router.push(`/r/${collectionId}/${p.id}`);
  };

  /*
   * 色分けが無いときは1系列にまとめる。区分ごとに Scatter を分けるのは、
   * 凡例と色を Recharts に正しく持たせるため（1系列に色を混ぜると凡例が出ない）。
   */
  const series =
    groups.length > 0
      ? groups.map((g, i) => ({
          label: g.label,
          color: seriesColor(palette, i, g.color),
          rows: points.filter((p) => p.group === g.label),
        }))
      : [{ label: yLabel, color: seriesColor(palette, 0), rows: points }];

  return (
    <div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              name={xLabel}
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tickFormatter={(v: number) => formatCompact(v)}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={yLabel}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={68}
              tickFormatter={(v: number) => formatCompact(v)}
            />
            {/* 点の大きさは固定。面積に意味を持たせない（誤読のもとになる）。 */}
            <ZAxis range={[46, 46]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3", stroke: GRID }}
              content={<PointTooltip xLabel={xLabel} yLabel={yLabel} />}
            />
            {series.length > 1 && (
              <Legend wrapperStyle={{ fontSize: 12, color: TEXT, paddingTop: 8 }} />
            )}
            {series.map((s) => (
              <Scatter
                key={s.label}
                name={s.label}
                data={s.rows}
                fill={s.color}
                fillOpacity={0.75}
                isAnimationActive={false}
                cursor={canDrill ? "pointer" : undefined}
                onClick={(entry: unknown) => open(entry as Point)}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-1 text-2xs text-ink-muted">
        横軸 {xLabel} ／ 縦軸 {yLabel}
        {/* 黙って間引くと「これで全部」と読まれる。落とした分は必ず書く。 */}
        {omitted > 0 && `　※ 表示は先頭 ${points.length.toLocaleString()} 件（残り ${omitted.toLocaleString()} 件は非表示）`}
      </p>
    </div>
  );
}
