/**
 * Aggregation engine — turns a WidgetSpec + a workspace's records into a
 * WidgetData the UI renders. Pure and deterministic (given a `now`), so it is
 * fully unit-testable. Used by the dashboard renderer for every widget.
 */
import type {
  WidgetSpec,
  WidgetData,
  Measure,
  Filter,
  KpiWidget,
  SeriesWidget,
  BreakdownWidget,
  TableWidget,
  PivotWidget,
  Unit,
} from "./widgets";

export interface AggRecord {
  id: string;
  data: Record<string, unknown>;
  createdAt: Date | string;
  isSampleData?: boolean;
}

export interface AggCollection {
  slug: string;
  name: string;
  fields: Array<{
    key: string;
    name: string;
    type: string;
    options?: Array<{ label: string; value: string; color?: string }> | null;
  }>;
  records: AggRecord[];
}

export type CollectionMap = Map<string, AggCollection>;

/* ------------------------------ primitives ------------------------------ */

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s¥$€£]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function recordDate(rec: AggRecord, dateField?: string): Date | null {
  if (dateField && dateField !== "createdAt") {
    const d = toDate(rec.data[dateField]);
    if (d) return d;
  }
  return toDate(rec.createdAt);
}

/** ISO-ish date string: "2026-07-19" or "2026-07-19T09:00:00Z". */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Order a value for gt/gte/lt/lte.
 *
 * Dates must be handled before numbers: `Number("2026-07-19")` is NaN, so a
 * range filter on a date column used to match *nothing at all* — silently, with
 * no error. Date values are stored as "YYYY-MM-DD" (coerceValue slices to 10
 * chars), so we parse those to a timestamp and compare on that.
 */
function toComparable(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" && ISO_DATE_RE.test(v)) {
    const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v);
    if (Number.isFinite(t)) return t;
  }
  return toNumber(v);
}

function matchFilter(rec: AggRecord, f: Filter): boolean {
  const v = rec.data[f.field];
  switch (f.op) {
    case "eq":
      return String(v ?? "") === String(f.value ?? "");
    case "neq":
      return String(v ?? "") !== String(f.value ?? "");
    case "in":
      return Array.isArray(f.value)
        ? f.value.map(String).includes(String(v ?? ""))
        : Array.isArray(v)
          ? v.map(String).includes(String(f.value ?? ""))
          : false;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toComparable(v);
      const b = toComparable(f.value);
      if (a === null || b === null) return false;
      if (f.op === "gt") return a > b;
      if (f.op === "gte") return a >= b;
      if (f.op === "lt") return a < b;
      return a <= b;
    }
    case "truthy":
      return Boolean(v) && v !== "false" && v !== "0";
    case "falsy":
      return !v || v === "false" || v === "0";
    default:
      return true;
  }
}

function applyFilters(records: AggRecord[], filters?: Filter[]): AggRecord[] {
  if (!filters || filters.length === 0) return records;
  return records.filter((r) => filters.every((f) => matchFilter(r, f)));
}

function computeMeasure(records: AggRecord[], m: Measure): number {
  if (m.kind === "count") return records.length;
  const nums = records
    .map((r) => toNumber(r.data[m.field]))
    .filter((n): n is number => n !== null);
  if (nums.length === 0) return 0;
  switch (m.kind) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
  }
}

/* ------------------------------ bucketing ------------------------------- */

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const day = (s.getDay() + 6) % 7; // Monday = 0
  s.setDate(s.getDate() - day);
  return s;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function bucketStart(d: Date, bucket: "day" | "week" | "month"): Date {
  if (bucket === "week") return startOfWeek(d);
  if (bucket === "month") return startOfMonth(d);
  return startOfDay(d);
}

function addBucket(d: Date, bucket: "day" | "week" | "month", n: number): Date {
  const c = new Date(d);
  if (bucket === "week") c.setDate(c.getDate() + n * 7);
  else if (bucket === "month") c.setMonth(c.getMonth() + n);
  else c.setDate(c.getDate() + n);
  return c;
}

function bucketLabel(d: Date, bucket: "day" | "week" | "month"): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  if (bucket === "month") return `${d.getFullYear()}/${mm}`;
  return `${mm}/${dd}`;
}

/* ------------------------------- widgets -------------------------------- */

const COLOR_CYCLE = ["khaki", "info", "success", "warning", "danger"];

