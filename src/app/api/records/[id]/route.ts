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
import {
  coerceValue,
  isComputedField,
  type FieldType,
  type SelectOption,
} from "@/lib/field-types";
import {
  validateRelationWrites,
  type EngineField,
} from "@/lib/relations";
import { RESOLVED_VALUES } from "@/lib/templates";

/** Does this row's data count as resolved/completed for its template? */
function isResolved(template: string, data: Record<string, unknown>): boolean {
  if (template === "inquiry") return data.status === RESOLVED_VALUES.inquiry;
  if (template === "task") {
    return data.status === RESOLVED_VALUES.task || data.done === true;
  }
  return false;
}

/**
 * 送られてきたキーがすべて実在する列か確かめる。
 *
 * 【不具合の再発防止】以前は列に対応しないキーを黙って捨てて 200 を返していた。
 * 別タブで列が削除された状態で編集すると、入力が保存されていないのに画面上は
 * 「保存済み」になり、打ち込んだ内容が消えていた。存在しない列を指定されたら
 * 成功を装わず、どの列が無くなったのかを名指しで伝える。
 */
function assertKnownKeys(
  fields: Array<{ key: string }>,
  data: Record<string, unknown>,
): void {
  const known = new Set(fields.map((f) => f.key));
  const unknown = Object.keys(data).filter((key) => !known.has(key));
  if (unknown.length === 0) return;
  // 409：入力そのものではなく、画面が持っている列構成が古いことが原因。
  throw new ApiError(
    `列「${unknown.join("」「")}」はこのスプレッドシートに存在しません（他の画面で削除された可能性があります）。画面を再読み込みしてから入力し直してください。`,
    409,
  );
}

export const PATCH = withAuth(async (req, { user, params }) => {
  const record = await getRecordForUser(user, params.id);
  const input = await readJson(req, updateRecordSchema);

  const fields = record.collection.fields;
  assertKnownKeys(fields, input.data);

  const existing = (record.data as Record<string, unknown>) ?? {};
  const merged: Record<string, unknown> = { ...existing };
  // 今回の要求に含まれていたキーだけを集めた「差分」。リンク検証はこちらに
  // 対して行う（下のコメント参照）。
  const patch: Record<string, unknown> = {};

  // Only validate/coerce the fields present in the payload.
  for (const field of fields) {
    if (!(field.key in input.data)) continue;
    if (isComputedField(field.type)) continue; // lookup/rollup are read-only
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
    patch[field.key] = result.value;
    if (result.value === null || result.value === undefined) {
      delete merged[field.key];
    } else {
      merged[field.key] = result.value;
    }
  }

  // 【不具合の再発防止】以前はマージ後の行全体を検証していた。merged は
  // 既存データのコピーから始まるため、保存済みのリンク値まで毎回検証され、
  // リンク先の1件が削除されただけで（表示は空欄になるだけの設計なのに）
  // その行の無関係なセルすら二度と保存できなくなっていた。今回の要求に
  // 含まれるキーだけを検証する。
  await validateRelationWrites(
    user.workspace.id,
    fields as unknown as EngineField[],
    patch,
  );

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
