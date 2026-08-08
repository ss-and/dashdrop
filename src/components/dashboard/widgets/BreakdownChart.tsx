"use client";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
} from "recharts";
import { formatNumber } from "@/lib/utils";
import type { BreakdownData } from "@/lib/widgets";

/**
 * Categorical breakdown widget: donut (PieChart with a centered total) or
 * horizontal bars. Earthy palette mapped from slice color tokens, with a
 * graceful "データなし" state when every value is zero.
 */

const COLOR_HEX: Record<string, string> = {
  khaki: "#8a8250",
  info: "#4a6d80",
  success: "#4f7a53",
  warning: "#b07d38",
  danger: "#a24b3f",
  neutral: "#a8a493",
};
const EMPTY = "#e2ded1";
const GRID = "#e2ded1";
const TEXT = "#57544b";
const FALLBACK = ["khaki", "info", "success", "warning", "danger", "neutral"];

function hexFor(color: string | undefined, i: number): string {
  return COLOR_HEX[color ?? ""] ?? COLOR_HEX[FALLBACK[i % FALLBACK.length]];
}

const tooltipStyle = {
  borderRadius: 6,
  border: "1px solid #e2ded1",
  background: "#fbfaf6",
  fontSize: 12,
  color: TEXT,
} as const;

export function BreakdownChart({ data }: { data: BreakdownData }) {
  const { type, slices, total } = data;
  const empty = slices.length === 0 || total === 0;

  if (empty) {
    return (
      <div className="flex h-56 w-full items-center justify-center text-sm text-ink-faint">
        データなし
      </div>
    );
  }

  if (type === "hbar") {
    const rows = slices.map((s, i) => ({
      ...s,
      fill: hexFor(s.color, i),
    }));
    // Give each bar breathing room; grow the container with the row count.
    const height = Math.max(200, rows.length * 40 + 24);
    return (
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
          >
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fill: TEXT, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fill: TEXT, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={96}
            />
            <Tooltip cursor={{ fill: "rgba(138,130,80,0.06)" }} contentStyle={tooltipStyle} />
            <Bar dataKey="value" radius={[0, 2, 2, 0]} maxBarSize={26} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.label} fill={r.fill} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                style={{ fill: TEXT, fontSize: 11 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Donut
  const rows = slices.map((s, i) => ({ ...s, fill: hexFor(s.color, i) }));
  return (
    <div className="relative h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Pie
            data={rows}
            dataKey="value"
            nameKey="label"
            innerRadius="60%"
            outerRadius="88%"
            paddingAngle={2}
            stroke="none"
            startAngle={90}
            endAngle={-270}
            isAnimationActive={false}
          >
            {rows.map((r) => (
              <Cell key={r.label} fill={r.fill} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {/* Center total */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums text-ink">
          {formatNumber(total, Number.isInteger(total) ? 0 : 1)}
        </span>
        <span className="text-2xs uppercase tracking-wide text-ink-muted">合計</span>
      </div>
    </div>
  );
}