function computeKpi(w: KpiWidget, col: AggCollection, now: Date): WidgetData {
  const base = applyFilters(col.records, w.filters);
  const unit: Unit = w.unit ?? (w.measure.kind === "count" ? "number" : "number");

  if (w.rateNumerator) {
    const numer = applyFilters(base, w.rateNumerator).length;
    const denom = base.length;
    const value = denom > 0 ? Math.round((numer / denom) * 100) : 0;
    return { type: "kpi", value, unit: "percent", target: w.target };
  }

  let value = computeMeasure(base, w.measure);
  let deltaPercent: number | null | undefined = undefined;

  if (w.delta) {
    // A KPI with a delta is period-scoped: the headline value is THIS period's
    // measure (matching titles like "今週の新規…"), the chip is vs the previous.
    const bucket = w.delta.period === "month" ? "month" : "week";
    const curStart = bucketStart(now, bucket);
    const prevStart = addBucket(curStart, bucket, -1);
    const inRange = (r: AggRecord, from: Date, to: Date) => {
      const d = recordDate(r, w.delta?.dateField);
      return d ? d >= from && d < to : false;
    };
    const cur = computeMeasure(
      base.filter((r) => inRange(r, curStart, addBucket(curStart, bucket, 1))),
      w.measure,
    );
    const prev = computeMeasure(
      base.filter((r) => inRange(r, prevStart, curStart)),
      w.measure,
    );
    value = cur;
    deltaPercent =
      prev === 0 ? (cur === 0 ? 0 : 100) : Math.round(((cur - prev) / prev) * 100);
  }

  return {
    type: "kpi",
    value: Math.round(value * 100) / 100,
    unit,
    deltaPercent,
    target: w.target,
  };
}

function computeSeries(w: SeriesWidget, col: AggCollection, now: Date): WidgetData {
  const bucket = w.bucket;
  const count = w.rangeCount;
  const currentStart = bucketStart(now, bucket);

  // Build the ordered list of bucket starts (oldest → newest).
  const starts: Date[] = [];
  for (let i = count - 1; i >= 0; i--) {
    starts.push(addBucket(currentStart, bucket, -i));
  }

  const filtered = applyFilters(col.records, w.filters);

  const points = starts.map((start) => {
    const end = addBucket(start, bucket, 1);
    const inBucket = filtered.filter((r) => {
      const d = recordDate(r, w.dateField);
      return d ? d >= start && d < end : false;
    });
    const row: Record<string, string | number> = {
      x: bucketLabel(start, bucket),
    };
    w.measures.forEach((sm) => {
      const recs = applyFilters(inBucket, sm.filters);
      row[sm.label] = Math.round(computeMeasure(recs, sm.measure) * 100) / 100;
    });
    return row;
  });

  return {
    type: w.type,
    points,
    stacked: w.stacked,
    series: w.measures.map((sm, i) => ({
      label: sm.label,
      color: sm.color ?? COLOR_CYCLE[i % COLOR_CYCLE.length],
    })),
  };
}

function computeBreakdown(
  w: BreakdownWidget,
  col: AggCollection,
): WidgetData {
  const filtered = applyFilters(col.records, w.filters);
  const field = col.fields.find((f) => f.key === w.groupBy);
  const optionMeta = new Map(
    (field?.options ?? []).map((o) => [o.value, o]),
  );

  const groups = new Map<string, number>();
  for (const r of filtered) {
    const raw = r.data[w.groupBy];
    const keys = Array.isArray(raw)
      ? raw.map((v) => String(v))
      : [raw === null || raw === undefined || raw === "" ? "—" : String(raw)];
    const contribution =
      w.measure.kind === "count"
        ? 1
        : (toNumber(r.data[w.measure.field]) ?? 0);
    for (const k of keys) {
      groups.set(k, (groups.get(k) ?? 0) + contribution);
    }
  }

  let slices = Array.from(groups.entries())
    .map(([key, value]) => {
      const meta = optionMeta.get(key);
      return {
        label: meta?.label ?? key,
        value: Math.round(value * 100) / 100,
        color: meta?.color,
      };
    })
    .sort((a, b) => b.value - a.value);

  // Collapse the long tail into "その他".
  if (slices.length > w.limit) {
    const head = slices.slice(0, w.limit - 1);
    const tail = slices.slice(w.limit - 1);
    head.push({
      label: "その他",
      value: tail.reduce((a, s) => a + s.value, 0),
      color: "neutral",
    });
    slices = head;
  }

  slices.forEach((s, i) => {
    if (!s.color) s.color = COLOR_CYCLE[i % COLOR_CYCLE.length];
  });

  return {
    type: w.type,
    slices,
    total: slices.reduce((a, s) => a + s.value, 0),
  };
}

