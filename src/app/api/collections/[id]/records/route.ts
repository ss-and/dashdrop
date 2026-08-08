/**
 * Records of a collection.
 * GET  — paginated list (newest first) via createdAt cursor.
 * POST — create a row: every field is coerced/validated against its type,
 *        required fields enforced, plan limits checked, activity logged.
 */
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { createRecordSchema } from "@/lib/validation";
import {
  assertCanAddRecords,
  getCollectionForUser,
  logActivity,
} from "@/lib/workspace";
import { coerceValue, type FieldType, type SelectOption } from "@/lib/field-types";
import { RESOLVED_VALUES } from "@/lib/templates";
import type { Field } from "@prisma/client";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export const GET = withAuth(async (req, { user, params }) => {
  const collection = await getCollectionForUser(user, params.id);

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Math.min(
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT,
    MAX_LIMIT,
  );
  const cursor = url.searchParams.get("cursor") || undefined;

  const records = await db.record.findMany({
    where: { collectionId: collection.id },
    orderBy: { createdAt: "desc" },
    take: limit + 1, // fetch one extra to detect a next page
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  let nextCursor: string | null = null;
  if (records.length > limit) {
    const next = records.pop();
    nextCursor = next?.id ?? null;
  }

  return ok({ records, nextCursor });
});

/**
 * Validate & coerce a raw data payload against the collection's fields.
 * Returns a clean object keyed by Field.key. Throws ApiError(422) on the first
 * invalid or missing-required field.
 */
function buildRecordData(
  fields: Field[],
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const field of fields) {
    const options = (field.options as SelectOption[] | null) ?? undefined;
    const result = coerceValue(field.type as FieldType, raw[field.key], options);
    if (!result.ok) {
      throw new ApiError(`${field.name}: ${result.error}`, 422);
    }
    if (field.required && (result.value === null || result.value === undefined)) {
      throw new ApiError(`${field.name}は必須項目です`, 422);
    }
    if (result.value !== null && result.value !== undefined) {
      clean[field.key] = result.value;
    }
  }
  return clean;
}

/** Log inquiry.resolved / task.completed when a row lands in a resolved state. */
async function logResolutionIfNeeded(
  workspaceId: string,
  template: string,
  collectionId: string,
  recordId: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (template === "inquiry" && data.status === RESOLVED_VALUES.inquiry) {
    await logActivity(workspaceId, "inquiry.resolved", { collectionId, recordId });
  } else if (
    template === "task" &&
    (data.status === RESOLVED_VALUES.task || data.done === true)
  ) {
    await logActivity(workspaceId, "task.completed", { collectionId, recordId });
  }
}

export const POST = withAuth(async (req, { user, params }) => {
  const collection = await getCollectionForUser(user, params.id);
  const input = await readJson(req, createRecordSchema);

  const clean = buildRecordData(collection.fields, input.data);

  await assertCanAddRecords(user, collection.id, 1);

  const record = await db.record.create({
    data: {
      collectionId: collection.id,
      data: toJson(clean),
      createdById: user.id,
    },
  });

  await logActivity(user.workspace.id, "record.created", {
    collectionId: collection.id,
    recordId: record.id,
  });
  await logResolutionIfNeeded(
    user.workspace.id,
    collection.template,
    collection.id,
    record.id,
    clean,
  );

  return ok(record);
});
