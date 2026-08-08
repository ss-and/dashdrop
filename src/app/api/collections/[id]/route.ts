/**
 * Single collection endpoint.
 * GET    — fetch a collection (fields ordered + record count).
 * PATCH  — update name/description/icon/color.
 * DELETE — remove the collection (cascade drops its fields & records).
 */
import { withAuth, ok, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { updateCollectionSchema } from "@/lib/validation";
import { getCollectionForUser } from "@/lib/workspace";

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

export const DELETE = withAuth(async (_req, { user, params }) => {
  await getCollectionForUser(user, params.id);
  await db.collection.delete({ where: { id: params.id } });
  return ok({ id: params.id });
});
