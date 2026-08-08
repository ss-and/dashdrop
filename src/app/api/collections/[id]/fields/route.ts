/**
 * Add a Field to a collection.
 * POST — append a typed field (key auto-derived & unique per collection).
 */
import { withAuth, ok, readJson } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { toFieldKey, uniqueName } from "@/lib/utils";
import { fieldInputSchema } from "@/lib/validation";
import { getCollectionForUser } from "@/lib/workspace";

export const POST = withAuth(async (req, { user, params }) => {
  const collection = await getCollectionForUser(user, params.id);
  const input = await readJson(req, fieldInputSchema);

  // Unique key within the collection.
  const takenKeys = new Set(collection.fields.map((f) => f.key));
  const rawKey = input.key?.trim() || toFieldKey(input.name);
  const key = uniqueName(rawKey, takenKeys);

  // Next position = max existing + 1.
  const maxPosition = collection.fields.reduce(
    (max, f) => Math.max(max, f.position),
    -1,
  );

  const field = await db.field.create({
    data: {
      collectionId: collection.id,
      key,
      name: input.name,
      type: input.type,
      required: input.required ?? false,
      options: input.options ? toJson(input.options) : undefined,
      config: input.config ? toJson(input.config) : undefined,
      position:
        typeof input.position === "number" ? input.position : maxPosition + 1,
    },
  });

  return ok(field);
});
