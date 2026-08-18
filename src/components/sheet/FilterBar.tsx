"use client";

import { cn } from "@/lib/utils";
import type { Filter } from "@/lib/widgets";
import type { SheetField } from "./types";

/**
 * On-screen filter bar for the 分析 tab.
 *
 * Everything the user picks here is turned into plain `Filter[]` by
 * `buildFilters()` and appended to every widget's own `filters` before the
 * preview request — so filtering needs no backend work at all.
 */

/* ------------------------------- state ---------------------------------- */

export type RangeKey = "all" | "7d" | "30d" | "90d" | "ytd";

export interface AnalysisFilters {
  /** Which date field the 期間 control applies to (null = sheet has none). */
  dateField: string | null;
  range: RangeKey;
  /** field key -> selected raw value. Empty string / absent = すべて. */
  eq: Record<string, string>;
}

export const RANGE_LABELS: Record<RangeKey, string> = {
  all: "全期間",
  "7d": "過去7日",
  "30d": "過去30日",
  "90d": "過去90日",
  ytd: "今年",
};

const RANGE_ORDER: RangeKey[] = ["all", "7d", "30d", "90d", "ytd"];

export function emptyFilters(fields: SheetField[]): AnalysisFilters {
  return {
    dateField: dateFieldsOf(fields)[0]?.key ?? null,
    range: "all",
    eq: {},
  };
}

export function dateFieldsOf(fields: SheetField[]): SheetField[] {
  return fields.filter((f) => f.type === "date");
}

export function selectFieldsOf(fields: SheetField[]): SheetField[] {
  return fields
    .filter((f) => f.type === "select" && (f.options?.length ?? 0) > 0)
    .slice(0, 3);
}

/* ------------------------------ date range ------------------------------ */

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The first day a preset covers, as "YYYY-MM-DD". null for 全期間. */
export function rangeStart(range: RangeKey, now: Date = new Date()): string | null {
  if (range === "all") return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "ytd") return ymd(new Date(now.getFullYear(), 0, 1));
  const span = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const start = new Date(today);
  start.setDate(start.getDate() - (span - 1));
  return ymd(start);
}

/* ------------------------- filter building --------------------------- */

/** Turn the bar's state into the filters appended to every widget spec. */
export function buildFilters(state: AnalysisFilters): Filter[] {
  const out: Filter[] = [];
  if (state.range !== "all" && state.dateField) {
    // A plain lower bound. The aggregation engine compares dates as timestamps
    // (see toComparable in src/lib/aggregate.ts), so this works for any span —
    // no need to enumerate the individual days.
    const start = rangeStart(state.range);
    if (start) out.push({ field: state.dateField, op: "gte", value: start });
  }
  for (const [field, value] of Object.entries(state.eq)) {
    if (value) out.push({ field, op: "eq", value });
  }
  return out;
}

export function hasActiveFilters(state: AnalysisFilters): boolean {
  return (
    (state.range !== "all" && Boolean(state.dateField)) ||
    Object.values(state.eq).some(Boolean)
  );
}

/** Display label for a stored value, via the field's option list. */
export function labelForValue(field: SheetField | undefined, value: string) {
  return field?.options?.find((o) => o.value === value)?.label ?? value;
}

/* ------------------------------ presentation ---------------------------- */

const controlClass =
  "h-9 rounded border border-ink-rule bg-paper-raised px-2 text-sm text-ink " +
  "transition-colors focus:border-khaki-500 focus:ring-2 focus:ring-khaki-500/25 focus:outline-none";

function ControlLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
      {children}
    </span>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-khaki-100 py-0.5 pl-2 pr-1 text-xs font-medium text-khaki-800">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${label} の条件を外す`}
        title="この条件を外す"
        className="flex h-4 w-4 items-center justify-center rounded text-khaki-700 transition-colors hover:bg-khaki-300 hover:text-khaki-800"
      >
        ×
      </button>
    </span>
  );
}

export function FilterBar({
  fields,
  state,
  onChange,
}: {
  fields: SheetField[];
  state: AnalysisFilters;
  onChange: (next: AnalysisFilters) => void;
}) {
  const dates = dateFieldsOf(fields);
  const selects = selectFieldsOf(fields);
  const active = hasActiveFilters(state);
  const byKey = new Map(fields.map((f) => [f.key, f]));

  // Nothing to offer and nothing switched on — don't draw an empty bar.
  if (dates.length === 0 && selects.length === 0 && !active) return null;

  const eqEntries = Object.entries(state.eq).filter(([, v]) => Boolean(v));
  const dateChipField = state.dateField ? byKey.get(state.dateField) : undefined;

  return (
    <div className="space-y-2 rounded-md border border-ink-line bg-paper-sunken px-3 py-2.5">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        {dates.length > 0 && (
          <div className="flex flex-col gap-1">
            <ControlLabel>期間</ControlLabel>
            <div className="flex items-center gap-1.5">
              <select
                aria-label="期間"
                className={controlClass}
                value={state.range}
                onChange={(e) =>
                  onChange({ ...state, range: e.target.value as RangeKey })
                }
              >
                {RANGE_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {RANGE_LABELS[r]}
                  </option>
                ))}
              </select>
              {dates.length > 1 && (
                <select
                  aria-label="期間の基準となる日付項目"
                  className={controlClass}
                  value={state.dateField ?? dates[0].key}
                  onChange={(e) =>
                    onChange({ ...state, dateField: e.target.value })
                  }
                >
                  {dates.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        {selects.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <ControlLabel>{f.name}</ControlLabel>
            <select
              aria-label={f.name}
              className={cn(controlClass, "max-w-[12rem]")}
              value={state.eq[f.key] ?? ""}
              onChange={(e) =>
                onChange({
                  ...state,
                  eq: { ...state.eq, [f.key]: e.target.value },
                })
              }
            >
              <option value="">すべて</option>
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ))}

        {active && (
          <button
            type="button"
            onClick={() => onChange({ ...state, range: "all", eq: {} })}
            className="h-9 self-end text-sm font-medium text-khaki-700 underline-offset-2 transition-colors hover:text-khaki-800 hover:underline"
          >
            条件をクリア
          </button>
        )}
      </div>

      {active && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-line pt-2">
          <span className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
            適用中
          </span>
          {state.range !== "all" && state.dateField && (
            <Chip
              label={`${dateChipField?.name ?? "期間"}: ${RANGE_LABELS[state.range]}`}
              onRemove={() => onChange({ ...state, range: "all" })}
            />
          )}
          {eqEntries.map(([key, value]) => {
            const field = byKey.get(key);
            return (
              <Chip
                key={key}
                label={`${field?.name ?? key}: ${labelForValue(field, value)}`}
                onRemove={() => {
                  const eq = { ...state.eq };
                  delete eq[key];
                  onChange({ ...state, eq });
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
