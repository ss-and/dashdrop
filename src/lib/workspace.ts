/**
 * Tenant-scoped data access + plan-limit enforcement.
 *
 * Every read/write that touches a Collection or Record must go through these
 * helpers so a user can never reach another workspace's data, and so plan
 * limits are enforced in one auditable place.
 */
import { db, toJson } from "./db";
import { ApiError } from "./errors";
import { getPlan } from "./plans";
import { assertWithinCollectionLimit } from "./master-objects";
import type { CurrentUser } from "./auth";
import type { Collection, Field } from "@prisma/client";

/** Load a collection by id, asserting it belongs to the caller's workspace. */
export async function getCollectionForUser(
  user: CurrentUser,
  collectionId: string,
): Promise<Collection & { fields: Field[] }> {
  const collection = await db.collection.findFirst({
    where: { id: collectionId, workspaceId: user.workspace.id },
    include: { fields: { orderBy: { position: "asc" } } },
  });
  if (!collection) throw new ApiError("スプレッドシートが見つかりません（削除された、または権限がありません）。", 404);
  return collection;
}

/** Load a record by id, asserting it belongs to the caller's workspace. */
export async function getRecordForUser(user: CurrentUser, recordId: string) {
  const record = await db.record.findFirst({
    where: { id: recordId, collection: { workspaceId: user.workspace.id } },
    include: { collection: { include: { fields: true } } },
  });
  if (!record) throw new ApiError("レコードが見つかりません（削除された、または権限がありません）。", 404);
  return record;
}

export async function assertCanCreateCollection(user: CurrentUser): Promise<void> {
  const plan = getPlan(user.workspace.plan);
  // 数え方は必ず assertWithinCollectionLimit に集約する。ここだけ独自に数えると
  // 「作れるのに取り込めない」といった噛み合わない状態が生まれる。
  const existing = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
    select: { slug: true },
  });
  assertWithinCollectionLimit(plan, existing, 1);
}

export async function assertCanAddRecords(
  user: CurrentUser,
  collectionId: string,
  adding: number,
): Promise<void> {
  const plan = getPlan(user.workspace.plan);
  const count = await db.record.count({ where: { collectionId } });
  if (count + adding > plan.limits.recordsPerCollection) {
    throw new ApiError(
      `プラン「${plan.name}」の1テーブルあたり行数上限（${plan.limits.recordsPerCollection.toLocaleString()}）を超えます。`,
      403,
    );
  }
}

export type ActivityType =
  | "record.created"
  | "record.updated"
  | "record.deleted"
  | "inquiry.resolved"
  | "task.completed"
  | "import.completed"
  | "collection.created";

/** Append to the activity stream that powers the weekly performance charts. */
export async function logActivity(
  workspaceId: string,
  type: ActivityType,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.activity.create({
      data: { workspaceId, type, meta: meta ? toJson(meta) : undefined },
    });
  } catch (err) {
    // Activity logging must never break the primary operation.
    console.error("Failed to log activity", err);
  }
}
