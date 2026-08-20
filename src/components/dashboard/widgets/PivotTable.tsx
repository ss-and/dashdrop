import { formatValue } from "./KpiTile";
import type { PivotData } from "@/lib/widgets";

/**
 * Cross-tab (pivot) widget: `rowLabel` down the side, `colLabel` across the
 * top, one aggregated number per intersection.
 *
 * Three things make a cross-tab readable that a plain table does not need:
 *  - `null` (no records matched) renders as 「—」, never as 0. "Nothing here"
 *    and "zero" are different answers and conflating them misleads.
 *  - Cells carry a faint khaki wash proportional to their share of the largest
 *    absolute value, so the shape of the data reads at a glance. The wash tops
 *    out at 12% opacity — enough to see, never enough to fight the text.
 *  - The header row and the header column are sticky, and the whole table
 *    scrolls inside its own container, so a wide cross-tab stays navigable
 *    without ever widening the page.
 */

/**
 * 濃淡の上限。
 *
 * クロス集計は「数字を読む表」なので、色は数字の邪魔をしない程度に留める。
 * ヒートマップは逆で、数字より先に濃淡で全体の形を掴むための図なので、
 * 同じ計算のまま塗りだけを強くする。
 */
const HEAT_MAX_ALPHA = { pivot: 0.12, heatmap: 0.85 } as const;
/** この濃さを超えたら、文字は白でないと読めなくなる。 */
const INVERT_TEXT_ABOVE = 0.45;
/** khaki-500 as an rgb triple (see tailwind.config.ts). */
const HEAT_RGB = "111, 104, 63";

function heatStyle(
  value: number | null,
  max: number,
  variant: PivotData["type"],
): React.CSSProperties | undefined {
  if (value === null || max <= 0) return undefined;
  const alpha = (Math.abs(value) / max) * HEAT_MAX_ALPHA[variant];
  if (alpha <= 0.005) return undefined;
  return {
    backgroundColor: `rgba(${HEAT_RGB}, ${alpha.toFixed(3)})`,
    ...(alpha > INVERT_TEXT_ABOVE ? { color: "#ffffff" } : {}),
  };
}

function Num({ value, unit }: { value: number | null; unit: PivotData["unit"] }) {
  if (value === null) return <span className="text-ink-faint">—</span>;
  return <>{formatValue(value, unit)}</>;
}

// Side-specific border colors so the rules never fight each other: every cell
// gets a hairline bottom, and only the total bands get the stronger rule.
const CELL = "whitespace-nowrap border-b border-b-ink-line px-3 py-2";
const ROW_HEAD = "sticky left-0 border-r border-r-ink-rule text-left";
const TOTAL_EDGE = "border-l-2 border-l-ink-rule";
const TOTAL_TOP = "border-t-2 border-t-ink-rule";
const TOTAL_SURFACE = "bg-paper-sunken font-medium text-ink";

export function PivotTable({ data }: { data: PivotData }) {
  const {
    type,
    rowLabel,
    colLabel,
    rows,
    cols,
    cells,
    rowTotals,
    colTotals,
    grandTotal,
    unit,
    showTotals,
  } = data;

  if (rows.length === 0 || cols.length === 0) {
    return (
      <div className="flex h-40 w-full items-center justify-center text-sm text-ink-faint">
        データなし
      </div>
    );
  }

  // Heat is scaled to the largest absolute *cell* value — totals are excluded
  // so one big row total can't wash out the whole grid.
  let maxAbs = 0;
  for (const row of cells) {
    for (const v of row) {
      if (v !== null) maxAbs = Math.max(maxAbs, Math.abs(v));
    }
  }

  return (
    <div className="w-full min-w-0 space-y-2">
      <p className="text-2xs text-ink-muted">
        行（縦）<span className="text-ink-soft">{rowLabel || "—"}</span>
        <span className="px-1.5 text-ink-faint">/</span>
        列（横）<span className="text-ink-soft">{colLabel || "—"}</span>
      </p>

      <div className="max-h-[28rem] w-full overflow-auto rounded-md border border-ink-line">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">
            {rowLabel} × {colLabel} の
            {type === "heatmap" ? "ヒートマップ" : "クロス集計"}
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className={`${CELL} ${ROW_HEAD} top-0 z-30 bg-paper-sunken text-xs font-semibold text-ink-soft`}
              >
                {rowLabel || "　"}
              </th>
              {cols.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className={`${CELL} sticky top-0 z-20 bg-paper-sunken text-right text-xs font-semibold text-ink-soft`}
                >
                  {c}
                </th>
              ))}
              {showTotals && (
                <th
                  scope="col"
                  className={`${CELL} sticky top-0 z-20 ${TOTAL_EDGE} bg-paper-sunken text-right text-xs font-semibold text-ink-soft`}
                >
                  合計
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {rows.map((r, ri) => (
              <tr key={r}>
                <th
                  scope="row"
                  className={`${CELL} ${ROW_HEAD} z-10 bg-paper-raised font-normal text-ink-soft`}
                >
                  {r}
                </th>
                {cols.map((c, ci) => {
                  const v = cells[ri]?.[ci] ?? null;
                  return (
                    <td
                      key={c}
                      style={heatStyle(v, maxAbs, type)}
                      className={`${CELL} text-right tabular-nums text-ink`}
                    >
                      <Num value={v} unit={unit} />
                    </td>
                  );
                })}
                {showTotals && (
                  <td
                    className={`${CELL} ${TOTAL_EDGE} text-right tabular-nums ${TOTAL_SURFACE}`}
                  >
                    <Num value={rowTotals[ri] ?? 0} unit={unit} />
                  </td>
                )}
              </tr>
            ))}

            {showTotals && (
              <tr>
                <th
                  scope="row"
                  className={`${CELL} ${ROW_HEAD} ${TOTAL_TOP} z-10 ${TOTAL_SURFACE}`}
                >
                  合計
                </th>
                {cols.map((c, ci) => (
                  <td
                    key={c}
                    className={`${CELL} ${TOTAL_TOP} text-right tabular-nums ${TOTAL_SURFACE}`}
                  >
                    <Num value={colTotals[ci] ?? 0} unit={unit} />
                  </td>
                ))}
                <td
                  className={`${CELL} ${TOTAL_EDGE} ${TOTAL_TOP} text-right tabular-nums ${TOTAL_SURFACE}`}
                >
                  <Num value={grandTotal} unit={unit} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
