"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

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
import { formatCompact } from "@/lib/utils";
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
const TEXT = "#57544b";
const GRID = "#e2ded1";
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
  const { type, slices, total, groupBy, collectionId } = data;
  const empty = slices.length === 0 || total === 0;
  const router = useRouter();

  /*
   * ひと切れ押したら、その内訳の行を開く。
   *
   * 「フェーズB が 3,600万」で終わってしまうと、どの案件なのかに辿り着けない。
   * 残余（その他）は複数の値をまとめた合成なので、絞り込み先が定まらず押せない。
   */
  const canDrill = Boolean(groupBy && collectionId);
  const drillTo = (slice: { key?: string; synthetic?: boolean }) => {
    if (!canDrill || slice.synthetic || slice.key === undefined) return;
    router.push(
      `/c/${collectionId}?f=${encodeURIComponent(groupBy!)}&v=${encodeURIComponent(slice.key)}`,
    );
  };

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
              tickFormatter={(v: number) => formatCompact(v)}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fill: TEXT, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              /*
               * 日本語の会社名は 96px では頭が切れて「ィンテック・ラボ」のように
               * 読めなくなる。幅を広げ、それでも溢れる分だけ末尾を省略する。
               */
              width={150}
              tickFormatter={(v: string) =>
                v.length > 11 ? `${v.slice(0, 10)}…` : v
              }
            />
            <Tooltip cursor={{ fill: "rgba(138,130,80,0.06)" }} contentStyle={tooltipStyle} />
            <Bar
              dataKey="value"
              radius={[0, 2, 2, 0]}
              maxBarSize={26}
              isAnimationActive={false}
              onClick={(_: unknown, index: number) => drillTo(rows[index])}
              cursor={canDrill ? "pointer" : undefined}
            >
              {rows.map((r) => (
                <Cell key={r.label} fill={r.fill} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                style={{ fill: TEXT, fontSize: 11 }}
                formatter={(v: number) => formatCompact(v)}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Donut
  const rows = slices.map((s, i) => ({ ...s, fill: hexFor(s.color, i) }));
  const chart = (
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
            onClick={(_: unknown, index: number) => drillTo(rows[index])}
            cursor={canDrill ? "pointer" : undefined}
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
          {formatCompact(total)}
        </span>
        <span className="text-2xs uppercase tracking-wide text-ink-muted">合計</span>
      </div>
    </div>
  );

  /*
   * 凡例。色だけ塗られた円は「どの色がどのフェーズか」が分からず読めない。
   * ここを本物のリンクにすることで、読めるようにするのと、明細へ辿れるように
   * するのを同時に片付ける（円弧そのもののクリックは、ドーナツの穴の上では
   * 当たらないので、これが確実な導線になる）。
   */
  const legend = (
    <ul className="mt-2 space-y-0.5">
      {rows.map((r) => {
        const label = (
          <>
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: r.fill }}
            />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums text-ink-muted">
              {formatCompact(r.value)}
            </span>
          </>
        );
        const cls =
          "flex items-center gap-2 rounded px-2 py-1 text-sm text-ink-soft";
        return (
          <li key={r.label}>
            {canDrill && !r.synthetic && r.key !== undefined ? (
              <Link
                href={`/c/${collectionId}?f=${encodeURIComponent(groupBy!)}&v=${encodeURIComponent(r.key)}`}
                className={`${cls} transition-colors duration-fast hover:bg-paper-sunken hover:text-ink active:bg-ink-line`}
              >
                {label}
              </Link>
            ) : (
              <span className={cls}>{label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div>
      {chart}
      {legend}
    </div>
  );
}
