"use client";

import { useRouter } from "next/navigation";
import { formatValue } from "@/lib/utils";
import { drillHref } from "@/lib/drill";
import { rgbTriple } from "@/lib/palette";
import { usePalette } from "../PaletteContext";
import { GRID_COLS, GRID_ROWS, PREFECTURES } from "@/lib/japan";
import type { JapanMapData } from "@/lib/widgets";

/**
 * 日本地図（都道府県タイル）。
 *
 * 1県 = 1マス。理由は src/lib/japan.ts に書いてある——本物の輪郭で描くと、
 * 東京都の売上が北海道の面積に負け、しかも小さい県ほど押せなくなる。
 *
 * ## 塗り分け
 *
 * 濃さは「最小〜最大」ではなく「0〜最大」で決める。最小値を白に割り当てると、
 * 47位の県が「データ無し」と同じ見た目になり、**1件も無い県と、少ないが
 * ある県の区別が付かなくなる**。値の無い県は塗らずに枠だけ残す。
 */

const CELL = 30;
const GAP = 3;
/** 濃さの上限。ベタ塗りにすると、上に載せる県名が読めなくなる。 */
const MAX_ALPHA = 0.85;
/** これより濃い升は、文字を白にしないと読めない。 */
const INVERT_TEXT_ABOVE = 0.5;

export function JapanMap({ data }: { data: JapanMapData }) {
  const palette = usePalette();
  const router = useRouter();
  const { values, max, unit, unmatched, groupBy, collectionId } = data;

  const byCode = new Map(values.map((v) => [v.code, v]));
  const rgb = rgbTriple(palette.ramp);
  const canDrill = Boolean(groupBy && collectionId);

  /*
   * 升を押したら、その県の行を開く。
   *
   * 回帰: ここは2つ壊れていた。(1) `?f_都道府県=東京都` という受け側が読まない
   * 形のURLで、絞り込まれていない全件の表が黙って開いていた。(2) 送っていたのが
   * **正規化後の表示名**（p.name）だった——元データが「東京」や「13」や
   * 「東京都渋谷区…」なら、形式が直っても1件も一致しない。
   *
   * 正しくは、集計側がその升に積んだ**生キー**のいずれか、で絞る（in）。
   * 生キーを取り切れなかった県（種類が多すぎる住所列など）は、中途半端に
   * 絞った表を出すより押せないままにする。
   */
  const hrefFor = (hit?: {
    name: string;
    keys: string[];
    keysPartial?: boolean;
  }): string | null => {
    if (!canDrill || !hit || hit.keysPartial || hit.keys.length === 0) return null;
    return drillHref(collectionId!, [
      // ラベルは表示名。チップに「東京都渋谷区1-2-3 ほか37件」とは出さない。
      { op: "in", field: groupBy!, values: hit.keys, label: hit.name },
    ]);
  };

  const W = GRID_COLS * (CELL + GAP);
  const H = GRID_ROWS * (CELL + GAP);

  if (values.length === 0) {
    return (
      <div className="flex h-60 w-full flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm text-ink-soft">都道府県が読み取れませんでした</p>
        {unmatched.count > 0 && (
          <p className="text-xs text-ink-faint">
            {unmatched.count.toLocaleString()} 件の値（例:{" "}
            {unmatched.samples.join("、")}）が都道府県名として読めません。
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`都道府県別（${values.length}県に値あり、最大 ${formatValue(max, unit)}）`}
      >
        {PREFECTURES.map((p) => {
          const hit = byCode.get(p.code);
          // 0 で割らない。全県が同じ値なら、全部を同じ濃さで塗る。
          const alpha =
            hit && max > 0 ? (Math.abs(hit.value) / max) * MAX_ALPHA : 0;
          const x = p.col * (CELL + GAP);
          const y = p.row * (CELL + GAP);
          const href = hrefFor(hit);
          return (
            <g
              key={p.code}
              onClick={() => {
                if (href) router.push(href);
              }}
              style={{ cursor: href ? "pointer" : undefined }}
            >
              <title>
                {hit
                  ? `${p.name} ${formatValue(hit.value, unit)}`
                  : `${p.name} データなし`}
              </title>
              <rect
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                rx={3}
                fill={hit ? `rgba(${rgb}, ${alpha.toFixed(3)})` : "#f4f4f2"}
                stroke={hit ? "#d3d0c8" : "#e4e2dc"}
              />
              <text
                x={x + CELL / 2}
                y={y + CELL / 2 + 4}
                textAnchor="middle"
                fontSize={11}
                fill={
                  !hit
                    ? "#a5a29a"
                    : alpha > INVERT_TEXT_ABOVE
                      ? "#ffffff"
                      : "#4d4a42"
                }
              >
                {/* 升に入るのは2文字まで。「神奈川」は「神奈」になる。 */}
                {p.short.slice(0, 2)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-faint">
        <span>
          値のある県 {values.length} / 47・最大 {formatValue(max, unit)}
        </span>
        {/*
          読めなかった値は、数だけでなく実例も出す。「12件が読めません」だけでは
          何を直せばいいのか分からない。推測で当てにいかないぶん、ここで返す。
        */}
        {unmatched.count > 0 && (
          <span className="text-warning">
            {unmatched.count.toLocaleString()} 件は都道府県として読めませんでした（例:{" "}
            {unmatched.samples.join("、")}）
          </span>
        )}
      </div>
    </div>
  );
}
