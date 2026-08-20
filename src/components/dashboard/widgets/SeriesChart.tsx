"use client";

import {
  ResponsiveContainer,
  LineChart,
  AreaChart,
  BarChart,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Line,
  Area,
  Bar,
} from "recharts";
import type { SeriesData } from "@/lib/widgets";
import { formatCompact } from "@/lib/utils";

/**
 * Time-series widget: line / area / bar (from data.type), one series per
 * measure. Earthy palette, honest axes (start at 0), tidy tooltip + legend.
 */

import {
  seriesColor,
  CHART_GRID as GRID,
  CHART_TEXT as TEXT,
  type Palette,
} from "@/lib/palette";
import { usePalette } from "../PaletteContext";

const axisTick = { fill: TEXT, fontSize: 12 } as const;

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-ink-line bg-paper-raised px-3 py-2 text-xs shadow-raised">
      <p className="mb-1 font-medium text-ink">{label}</p>
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={p.name} className="flex items-center gap-2 text-ink-soft">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ backgroundColor: p.color }}
              aria-hidden="true"
            />
            <span className="flex-1">{p.name}</span>
            <span className="tabular-nums font-medium text-ink">
              {typeof p.value === "number" ? formatCompact(p.value) : p.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// NOTE: Recharts identifies axes/grid/legend by walking its DIRECT children and
// does NOT look through React Fragments — so these MUST be returned as a keyed
// array (flattened into the chart's children), never wrapped in <>…</>.
function commonAxes(showLegend: boolean) {
  return [
    <CartesianGrid key="grid" stroke={GRID} strokeDasharray="3 3" vertical={false} />,
    <XAxis
      key="x"
      dataKey="x"
      tick={axisTick}
      tickLine={false}
      axisLine={{ stroke: GRID }}
      minTickGap={16}
    />,
    <YAxis
      key="y"
      allowDecimals={false}
      tick={axisTick}
      tickLine={false}
      axisLine={false}
      /*
       * 36px では 15,000,000 が「000」だけに切れていた。万・億 に丸めたうえで
       * 幅も足す。業務データの金額は8〜9桁が普通なので、生の数字は軸に載らない。
       */
      width={68}
      tickFormatter={(v: number) => formatCompact(v)}
      domain={[0, "auto"]}
    />,
    <Tooltip key="tip" content={<ChartTooltip />} cursor={{ stroke: GRID, strokeWidth: 1 }} />,
    ...(showLegend
      ? [
          <Legend
            key="legend"
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, color: TEXT, paddingTop: 8 }}
          />,
        ]
      : []),
  ];
}

/**
 * 複合グラフ（棒＋線）の中身。
 *
 * 「件数」と「金額」を同じ軸に載せると、件数(10前後)が金額(1,000万前後)の
 * 足元で平らな線になり、片方がまったく読めない。右軸を用意して、系列ごとに
 * どちらの軸に載せるかを決められるようにしてある。
 *
 * commonAxes と同じ理由で、ここも**キー付き配列**を返すこと。ResponsiveContainer
 * は直下の子を clone して width/height を渡すので、独自コンポーネントで包むと
 * 寸法が伝わらず、グラフが何も描かれないまま黙って消える。
 */
function comboChildren(series: SeriesData["series"], palette: Palette) {
  const hasRight = series.some((s) => s.axis === "right");
  const yAxis = (id: "left" | "right") => (
    <YAxis
      key={`y-${id}`}
      yAxisId={id}
      orientation={id}
      allowDecimals={false}
      tick={axisTick}
      tickLine={false}
      axisLine={false}
      width={68}
      tickFormatter={(v: number) => formatCompact(v)}
      domain={[0, "auto"]}
    />
  );

  return [
    <CartesianGrid key="grid" stroke={GRID} strokeDasharray="3 3" vertical={false} />,
    <XAxis
      key="x"
      dataKey="x"
      tick={axisTick}
      tickLine={false}
      axisLine={{ stroke: GRID }}
      minTickGap={16}
    />,
    yAxis("left"),
    ...(hasRight ? [yAxis("right")] : []),
    <Tooltip key="tip" content={<ChartTooltip />} cursor={{ stroke: GRID, strokeWidth: 1 }} />,
    <Legend
      key="legend"
      iconType="plainline"
      wrapperStyle={{ fontSize: 12, color: TEXT, paddingTop: 8 }}
    />,
    ...series.map((s, i) => {
      const hex = seriesColor(palette, i, s.color);
      // 右軸を出していないのに yAxisId="right" を指すと、その系列は
      // 描かれずに黙って消える。存在する軸にだけ載せる。
      const yAxisId = hasRight && s.axis === "right" ? "right" : "left";
      if (s.as === "line") {
        return (
          <Line
            key={s.label}
            yAxisId={yAxisId}
            type="monotone"
            dataKey={s.label}
            name={s.label}
            stroke={hex}
            strokeWidth={2}
            dot={{ r: 2, fill: hex }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        );
      }
      if (s.as === "area") {
        return (
          <Area
            key={s.label}
            yAxisId={yAxisId}
            type="monotone"
            dataKey={s.label}
            name={s.label}
            stroke={hex}
            fill={hex}
            fillOpacity={0.15}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        );
      }
      return (
        <Bar
          key={s.label}
          yAxisId={yAxisId}
          dataKey={s.label}
          name={s.label}
          fill={hex}
          radius={[2, 2, 0, 0]}
          maxBarSize={40}
          isAnimationActive={false}
        />
      );
    }),
  ];
}

export function SeriesChart({ data }: { data: SeriesData }) {
  const { type, points, series, stacked } = data;
  const palette = usePalette();

  if (points.length === 0 || series.length === 0) {
    return (
      <div className="flex h-60 w-full items-center justify-center text-sm text-ink-faint">
        データなし
      </div>
    );
  }

  const margin = { top: 8, right: 12, bottom: 0, left: -8 };
  const showLegend = series.length > 1;
  const axes = commonAxes(showLegend);

  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {type === "combo" ? (
          <ComposedChart data={points} margin={margin}>
            {comboChildren(series, palette)}
          </ComposedChart>
        ) : type === "area" ? (
          <AreaChart data={points} margin={margin}>
            {axes}
            {series.map((s, i) => {
              const hex = seriesColor(palette, i, s.color);
              return (
                <Area
                  key={s.label}
                  type="monotone"
                  dataKey={s.label}
                  name={s.label}
                  stackId={stacked ? "stack" : undefined}
                  stroke={hex}
                  fill={hex}
                  fillOpacity={0.15}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              );
            })}
          </AreaChart>
        ) : type === "bar" ? (
          <BarChart data={points} margin={margin}>
            {axes}
            {series.map((s, i) => (
              <Bar
                key={s.label}
                dataKey={s.label}
                name={s.label}
                stackId={stacked ? "stack" : undefined}
                fill={seriesColor(palette, i, s.color)}
                radius={[2, 2, 0, 0]}
                maxBarSize={40}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart data={points} margin={margin}>
            {axes}
            {series.map((s, i) => {
              const hex = seriesColor(palette, i, s.color);
              return (
                <Line
                  key={s.label}
                  type="monotone"
                  dataKey={s.label}
                  name={s.label}
                  stroke={hex}
                  strokeWidth={2}
                  dot={{ r: 2, fill: hex }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
