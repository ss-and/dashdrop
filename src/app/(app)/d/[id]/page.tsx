/**
 * Dashboard renderer — loads a workspace-scoped dashboard, computes each widget
 * against its collections' records, and renders them on a 4-column grid.
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadDashboardCollections } from "@/lib/apply-template";
import { computeDashboard } from "@/lib/aggregate";
import type { WidgetSpec } from "@/lib/widgets";
import { Topbar } from "@/components/app/Topbar";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { DashboardActions } from "@/components/dashboard/DashboardActions";

export default async function DashboardRendererPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const { id } = await params;
  const workspaceId = user.workspace.id;

  const dashboard = await db.dashboard.findFirst({
    where: { id, workspaceId },
  });
  if (!dashboard) redirect("/dashboards");

  const slugs = Array.isArray(dashboard.collectionSlugs)
    ? dashboard.collectionSlugs.filter((s): s is string => typeof s === "string")
    : [];
  const layout = (dashboard.layout as WidgetSpec[]) ?? [];

  const map = await loadDashboardCollections(workspaceId, slugs);
  const computed = computeDashboard(layout, map);

  // Sample-data banner + "テーブルを開く" target (first collection by slug order).
  const hasSampleData = Array.from(map.values()).some((c) =>
    c.records.some((r) => r.isSampleData),
  );

  const collectionRows = await db.collection.findMany({
    where: { workspaceId, slug: { in: slugs } },
    select: { id: true, slug: true },
  });
  const bySlug = new Map(collectionRows.map((c) => [c.slug, c.id]));
  const firstCollectionId = slugs.map((s) => bySlug.get(s)).find(Boolean);

  return (
    <>
      <Topbar user={user} title={dashboard.name} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          {/* Header row */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-ink">
                {dashboard.name}
              </h2>
              {dashboard.description && (
                <p className="mt-0.5 text-sm text-ink-muted">
                  {dashboard.description}
                </p>
              )}
            </div>
            <DashboardActions
              dashboardId={dashboard.id}
              firstCollectionId={firstCollectionId}
              hasSampleData={hasSampleData}
            />
          </div>

          {/* Sample-data notice */}
          {hasSampleData && (
            <div className="rounded-md border border-warning/20 bg-warning-soft px-4 py-3 text-sm text-warning">
              サンプルデータが含まれています。実データを入力するか、上の「サンプルデータを削除」で置き換えられます。
            </div>
          )}

          {/* Widgets */}
          {computed.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-muted">
              表示できるウィジェットがありません。
            </p>
          ) : (
            <DashboardGrid computed={computed} />
          )}
        </div>
      </main>
    </>
  );
}
