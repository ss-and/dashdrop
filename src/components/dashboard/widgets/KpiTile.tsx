import { cn, formatNumber } from "@/lib/utils";
import type { KpiData } from "@/lib/widgets";

/**
 * A single KPI figure: a large value formatted by unit, an optional period
 * delta chip, and an optional target with a thin progress bar. Calm and
 * low-radius, in keeping with the earthy design system.
 */

function formatValue(value: number, unit: KpiData["unit"]): string {
  switch (unit) {
    case "currency":
      return `¥${formatNumber(Math.round(value))}`;
    case "percent":
      return `${formatNumber(value)}%`;
    case "days":
      return `${formatNumber(value)}日`;
    case "number":
    default:
      // Keep up to one decimal for fractional measures (e.g. averages).
      return formatNumber(value, Number.isInteger(value) ? 0 : 1);
  }
}

export function KpiTile({ data }: { data: KpiData }) {
  const { value, unit, deltaPercent, target } = data;

  const hasDelta = deltaPercent !== undefined && deltaPercent !== null;
  const deltaTone =
    !hasDelta || deltaPercent === 0
      ? "neutral"
      : deltaPercent > 0
        ? "up"
        : "down";

  const progress =
    target && target > 0 ? Math.min(100, Math.round((value / target) * 100)) : null;

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <div className="flex items-end justify-between gap-2">
        <span className="text-3xl font-semibold tabular-nums leading-none text-ink">
          {formatValue(value, unit)}
        </span>
        {hasDelta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-sm border px-1.5 py-0.5 text-xs font-medium tabular-nums",
              deltaTone === "up" &&
                "border-success/20 bg-success-soft text-success",
              deltaTone === "down" &&
                "border-danger/20 bg-danger-soft text-danger",
              deltaTone === "neutral" &&
                "border-ink-line bg-paper-sunken text-ink-muted",
            )}
            aria-label={`前期比 ${deltaPercent}%`}
          >
            {deltaTone === "up" ? "▲" : deltaTone === "down" ? "▼" : "±"}
            {Math.abs(deltaPercent as number)}%
          </span>
        )}
      </div>

      {target !== undefined && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-2xs text-ink-muted">
            <span>目標 {formatValue(target, unit)}</span>
            {progress !== null && (
              <span className="tabular-nums">{progress}%</span>
            )}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-sm bg-paper-sunken">
            <div
              className="h-full rounded-sm bg-khaki-500 transition-all"
              style={{ width: `${progress ?? 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
