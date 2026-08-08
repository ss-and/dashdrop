/**
 * Dashboard metrics.
 *
 * Computes the weekly performance figures that power the dashboard home:
 * a 7-day daily series (from the Activity stream), week-over-week totals with
 * deltas, live counts of open inquiries / task status, and workspace totals.
 *
 * All figures are tenant-scoped by the caller-supplied workspaceId. Every query
 * is defensive: the result is well-defined even for a brand-new, empty
 * workspace (zeros everywhere, a 7-day series of zero points).
 */
import { db } from "./db";
import { percent } from "./utils";

/** One calendar day in the weekly series. */
export interface DailyPoint {
  /** Short human label, e.g. "08/03". */
  date: string;
  /** ISO date (YYYY-MM-DD) for the day bucket. */
  iso: string;
  inquiriesCreated: number;
  inquiriesResolved: number;
  tasksCompleted: number;
}

/** A single week-over-week total with an integer percent delta. */
export interface TotalDelta {
  value: number;
  /** Integer percent change vs the previous 7 days (divide-by-zero guarded). */
  deltaPercent: number;
}

export interface WeeklyMetrics {
  series: DailyPoint[];
  totals: {
    newInquiries: TotalDelta;
    resolvedInquiries: TotalDelta;
    tasksCompleted: TotalDelta;
  };
  /** Records in inquiry-template collections whose status is not "resolved". */
  openInquiries: number;
  /** Resolved / new inquiries this week, as an integer percentage 0–100. */
  resolutionRate: number;
  taskBreakdown: { todo: number; doing: number; done: number };
  totalRecords: number;
  totalCollections: number;
}

/** Local YYYY-MM-DD key for a date (calendar-day bucketing). */
function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "MM/DD" label for a date. */
function shortDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}/${day}`;
}

/** Integer percent change from `prev` to `curr`, guarding divide-by-zero. */
function deltaPercent(curr: number, prev: number): number {
  if (prev <= 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

/**
 * Given an Activity's `meta` JSON, decide whether a `record.created` event
 * belongs to an inquiry-template collection. We accept a few shapes so the
 * metric stays correct regardless of exactly how the event was logged:
 * an explicit `collection: "inquiries"` / `template: "inquiry"` hint, or a
 * `collectionId` that resolves to a known inquiry collection.
 */
function metaIsInquiry(
  meta: unknown,
  inquiryCollectionIds: Set<string>,
): boolean {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Record<string, unknown>;
  if (m.collection === "inquiries" || m.collection === "inquiry") return true;
  if (m.template === "inquiry") return true;
  if (typeof m.collectionId === "string" && inquiryCollectionIds.has(m.collectionId)) {
    return true;
  }
  return false;
}

export async function getWeeklyMetrics(
  workspaceId: string,
): Promise<WeeklyMetrics> {
  // --- Day buckets ----------------------------------------------------------
  // 7 days ending today (inclusive). The previous-week window is the 7 days
  // immediately before that, used only for delta comparison.
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const days: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    days.push(new Date(startOfToday.getTime() - i * 86_400_000));
  }
  const thisWeekStart = days[0]; // midnight, 6 days ago
  const prevWeekStart = new Date(thisWeekStart.getTime() - 7 * 86_400_000);

  // --- Collections (also gives us template membership + total count) --------
  const collections = await db.collection.findMany({
    where: { workspaceId },
    select: { id: true, template: true },
  });
  const inquiryIds = new Set(
    collections.filter((c) => c.template === "inquiry").map((c) => c.id),
  );
  const taskIds = new Set(
    collections.filter((c) => c.template === "task").map((c) => c.id),
  );

  // --- Activity stream (covers both weeks in one query) ---------------------
  const activities = await db.activity.findMany({
    where: { workspaceId, createdAt: { gte: prevWeekStart } },
    select: { type: true, meta: true, createdAt: true },
  });

  // Seed the 7-day series with zero points, indexed by iso day.
  const byDay = new Map<string, DailyPoint>();
  const series: DailyPoint[] = days.map((d) => {
    const point: DailyPoint = {
      date: shortDay(d),
      iso: isoDay(d),
      inquiriesCreated: 0,
      inquiriesResolved: 0,
      tasksCompleted: 0,
    };
    byDay.set(point.iso, point);
    return point;
  });

  // Week totals (this week vs previous 7 days).
  let newThis = 0,
    newPrev = 0,
    resThis = 0,
    resPrev = 0,
    taskThis = 0,
    taskPrev = 0;

  for (const a of activities) {
    const created = a.createdAt;
    const inThisWeek = created >= thisWeekStart;
    const key = isoDay(created);

    if (a.type === "record.created" && metaIsInquiry(a.meta, inquiryIds)) {
      if (inThisWeek) {
        newThis++;
        const p = byDay.get(key);
        if (p) p.inquiriesCreated++;
      } else {
        newPrev++;
      }
    } else if (a.type === "inquiry.resolved") {
      if (inThisWeek) {
        resThis++;
        const p = byDay.get(key);
        if (p) p.inquiriesResolved++;
      } else {
        resPrev++;
      }
    } else if (a.type === "task.completed") {
      if (inThisWeek) {
        taskThis++;
        const p = byDay.get(key);
        if (p) p.tasksCompleted++;
      } else {
        taskPrev++;
      }
    }
  }

  // --- Live state: open inquiries + task status breakdown -------------------
  // Read only the `data` JSON of the relevant collections' records and reduce
  // in JS (SQLite JSON filtering is unreliable across providers).
  let openInquiries = 0;
  if (inquiryIds.size > 0) {
    const rows = await db.record.findMany({
      where: { collectionId: { in: [...inquiryIds] } },
      select: { data: true },
    });
    for (const r of rows) {
      const status = (r.data as Record<string, unknown> | null)?.status;
      if (status !== "resolved") openInquiries++;
    }
  }

  const taskBreakdown = { todo: 0, doing: 0, done: 0 };
  if (taskIds.size > 0) {
    const rows = await db.record.findMany({
      where: { collectionId: { in: [...taskIds] } },
      select: { data: true },
    });
    for (const r of rows) {
      const status = (r.data as Record<string, unknown> | null)?.status;
      if (status === "done") taskBreakdown.done++;
      else if (status === "doing") taskBreakdown.doing++;
      else taskBreakdown.todo++; // todo + anything unset/unknown
    }
  }

  // --- Workspace totals -----------------------------------------------------
  const totalRecords = await db.record.count({
    where: { collection: { workspaceId } },
  });

  return {
    series,
    totals: {
      newInquiries: { value: newThis, deltaPercent: deltaPercent(newThis, newPrev) },
      resolvedInquiries: { value: resThis, deltaPercent: deltaPercent(resThis, resPrev) },
      tasksCompleted: { value: taskThis, deltaPercent: deltaPercent(taskThis, taskPrev) },
    },
    openInquiries,
    resolutionRate: percent(resThis, newThis),
    taskBreakdown,
    totalRecords,
    totalCollections: collections.length,
  };
}
