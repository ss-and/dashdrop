import { cn, formatNumber } from "@/lib/utils";

type Tone = "success" | "danger" | "neutral";

export interface StatTileProps {
  /** Small uppercase caption above the value. */
  label: string;
  /** Primary figure (formatted with thousands separators). */
  value: number;
  /** Signed percentage change; omit to hide the delta chip. */
  delta?: number;
  /** Extra caption next to the delta, e.g. "前週比". */
  deltaLabel?: string;
  /**
   * Force the delta chip tone. When omitted it is inferred from the sign of
   * `delta` (positive → success, negative → danger, zero → neutral).
   */
  tone?: Tone;
}

const toneStyles: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-paper-sunken text-ink-muted",
};

/**
 * A calm KPI tile: uppercase label, large value, and an optional delta chip.
 * Deliberately low-radius and quiet so a row of them reads as one system.
 */
export function StatTile({ label, value, delta, deltaLabel, tone }: StatTileProps) {
  const resolvedTone: Tone =
    tone ?? (delta === undefined || delta === 0 ? "neutral" : delta > 0 ? "success" : "danger");
  const arrow = delta === undefined || delta === 0 ? "" : delta > 0 ? "▲" : "▼";

  return (
    <div className="card px-5 py-4">
      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums text-ink">
          {formatNumber(value)}
        </span>
        {delta !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-xs font-medium tabular-nums",
              toneStyles[resolvedTone],
            )}
          >
            {arrow && <span aria-hidden="true">{arrow}</span>}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      {deltaLabel && (
        <p className="mt-1 text-2xs text-ink-faint">{deltaLabel}</p>
      )}
    </div>
  );
}
