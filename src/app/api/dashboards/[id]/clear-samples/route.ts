/**
 * Clear the sample (demo) rows seeded when a dashboard template was applied.
 * POST — deletes every Record with isSampleData=true across the dashboard's
 * collections (scoped to the workspace), leaving real user-entered rows intact.
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";

export const POST = withAuth(async (_req, { user, params }) => {
  const workspaceId = user.workspace.id;

  const dashboard = await db.dashboard.findFirst({
    where: { id: params.id, workspaceId },
  });
  if (!dashboard) throw new ApiError("ダッシュボードが見つかりません", 404);

  const slugs = Array.isArray(dashboard.collectionSlugs)
    ? dashboard.collectionSlugs.filter((s): s is string => typeof s === "string")
    : [];

  if (slugs.length === 0) return ok({ deleted: 0 });

  // Resolve collection ids within the workspace (tenant-safe).
  const collections = await db.collection.findMany({
    where: { workspaceId, slug: { in: slugs } },
    select: { id: true },
  });
  const collectionIds = collections.map((c) => c.id);
  if (collectionIds.length === 0) return ok({ deleted: 0 });

  const res = await db.record.deleteMany({
    where: { collectionId: { in: collectionIds }, isSampleData: true },
  });

  return ok({ deleted: res.count });
});
