/**
 * Single record endpoint (tenant-scoped via getRecordForUser).
 * PATCH  — coerce/validate the changed fields, merge into stored data, and log
 *          a resolved/completed transition when a row first reaches that state.
 * DELETE — remove the row.
 */
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { updateRecordSchema } from "@/lib/validation";
import { getRecordForUser, logActivity } from "@/lib/workspace";
import { coerceValue, type FieldType, type SelectOption } from "@/lib/field-types";
import { RESOLVED_VALUES } from "@/lib/templates";

/** Does this row's data count as resolved/completed for its template? */
function isResolved(template: string, data: Record<string, unknown>): boolean {
  if (template === "inquiry") return data.status === RESOLVED_VALUES.inquiry;
  if (template === "task") {
    return data.status === RESOLVED_VALUES.task || data.done === true;
  }
  return false;
}

export const PATCH = withAuth(async (req, { user, params }) => {
  const record = await getRecordForUser(user, params.id);
  const input = await readJson(req, updateRecordSchema);

  const existing = (record.data as Record<string, unknown>) ?? {};
  const merged: Record<string, unknown> = { ...existing };

  // Only validate/coerce the fields present in the payload.
  for (const field of record.collection.fields) {
    if (!(field.key in input.data)) continue;
    const options = (field.options as SelectOption[] | null) ?? undefined;
    const result = coerceValue(
      field.type as FieldType,
      input.data[field.key],
      options,
    );
    if (!result.ok) {
      throw new ApiError(`${field.name}: ${result.error}`, 422);
    }
    if (
      field.required &&
      (result.value === null || result.value === undefined)
    ) {
      throw new ApiError(`${field.name}は必須項目です`, 422);
    }
    if (result.value === null || result.value === undefined) {
      delete merged[field.key];
    } else {
      merged[field.key] = result.value;
    }
  }

  const wasResolved = isResolved(record.collection.template, existing);

  const updated = await db.record.update({
    where: { id: record.id },
    data: { data: toJson(merged) },
  });

  await logActivity(user.workspace.id, "record.updated", {
    collectionId: record.collectionId,
    recordId: record.id,
  });

  // Log the resolved/completed transition only on the first crossing.
  if (!wasResolved && isResolved(record.collection.template, merged)) {
    if (record.collection.template === "inquiry") {
      await logActivity(user.workspace.id, "inquiry.resolved", {
        collectionId: record.collectionId,
        recordId: record.id,
      });
    } else if (record.collection.template === "task") {
      await logActivity(user.workspace.id, "task.completed", {
        collectionId: record.collectionId,
        recordId: record.id,
      });
    }
  }

  return ok(updated);
});

export const DELETE = withAuth(async (_req, { user, params }) => {
  const record = await getRecordForUser(user, params.id);
  await db.record.delete({ where: { id: record.id } });
  await logActivity(user.workspace.id, "record.deleted", {
    collectionId: record.collectionId,
    recordId: record.id,
  });
  return ok({ id: record.id });
});
