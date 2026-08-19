/**
 * Single field endpoint (scoped through the owning collection).
 * PATCH  — update name / type / required / options / position.
 * DELETE — remove the field (orphan keys in record data are harmless).
 */
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { fieldInputSchema } from "@/lib/validation";
import { getCollectionForUser } from "@/lib/workspace";
import { validateFieldConfig, type EngineField } from "@/lib/relations";
import type { Prisma } from "@prisma/client";

// Partial variant — any subset of field attributes may be updated.
const updateFieldSchema = fieldInputSchema.partial();

export const PATCH = withAuth(async (req, { user, params }) => {
  const collection = await getCollectionForUser(user, params.id);
  const field = collection.fields.find((f) => f.id === params.fieldId);
  if (!field) throw new ApiError("フィールドが見つかりません。", 404);

  const input = await readJson(req, updateFieldSchema);

  const data: Prisma.FieldUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.required !== undefined) data.required = input.required;
  if (input.options !== undefined) data.options = toJson(input.options);
  if (input.config !== undefined || input.type !== undefined) {
    // Re-validate relation/lookup/rollup/vlookup config against the effective
    // type. The collection id lets the vlookup branch reject self-joins.
    const effectiveType = input.type ?? field.type;
    const cfg = await validateFieldConfig(
      user.workspace.id,
      effectiveType,
      input.config ?? field.config,
      collection.fields as unknown as EngineField[],
      collection.id,
    );
    data.config = cfg ? toJson(cfg) : undefined;
  }
  if (input.position !== undefined) data.position = input.position;

  const updated = await db.field.update({
    where: { id: field.id },
    data,
  });
  return ok(updated);
});

export const DELETE = withAuth(async (_req, { user, params }) => {
  const collection = await getCollectionForUser(user, params.id);
  const field = collection.fields.find((f) => f.id === params.fieldId);
  if (!field) throw new ApiError("Field not found", 404);

  await db.field.delete({ where: { id: field.id } });
  return ok({ id: field.id });
});