function computeTable(w: TableWidget, col: AggCollection): WidgetData {
  let rows = applyFilters(col.records, w.filters).slice();
  if (w.sort) {
    const { field, dir } = w.sort;
    rows.sort((a, b) => {
      const av = a.data[field];
      const bv = b.data[field];
      const an = toNumber(av);
      const bn = toNumber(bv);
      let cmp: number;
      if (an !== null && bn !== null) cmp = an - bn;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return dir === "asc" ? cmp : -cmp;
    });
  } else {
    rows.sort((a, b) => {
      const ad = toDate(a.createdAt)?.getTime() ?? 0;
      const bd = toDate(b.createdAt)?.getTime() ?? 0;
      return bd - ad;
    });
  }
  rows = rows.slice(0, w.limit);

  const columns = w.columns.map((key) => {
    const f = col.fields.find((x) => x.key === key);
    return {
      key,
      name: f?.name ?? key,
      type: f?.type ?? "text",
      options: f?.options ?? null,
    };
  });

  return {
    type: "table",
    columns,
    rows: rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const c of w.columns) out[c] = r.data[c];
      return out;
    }),
  };
}

/**
 * Compute a single widget. Returns a null-ish empty WidgetData when the source
 * collection is missing so the renderer can show a graceful empty state.
 */
/**
 * Cross-tab: group down the side by `rowField`, across the top by `colField`,
 * and aggregate `measure` in each cell.
 *
 * The long tail on both axes collapses into 「その他」 so a high-cardinality
 * column can't produce a 500-wide table. Cells with no matching records stay
 * `null` (rendered as 「—」) rather than 0 — "no data" and "zero" are different
 * answers and conflating them misleads.
 */
