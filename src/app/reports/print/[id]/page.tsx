/**
 * Printable report — a clean, chrome-free rendering of a scheduled report's
 * dashboard, suitable for printing or "Save as PDF". Lives OUTSIDE the (app)
 * group so there is no sidebar; it does its own auth + tenant check.
 */
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadDashboardCollections } from "@/lib/apply-template";
import { computeDashboard } from "@/lib/aggregate";
import type { WidgetSpec } from "@/lib/widgets";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { PrintButton } from "@/components/reports/PrintButton";

const FREQ_LABEL: Record<string, string> = {
  daily: "日次",
  weekly: "週次",
  monthly: "月次",
};

export default async function ReportPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const { id } = await params;
  const workspaceId = user.workspace.id;

  const schedule = await db.reportSchedule.findFirst({
    where: { id, workspaceId },
  });
  if (!schedule) notFound();

  const dashboard = await db.dashboard.findFirst({
    where: { id: schedule.dashboardId, workspaceId },
  });
  if (!dashboard) notFound();

  const slugs = Array.isArray(dashboard.collectionSlugs)
    ? dashboard.collectionSlugs.filter((s): s is string => typeof s === "string")
    : [];
  const layout = (dashboard.layout as WidgetSpec[]) ?? [];

  const map = await loadDashboardCollections(workspaceId, slugs);
  const computed = computeDashboard(layout, map);

  const now = new Date();
  const dateLabel = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  const freqLabel = FREQ_LABEL[schedule.frequency] ?? schedule.frequency;

  return (
    <div className="min-h-dvh bg-paper">
      {/* Print rules: hide the toolbar + browser chrome on print. */}
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff; } }`}</style>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4 border-b border-ink-line pb-5">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wide text-khaki-600">
              DashDrop レポート
            </p>
            <h1 className="mt-1 truncate text-xl font-semibold text-ink">
              {dashboard.name}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              {freqLabel}レポート ・ {dateLabel}
            </p>
          </div>
          <div className="no-print shrink-0">
            <PrintButton />
          </div>
        </div>

        {computed.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink-muted">
            表示できるウィジェットがありません。
          </p>
        ) : (
          <DashboardGrid computed={computed} theme={dashboard.theme} />
        )}

        <p className="mt-8 text-2xs text-ink-faint">
          このレポートは DashDrop により生成されました。
        </p>
      </div>
    </div>
  );
}
