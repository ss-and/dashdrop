/**
 * Single collection endpoint.
 * GET    — fetch a collection (fields ordered + record count).
 * PATCH  — update name/description/icon/color.
 * DELETE — remove the collection (cascade drops its fields & records).
 *          通知ルールは外部キーではなく id を持っているだけなので、
 *          ここで一緒に消さないと、存在しないシートを見張り続ける
 *          壊れたルールが残る。
 */
import { withAuth, ok, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { updateCollectionSchema } from "@/lib/validation";
import { getCollectionForUser, logActivity } from "@/lib/workspace";
import {
  collectDeleteImpact,
  deleteCollections,
  deleteEmptiedDashboards,
} from "@/lib/data-delete";

export const GET = withAuth(async (_req, { user, params }) => {
  const collection = await getCollectionForUser(user, params.id);
  const recordCount = await db.record.count({
    where: { collectionId: collection.id },
  });
  return ok({ ...collection, recordCount });
});

export const PATCH = withAuth(async (req, { user, params }) => {
  // Scope first so foreign collections 404 before any write.
  await getCollectionForUser(user, params.id);
  const input = await readJson(req, updateCollectionSchema);

  const collection = await db.collection.update({
    where: { id: params.id },
    data: {
      name: input.name,
      description: input.description,
      icon: input.icon,
      color: input.color,
    },
    include: { fields: { orderBy: { position: "asc" } } },
  });
  return ok(collection);
});

export const DELETE = withAuth(async (req, { user, params }) => {
  const collection = await getCollectionForUser(user, params.id);
  const workspaceId = user.workspace.id;

  const impact = await collectDeleteImpact(
    workspaceId,
    [collection.id],
    [collection.slug],
  );
  await deleteCollections(workspaceId, [collection.id]);

  // 見るものが1つも無くなるダッシュボードは、選ばれたときだけ一緒に消す。
  const alsoDashboards =
    new URL(req.url).searchParams.get("dashboards") === "delete";
  const removedDashboards = alsoDashboards
    ? await deleteEmptiedDashboards(
        workspaceId,
        impact.emptiedDashboards.map((d) => d.id),
      )
    : 0;

  await logActivity(workspaceId, "collection.deleted", {
    collectionId: collection.id,
    name: collection.name,
    rows: impact.recordCount,
    dashboards: removedDashboards,
  });

  return ok({
    id: params.id,
    rows: impact.recordCount,
    affectedDashboards: impact.affectedDashboards,
    removedDashboards,
  });
});
