/**
 * Collections collection endpoint.
 * GET  — list the current workspace's collections (with record counts).
 * POST — create a new collection (+ its typed fields), enforcing plan limits.
 */
import { withAuth, ok, readJson } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { slugify, toFieldKey, uniqueName } from "@/lib/utils";
import { takenSlugsWithReserved } from "@/lib/master-objects";
import { createCollectionSchema } from "@/lib/validation";
import {
  assertCanCreateCollection,
  logActivity,
} from "@/lib/workspace";
import { FIELD_TYPES, isFieldType } from "@/lib/field-types";

export const GET = withAuth(async (_req, { user }) => {
  const collections = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
    orderBy: { position: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      icon: true,
      color: true,
      template: true,
      position: true,
      _count: { select: { records: true } },
    },
  });
  return ok(collections);
});

export const POST = withAuth(async (req, { user }) => {
  await assertCanCreateCollection(user);
  const input = await readJson(req, createCollectionSchema);

  // Build a slug unique within the workspace by suffixing (-2, -3, …).
  const existing = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
    select: { slug: true },
  });
  // マスターDBの slug は予約語 — 詳細は master-objects.ts。
  const takenSlugs = takenSlugsWithReserved(existing);
  const slug = uniqueName(slugify(input.name), takenSlugs);

  const position = existing.length;

  // Derive fields — keep keys unique & stable within the collection.
  const takenKeys = new Set<string>();
  const fields = (input.fields ?? []).map((f, index) => {
    const rawKey = f.key?.trim() || toFieldKey(f.name);
    const key = uniqueName(rawKey, takenKeys);
    takenKeys.add(key);
    const type = isFieldType(f.type) ? f.type : FIELD_TYPES[0];
    return {
      key,
      name: f.name,
      type,
      required: f.required ?? false,
      options: f.options ? toJson(f.options) : undefined,
      config: f.config ? toJson(f.config) : undefined,
      position: typeof f.position === "number" ? f.position : index,
    };
  });

  const collection = await db.collection.create({
    data: {
      workspaceId: user.workspace.id,
      name: input.name,
      slug,
      description: input.description ?? "",
      icon: input.icon ?? "table",
      color: input.color ?? "khaki",
      template: input.template ?? "custom",
      position,
      fields: fields.length ? { create: fields } : undefined,
    },
    include: { fields: { orderBy: { position: "asc" } } },
  });

  await logActivity(user.workspace.id, "collection.created", {
    collectionId: collection.id,
    name: collection.name,
    template: collection.template,
  });

  return ok(collection);
});
