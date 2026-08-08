/**
 * Single dashboard endpoint.
 * GET    — fetch a dashboard (scoped to the caller's workspace; 404 otherwise).
 * DELETE — remove the Dashboard row. By default the underlying collections and
 *          their data are LEFT INTACT (deleting data is risky). Pass
 *          `?withData=1` to also drop the dashboard's collections (and cascade
 *          their fields + records), scoped to the workspace.
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";

async function findDashboard(workspaceId: string, id: string) {
  const dashboard = await db.dashboard.findFirst({
    where: { id, workspaceId },
  });
  if (!dashboard) throw new ApiError("ダッシュボードが見つかりません", 404);
  return dashboard;
}

function slugsOf(dashboard: { collectionSlugs: unknown }): string[] {
  const raw = dashboard.collectionSlugs;
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
}

export const GET = withAuth(async (_req, { user, params }) => {
  const dashboard = await findDashboard(user.workspace.id, params.id);
  return ok(dashboard);
});

export const DELETE = withAuth(async (req, { user, params }) => {
  const workspaceId = user.workspace.id;
  const dashboard = await findDashboard(workspaceId, params.id);

  const url = new URL(req.url);
  const withData = url.searchParams.get("withData") === "1";

  // Delete the dashboard row first (safe: leaves collections/data intact).
  await db.dashboard.delete({ where: { id: dashboard.id } });

  let deletedCollections = 0;
  if (withData) {
    const slugs = slugsOf(dashboard);
    if (slugs.length > 0) {
      // Scoped to the workspace so we never touch another tenant's data.
      const res = await db.collection.deleteMany({
        where: { workspaceId, slug: { in: slugs } },
      });
      deletedCollections = res.count;
    }
  }

  return ok({ id: dashboard.id, deletedCollections });
});
