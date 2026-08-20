"use client";

import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatValue, formatCompact } from "@/lib/utils";
import { CHART_GRID as GRID, CHART_TEXT as TEXT } from "@/lib/palette";
import { usePalette } from "../PaletteContext";
import type { WaterfallData } from "@/lib/widgets";

/**
 * ウォーターフォール — 増減の内訳。
 *
 * ## 描き方
 *
 * 「浮いた棒」は、透明な下駄（base）の上に色付きの棒（delta）を積んだもの。
 * Recharts に浮遊棒は無いので、同じ stackId に2本積んで下側を透明にする。
 * 素直な実装で、ツールチップと押下判定も普通に効く。
 *
 * ## 色
 *
 * 増加・減少・合計の3色は、テーマではなく意味で決める。増えたぶんが赤で
 * 描かれたら、数字が合っていても読み間違える。合計だけはテーマの色を使う
 * ——これは良し悪しではなく「まとめ」の段なので。
 */

const TOOLTIP_STYLE = {
  borderRadius: 4,
  border: "1px solid #e2ded1",
  background: "#fbfaf6",
  fontSize: 12,
  color: TEXT,
} as const;

const axisTick = { fill: TEXT, fontSize: 12 } as const;

export function WaterfallChart({ data }: { data: WaterfallData }) {
  const palette = usePalette();
  const router = useRouter();
  const { steps, unit, groupBy, collectionId } = data;

  if (steps.length === 0) {
    return (
      <div className="flex h-60 w-full items-center justify-center text-sm text-ink-faint">
        データなし
      </div>
    );
  }

  /*
   * 全部の段が 0 のとき。
   *
   * データが無いわけではなく「増えも減りもしていない」——予実差異のように
   * プラスとマイナスが完全に相殺される列では普通に起きる。そのまま描くと
   * 目盛りだけの空っぽの枠になり、**壊れているようにしか見えない**。
   * 起きたことをそのまま書く。
   */
  if (steps.every((s) => s.value === 0)) {
    return (
      <div className="flex h-60 w-full flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm text-ink-soft">増減なし</p>
        <p className="text-xs text-ink-faint">
          {steps.filter((s) => s.kind !== "total").length} 区分すべてで差引ゼロでした。
        </p>
      </div>
    );
  }

  const colorOf = (kind: string) =>
    kind === "total"
      ? palette.series[0]
      : kind === "decrease"
        ? palette.negative
        : palette.positive;

  const rows = steps.map((s) => ({
    x: s.label,
    base: s.start,
    delta: s.end - s.start,
    value: s.value,
    kind: s.kind,
    key: s.key,
    synthetic: s.synthetic,
  }));

  /*
   * 押したらその区分の行を開く。合計と残余（その他）は複数をまとめた合成なので、
   * 絞り込み先が定まらず押せない。
   */
  const canDrill = Boolean(groupBy && collectionId);
  const drill = (row: (typeof rows)[number]) => {
    if (!canDrill || row.synthetic || row.key === undefined) return;
    router.push(
      `/c/${collectionId}?${new URLSearchParams({ [`f_${groupBy}`]: row.key })}`,
    );
  };

  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            interval={0}
            minTickGap={4}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={68}
            tickFormatter={(v: number) => formatCompact(v)}
          />
          {/* 0 の線。増減の図では基準が見えていないと、上下の意味が読めない。 */}
          <ReferenceLine y={0} stroke={GRID} />
          <Tooltip
            cursor={{ fill: "rgba(28,27,23,0.04)" }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(_v, _n, item) => {
              const r = item?.payload as (typeof rows)[number] | undefined;
              return [r ? formatValue(r.value, unit) : "", "増減"];
            }}
          />
          {/* 下駄。透明なので見えないが、棒を浮かせる高さを作る。 */}
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar
            dataKey="delta"
            stackId="w"
            radius={[2, 2, 0, 0]}
            maxBarSize={48}
            isAnimationActive={false}
            onClick={(_e, index) => drill(rows[index])}
            cursor={canDrill ? "pointer" : undefined}
          >
            {rows.map((r) => (
              <Cell key={r.x} fill={colorOf(r.kind)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
