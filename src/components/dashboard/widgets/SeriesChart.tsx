"use client";

import {
  ResponsiveContainer,
  LineChart,
  AreaChart,
  BarChart,
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

/**
 * Time-series widget: line / area / bar (from data.type), one series per
 * measure. Earthy palette, honest axes (start at 0), tidy tooltip + legend.
 */

const COLOR_HEX: Record<string, string> = {
  khaki: "#8a8250",
  info: "#4a6d80",
  success: "#4f7a53",
  warning: "#b07d38",
  danger: "#a24b3f",
  neutral: "#a8a493",
};
const GRID = "#e2ded1";
const TEXT = "#57544b";
const FALLBACK = ["khaki", "info", "success", "warning"];

const axisTick = { fill: TEXT, fontSize: 12 } as const;

function hexFor(color: string | undefined, i: number): string {
  return COLOR_HEX[color ?? ""] ?? COLOR_HEX[FALLBACK[i % FALLBACK.length]];
}

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
            <span className="tabular-nums font-medium text-ink">{p.value}</span>
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
      width={36}
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

export function SeriesChart({ data }: { data: SeriesData }) {
  const { type, points, series, stacked } = data;

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
        {type === "area" ? (
          <AreaChart data={points} margin={margin}>
            {axes}
            {series.map((s, i) => {
              const hex = hexFor(s.color, i);
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
                fill={hexFor(s.color, i)}
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
              const hex = hexFor(s.color, i);
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
