/**
 * Add a Field to a collection.
 * POST — append a typed field (key auto-derived & unique per collection).
 */
import { withAuth, ok, readJson } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { toFieldKey, uniqueName } from "@/lib/utils";
import { fieldInputSchema } from "@/lib/validation";
import { getCollectionForUser } from "@/lib/workspace";
import { validateFieldConfig, type EngineField } from "@/lib/relations";

export const POST = withAuth(async (req, { user, params }) => {
  const collection = await getCollectionForUser(user, params.id);
  const input = await readJson(req, fieldInputSchema);

  // Unique key within the collection.
  const takenKeys = new Set(collection.fields.map((f) => f.key));
  const rawKey = input.key?.trim() || toFieldKey(input.name);
  const key = uniqueName(rawKey, takenKeys);

  // Validate/normalise config for relation/lookup/rollup/vlookup (clear errors
  // on bad setup). The collection id lets the vlookup branch reject self-joins.
  const config = await validateFieldConfig(
    user.workspace.id,
    input.type,
    input.config,
    collection.fields as unknown as EngineField[],
    collection.id,
    key,
  );

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
      config: config ? toJson(config) : undefined,
      position:
        typeof input.position === "number" ? input.position : maxPosition + 1,
    },
  });

  return ok(field);
});
