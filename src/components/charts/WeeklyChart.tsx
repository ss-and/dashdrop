"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Area,
  Line,
} from "recharts";
import type { DailyPoint } from "@/lib/metrics";

/**
 * Restrained, earthy weekly performance chart. Honest axes (start at 0),
 * a single muted palette, and direct legend labels — no gradients or neon.
 */

// Earthy palette (kept in sync with the design tokens).
const KHAKI = "#8a8250"; // new inquiries (area)
const SUCCESS = "#4f7a53"; // resolved inquiries (line)
const INFO = "#4a6d80"; // tasks completed (soft series)
const GRID = "#e2ded1";
const TEXT = "#57544b";

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
            <span className="tabular-nums font-medium text-ink">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WeeklyChart({ data }: { data: DailyPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
        >
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: GRID }}
          />
          <YAxis
            allowDecimals={false}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: GRID, strokeWidth: 1 }}
          />
          <Legend
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, color: TEXT, paddingTop: 8 }}
          />
          <Area
            type="monotone"
            dataKey="inquiriesCreated"
            name="新規問い合わせ"
            stroke={KHAKI}
            fill={KHAKI}
            fillOpacity={0.15}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="inquiriesResolved"
            name="対応済み"
            stroke={SUCCESS}
            strokeWidth={2}
            dot={{ r: 2, fill: SUCCESS }}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="tasksCompleted"
            name="タスク完了"
            stroke={INFO}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