function computePivot(w: PivotWidget, col: AggCollection): WidgetData {
  const filtered = applyFilters(col.records, w.filters);
  const rowField = col.fields.find((f) => f.key === w.rowField);
  const colField = col.fields.find((f) => f.key === w.colField);
  const labelOf = (f: typeof rowField, key: string) =>
    (f?.options ?? []).find((o) => o.value === key)?.label ?? key;

  /**
   * One bucket per (row, col) pair.
   *
   * `count` only counts records that actually contributed a value, and min/max
   * are tracked separately — matching computeMeasure, which drops records whose
   * measure field isn't numeric. Accumulating only a sum made 最小/最大 print the
   * sum, and made 平均 disagree with the identical KPI tile.
   */
  interface Bucket {
    sum: number;
    count: number;
    min: number | null;
    max: number | null;
  }
  const add = (b: Bucket, v: number): void => {
    b.sum += v;
    b.count += 1;
    b.min = b.min === null || v < b.min ? v : b.min;
    b.max = b.max === null || v > b.max ? v : b.max;
  };
  const emptyBucket = (): Bucket => ({ sum: 0, count: 0, min: null, max: null });

  const cells = new Map<string, Bucket>();
  const rowWeight = new Map<string, number>();
  const colWeight = new Map<string, number>();

  const bucketKeys = (raw: unknown): string[] => {
    if (Array.isArray(raw)) {
      return raw.length ? raw.map((v) => String(v)) : ["—"];
    }
    return [raw === null || raw === undefined || raw === "" ? "—" : String(raw)];
  };

  for (const r of filtered) {
    // A record with a non-numeric measure value contributes nothing at all —
    // not a zero, which would drag averages down and fake a min of 0.
    let contribution: number | null;
    if (w.measure.kind === "count") {
      contribution = 1;
    } else {
      contribution = toNumber(r.data[w.measure.field]);
      if (contribution === null) continue;
    }
    for (const rk of bucketKeys(r.data[w.rowField])) {
      for (const ck of bucketKeys(r.data[w.colField])) {
        const k = `${rk}\u0000${ck}`;
        const cur = cells.get(k) ?? emptyBucket();
        add(cur, contribution);
        cells.set(k, cur);
        // Axis weight ranks which rows/columns survive the limit. Absolute
        // value, so a column of large negatives isn't ranked as the smallest.
        rowWeight.set(rk, (rowWeight.get(rk) ?? 0) + Math.abs(contribution));
        colWeight.set(ck, (colWeight.get(ck) ?? 0) + Math.abs(contribution));
      }
    }
  }

  /** Keep the heaviest N keys; everything else becomes 「その他」. */
  const trim = (weights: Map<string, number>, limit: number): string[] => {
    const sorted = Array.from(weights.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    if (sorted.length <= limit) return sorted;
    return [...sorted.slice(0, limit - 1), OTHER];
  };
  const rowKeys = trim(rowWeight, w.rowLimit);
  const colKeys = trim(colWeight, w.colLimit);
  const rowSet = new Set(rowKeys);
  const colSet = new Set(colKeys);
  const bucketOf = (key: string, keep: Set<string>) =>
    keep.has(key) ? key : OTHER;

  // Re-bin into the trimmed axes, folding the tail into 「その他」.
  const grid = new Map<string, Bucket>();
  for (const [k, v] of cells) {
    const [rk, ck] = k.split("\u0000");
    const gk = `${bucketOf(rk, rowSet)}\u0000${bucketOf(ck, colSet)}`;
    grid.set(gk, mergeBuckets([grid.get(gk), v]) ?? emptyBucket());
  }

  const value = (b: Bucket | undefined): number | null => {
    if (!b || b.count === 0) return null;
    let v: number;
    switch (w.measure.kind) {
      case "avg":
        v = b.sum / b.count;
        break;
      case "min":
        v = b.min ?? 0;
        break;
      case "max":
        v = b.max ?? 0;
        break;
      default: // count / sum
        v = b.sum;
    }
    return Math.round(v * 100) / 100;
  };

  const matrix = rowKeys.map((rk) =>
    colKeys.map((ck) => value(grid.get(`${rk}\u0000${ck}`))),
  );
  const rowTotals = rowKeys.map(
    (rk) => value(mergeBuckets(colKeys.map((ck) => grid.get(`${rk}\u0000${ck}`)))) ?? 0,
  );
  const colTotals = colKeys.map(
    (ck) => value(mergeBuckets(rowKeys.map((rk) => grid.get(`${rk}\u0000${ck}`)))) ?? 0,
  );
  const grandTotal = value(mergeBuckets(Array.from(grid.values()))) ?? 0;

  return {
    type: "pivot",
    rowLabel: rowField?.name ?? w.rowField,
    colLabel: colField?.name ?? w.colField,
    rows: rowKeys.map((k) => (k === OTHER ? OTHER : labelOf(rowField, k))),
    cols: colKeys.map((k) => (k === OTHER ? OTHER : labelOf(colField, k))),
    cells: matrix,
    rowTotals,
    colTotals,
    grandTotal,
    unit: w.unit ?? "number",
    showTotals: w.showTotals,
  };
}

/**
 * Combine buckets so a total is computed from the underlying values, not from
 * the already-aggregated cells (a total of averages is not an average, and a
 * total of minimums is not the minimum).
 */
function mergeBuckets(
  parts: Array<{ sum: number; count: number; min: number | null; max: number | null } | undefined>,
): { sum: number; count: number; min: number | null; max: number | null } | undefined {
  const present = parts.filter(
    (b): b is { sum: number; count: number; min: number | null; max: number | null } =>
      Boolean(b),
  );
  if (present.length === 0) return undefined;
  return present.reduce(
    (a, b) => ({
      sum: a.sum + b.sum,
      count: a.count + b.count,
      min:
        a.min === null ? b.min : b.min === null ? a.min : Math.min(a.min, b.min),
      max:
        a.max === null ? b.max : b.max === null ? a.max : Math.max(a.max, b.max),
    }),
    { sum: 0, count: 0, min: null as number | null, max: null as number | null },
  );
}

const OTHER = "その他";


export function computeWidget(
  widget: WidgetSpec,
  collections: CollectionMap,
  now: Date = new Date(),
): WidgetData {
  const col = collections.get(widget.collection);
  if (!col) {
    // Empty fallbacks per widget type.
    switch (widget.type) {
      case "kpi":
        return { type: "kpi", value: 0, unit: "number" };
      case "line":
      case "area":
      case "bar":
        return { type: widget.type, points: [], series: [] };
      case "donut":
      case "hbar":
        return { type: widget.type, slices: [], total: 0 };
      case "table":
        return { type: "table", columns: [], rows: [] };
      case "pivot":
        return {
          type: "pivot",
          rowLabel: "",
          colLabel: "",
          rows: [],
          cols: [],
          cells: [],
          rowTotals: [],
          colTotals: [],
          grandTotal: 0,
          unit: "number",
          showTotals: false,
        };
    }
  }

  switch (widget.type) {
    case "kpi":
      return computeKpi(widget, col, now);
    case "line":
    case "area":
    case "bar":
      return computeSeries(widget, col, now);
    case "donut":
    case "hbar":
      return computeBreakdown(widget, col);
    case "table":
      return computeTable(widget, col);
    case "pivot":
      return computePivot(widget, col);
  }
}

/** Compute every widget in a layout, pairing each with its spec. */
export function computeDashboard(
  layout: WidgetSpec[],
  collections: CollectionMap,
  now: Date = new Date(),
): Array<{ widget: WidgetSpec; data: WidgetData }> {
  return layout.map((widget) => ({
    widget,
    data: computeWidget(widget, collections, now),
  }));
}
