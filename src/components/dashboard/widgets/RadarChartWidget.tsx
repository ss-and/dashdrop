"use client";

import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { formatValue } from "@/lib/utils";
import {
  seriesColor,
  CHART_GRID as GRID,
  CHART_TEXT as TEXT,
} from "@/lib/palette";
import { usePalette } from "../PaletteContext";
import type { RadarData } from "@/lib/widgets";

/**
 * レーダー — 同じ物差しで測った、形の違い。
 *
 * 指標を1つに絞ってあるのは集計側の決まり（src/lib/widgets.ts）。件数と金額を
 * 1枚に重ねると半径の意味が2つになり、1万円と1件がどちらも「外側」に描かれる。
 *
 * 軸が3本未満のときは多角形にならない（線か点になる）ので描かない。
 * 「グラフが潰れている」ではなく「この列では作れない」と書くほうが親切。
 */
export function RadarChartWidget({ data }: { data: RadarData }) {
  const palette = usePalette();
  const { axes, series, unit, max } = data;

  if (axes.length < 3 || series.length === 0) {
    return (
      <div className="flex h-60 w-full flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm text-ink-soft">レーダーにできませんでした</p>
        <p className="text-xs text-ink-faint">
          軸が {axes.length} 本しかありません（3本以上必要です）。
        </p>
      </div>
    );
  }

  // Recharts は「1軸 = 1オブジェクト」を求めるので、系列を横に展開する。
  const rows = axes.map((axis, i) => {
    const row: Record<string, string | number> = { axis };
    for (const s of series) row[s.label] = s.values[i];
    return row;
  });

  return (
    <div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={rows} outerRadius="72%">
            <PolarGrid stroke={GRID} />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fill: TEXT, fontSize: 12 }}
            />
            {/*
            半径の目盛りは数字を出さない。
            レーダーの目盛りは多角形の**内側**にしか置けないので、真上に
            立てれば軸ラベルと重なり（「Web」の上に「2,400万」が乗った）、
            斜めにずらせば今度は塗りの上に乗って読めない。どこへ置いても
            邪魔になるので、外周の値は図の下に1行で書き、個々の値は
            ツールチップで出す。格子は形を読むのに要るので残す。
          */}
            <PolarRadiusAxis tick={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                borderRadius: 4,
                border: "1px solid #e2ded1",
                background: "#fbfaf6",
                fontSize: 12,
              }}
              formatter={(v: number, name: string) => [
                formatValue(v, unit),
                name,
              ]}
            />
            {series.length > 1 && (
              <Legend
                wrapperStyle={{ fontSize: 12, color: TEXT, paddingTop: 4 }}
              />
            )}
            {series.map((s, i) => {
              const hex = seriesColor(palette, i, s.color);
              return (
                <Radar
                  key={s.label}
                  name={s.label}
                  dataKey={s.label}
                  stroke={hex}
                  fill={hex}
                  /*
                   * 塗りは薄く。多角形を重ねる図なので、濃いと後ろの形が
                   * 完全に隠れる——比べるために重ねているのに、比べられなくなる。
                   */
                  fillOpacity={series.length > 1 ? 0.18 : 0.3}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              );
            })}
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-2xs text-ink-faint">
        外周 = {formatValue(max, unit)}（各点の値は図に触れると出ます）
      </p>
    </div>
  );
}
