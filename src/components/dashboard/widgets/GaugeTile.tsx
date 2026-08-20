"use client";

import { formatValue } from "@/lib/utils";
import { usePalette } from "../PaletteContext";
import type { GaugeData } from "@/lib/widgets";

/**
 * ゲージ — 目標に対して、いまどこか。
 *
 * ## なぜ円グラフ型ではなく弧なのか
 *
 * 「達成率 72%」を円で描くと、残りの 28% も同じ強さの面として描かれる。
 * 見る人が知りたいのは残りではなく**どこまで来たか**なので、下地は薄い溝に
 * 留めて、進んだぶんだけを塗る。半円にしているのは、数字を中央に大きく
 * 置ける形だから——ゲージは図であると同時に、KPI タイルでもある。
 *
 * ## 100% を超えたとき
 *
 * 弧は 100% で止め、超過は数字と色で示す。弧を1周させると「1周と少し」が
 * 「少しだけ」に見えて、達成しているのに未達に読める。
 */

/** 弧の見た目。半円（180度）を左から右へ。 */
const R = 52;
const STROKE = 13;
const CX = 60;
const CY = 60;

/** 半円の弧のパス（左端 → 右端）。 */
const ARC = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
/** 半円の長さ。破線で「進んだぶん」を切り出すのに使う。 */
const ARC_LEN = Math.PI * R;

export function GaugeTile({ data }: { data: GaugeData }) {
  const palette = usePalette();
  const { value, target, unit, ratio, lowerIsBetter } = data;

  /*
   * 色は3段。達成／もう少し／遠い。
   *
   * ここだけはテーマの色を使わない。良し悪しを表す色なので、配色の好みで
   * 緑と赤が入れ替わっては困る（src/lib/palette.ts の考え方と同じ）。
   */
  const tone =
    ratio === null
      ? { arc: palette.series[0], text: "text-ink" }
      : ratio >= 1
        ? { arc: palette.positive, text: "text-success" }
        : ratio >= 0.8
          ? { arc: "#8f6222", text: "text-warning" }
          : { arc: palette.negative, text: "text-danger" };

  const filled = ratio === null ? 0 : Math.max(0, Math.min(1, ratio));
  const percent = ratio === null ? null : Math.round(ratio * 100);

  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <svg
        viewBox="0 0 120 72"
        className="h-[72px] w-[120px]"
        role="img"
        aria-label={
          percent === null
            ? `${formatValue(value, unit)}（目標が0のため達成度は出せません）`
            : `達成度 ${percent}%（${formatValue(value, unit)} / 目標 ${formatValue(target, unit)}）`
        }
      >
        {/* 下地の溝 */}
        <path
          d={ARC}
          fill="none"
          stroke="#e4e2dc"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {/* 進んだぶん。0 のときに線端の丸が点として残らないよう、描かない。 */}
        {filled > 0 && (
          <path
            d={ARC}
            fill="none"
            stroke={tone.arc}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${ARC_LEN * filled} ${ARC_LEN}`}
          />
        )}
      </svg>

      <p className="-mt-4 text-2xl font-semibold tabular-nums text-ink">
        {formatValue(value, unit)}
      </p>
      <p className="text-xs text-ink-muted">
        目標 {formatValue(target, unit)}
        {percent !== null && (
          <>
            <span className="mx-1.5 text-ink-line">/</span>
            <span className={`font-medium ${tone.text}`}>{percent}%</span>
          </>
        )}
        {lowerIsBetter && (
          <span className="ml-1.5 text-ink-faint">（低いほど良い）</span>
        )}
      </p>
    </div>
  );
}
