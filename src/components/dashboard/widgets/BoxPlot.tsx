"use client";

import { useRouter } from "next/navigation";
import { formatValue, formatCompact } from "@/lib/utils";
import { CHART_GRID as GRID, CHART_TEXT as TEXT } from "@/lib/palette";
import { usePalette } from "../PaletteContext";
import type { BoxplotBox, BoxplotData } from "@/lib/widgets";

/**
 * 箱ひげ図 — グループごとの分布を並べて比べる。
 *
 * ## なぜ自前の SVG なのか
 *
 * Recharts に箱ひげは無い。棒＋誤差線で近似すると、四分位と外れ値の
 * 描き分けができない（ひげの端が外れ値なのか柵なのか区別が付かない）。
 * 図としては矩形と直線だけなので、自分で描いたほうが素直で、
 * ツールチップも押下も自分の都合で作れる。
 *
 * ## 読み方
 *
 * 箱が四分位範囲（真ん中の50%）、中の線が中央値、ひげが「外れ値でない範囲」、
 * 点が外れ値。**平均を並べた棒グラフでは絶対に見えない差**——平均10日の2人が
 * 「毎回10日」と「3日と30日が半々」——が、箱の高さの違いとして出る。
 */

const H = 240;
const PAD_TOP = 12;
const PAD_BOTTOM = 34;
const PAD_LEFT = 62;
const PAD_RIGHT = 10;
/** 箱の横幅の上限。1本しかないときに画面いっぱいの箱になるのを防ぐ。 */
const MAX_BOX_W = 56;

/** 目盛りの本数。多いと線だらけになり、少ないと値が読めない。 */
const TICKS = 4;

export function BoxPlot({ data }: { data: BoxplotData }) {
  const palette = usePalette();
  const router = useRouter();
  const { boxes, unit, fieldLabel, groupBy, collectionId } = data;

  const real = boxes.filter((b) => !b.synthetic);
  const dropped = boxes.find((b) => b.synthetic);

  if (real.length === 0) {
    return (
      <div className="flex h-60 w-full items-center justify-center text-sm text-ink-faint">
        データなし
      </div>
    );
  }

  /*
   * 縦の範囲は外れ値まで含める。
   *
   * 外れ値を範囲の外に置いて切り落とすと、図から消えたのか元から無いのかが
   * 区別できない。外れ値こそがこの図の見どころなので、必ず入れる。
   */
  const all = real.flatMap((b) => [b.low, b.high, ...b.outliers]);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  // 全部が同じ値だと範囲が0になり、割り算が壊れる。
  const span = hi - lo || Math.abs(hi) || 1;
  const top = hi + span * 0.08;
  const bottom = lo - span * 0.08;

  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const y = (v: number) =>
    PAD_TOP + plotH * (1 - (v - bottom) / (top - bottom));

  const canDrill = Boolean(groupBy && collectionId);
  const drill = (b: BoxplotBox) => {
    if (!canDrill || b.synthetic || b.key === undefined) return;
    router.push(
      `/c/${collectionId}?${new URLSearchParams({ [`f_${groupBy}`]: b.key })}`,
    );
  };

  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => bottom + ((top - bottom) * i) / TICKS);

  return (
    <div>
      <svg
        viewBox={`0 0 640 ${H}`}
        preserveAspectRatio="none"
        className="h-60 w-full"
        role="img"
        aria-label={`${fieldLabel}の分布（${real.length}区分）`}
      >
        {/* 目盛り */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD_LEFT}
              x2={640 - PAD_RIGHT}
              y1={y(t)}
              y2={y(t)}
              stroke={GRID}
              strokeDasharray="3 3"
            />
            <text
              x={PAD_LEFT - 8}
              y={y(t) + 4}
              textAnchor="end"
              fill={TEXT}
              fontSize={12}
            >
              {formatCompact(t)}
            </text>
          </g>
        ))}

        {real.map((b, i) => {
          const slot = (640 - PAD_LEFT - PAD_RIGHT) / real.length;
          const cx = PAD_LEFT + slot * (i + 0.5);
          const w = Math.min(MAX_BOX_W, slot * 0.6);
          const color = palette.series[i % palette.series.length];
          const boxTop = y(b.q3);
          const boxBottom = y(b.q1);

          return (
            <g
              key={b.label}
              onClick={() => drill(b)}
              style={{ cursor: canDrill ? "pointer" : undefined }}
            >
              <title>
                {`${b.label}（${b.count}件）\n中央値 ${formatValue(b.median, unit)}\n四分位 ${formatValue(b.q1, unit)}〜${formatValue(b.q3, unit)}\nひげ ${formatValue(b.low, unit)}〜${formatValue(b.high, unit)}${b.outliers.length ? `\n外れ値 ${b.outliers.length}件` : ""}`}
              </title>
              {/* ひげ（縦線と上下の帽子） */}
              <line x1={cx} x2={cx} y1={y(b.high)} y2={y(b.low)} stroke={color} strokeWidth={1.5} />
              <line x1={cx - w / 4} x2={cx + w / 4} y1={y(b.high)} y2={y(b.high)} stroke={color} strokeWidth={1.5} />
              <line x1={cx - w / 4} x2={cx + w / 4} y1={y(b.low)} y2={y(b.low)} stroke={color} strokeWidth={1.5} />
              {/* 箱（四分位範囲）。高さ0でも線として見えるように最低1px。 */}
              <rect
                x={cx - w / 2}
                y={boxTop}
                width={w}
                height={Math.max(1, boxBottom - boxTop)}
                fill={color}
                fillOpacity={0.22}
                stroke={color}
                strokeWidth={1.5}
                rx={2}
              />
              {/* 中央値。箱と同じ色だと埋もれるので濃く引く。 */}
              <line
                x1={cx - w / 2}
                x2={cx + w / 2}
                y1={y(b.median)}
                y2={y(b.median)}
                stroke={color}
                strokeWidth={2.5}
              />
              {/* 外れ値 */}
              {b.outliers.map((o, k) => (
                <circle key={k} cx={cx} cy={y(o)} r={2.5} fill={color} fillOpacity={0.85} />
              ))}
              <text
                x={cx}
                y={H - PAD_BOTTOM + 18}
                textAnchor="middle"
                fill={TEXT}
                fontSize={12}
              >
                {b.label.length > 7 ? `${b.label.slice(0, 6)}…` : b.label}
              </text>
              {/*
                件数が少ない箱は形に意味が無い（3件の箱ひげは点の並び）。
                消さずに、そう分かるように件数を添える。
              */}
              <text
                x={cx}
                y={H - PAD_BOTTOM + 31}
                textAnchor="middle"
                fill={b.count < 5 ? "#93392e" : "#6d6a5f"}
                fontSize={10}
              >
                {b.count}件
              </text>
            </g>
          );
        })}
      </svg>

      {dropped && (
        <p className="mt-1 text-2xs text-ink-faint">
          {dropped.label}は表示していません（分布は足し合わせられないため、
          「その他」にまとめられません）。
        </p>
      )}
    </div>
  );
}
