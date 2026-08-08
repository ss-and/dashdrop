"use client";

import { ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip } from "recharts";
import { percent } from "@/lib/utils";

/**
 * Task-status donut. Muted earthy palette; renders a graceful "データなし"
 * empty ring when there is nothing to show. The center shows the completion
 * rate (完了率).
 */

const COLORS = {
  todo: "#bdb78d", // 未着手 (light khaki)
  doing: "#b07d38", // 進行中 (warning)
  done: "#4f7a53", // 完了 (success)
} as const;

const EMPTY = "#e2ded1"; // muted grid tone for the empty ring
const TEXT = "#57544b";

export interface TaskBreakdown {
  todo: number;
  doing: number;
  done: number;
}

export function TaskDonut({ data }: { data: TaskBreakdown }) {
  const total = data.todo + data.doing + data.done;
  const empty = total === 0;
  const completion = percent(data.done, total);

  const slices = empty
    ? [{ name: "データなし", value: 1, color: EMPTY, muted: true }]
    : [
        { name: "未着手", value: data.todo, color: COLORS.todo },
        { name: "進行中", value: data.doing, color: COLORS.doing },
        { name: "完了", value: data.done, color: COLORS.done },
      ];

  return (
    <div className="relative h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          {!empty && (
            <Tooltip
              contentStyle={{
                borderRadius: 6,
                border: "1px solid #e2ded1",
                background: "#fbfaf6",
                fontSize: 12,
                color: TEXT,
              }}
            />
          )}
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={empty ? 0 : 2}
            stroke="none"
            isAnimationActive={!empty}
          >
            {slices.map((s) => (
              <Cell key={s.name} fill={s.color} />
            ))}
          </Pie>
          {!empty && (
            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: 12, color: TEXT }}
            />
          )}
        </PieChart>
      </ResponsiveContainer>

      {/* Center label */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-6">
        {empty ? (
          <span className="text-sm text-ink-faint">データなし</span>
        ) : (
          <>
            <span className="text-2xl font-semibold tabular-nums text-ink">
              {completion}%
            </span>
            <span className="text-2xs uppercase tracking-wide text-ink-muted">
              完了率
            </span>
          </>
        )}
      </div>
    </div>
  );
}
