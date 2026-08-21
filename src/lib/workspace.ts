/**
 * Tenant-scoped data access + plan-limit enforcement.
 *
 * Every read/write that touches a Collection or Record must go through these
 * helpers so a user can never reach another workspace's data, and so plan
 * limits are enforced in one auditable place.
 */
import { db, toJson } from "./db";
import { ApiError } from "./errors";
import {
  can,
  getPlan,
  limitOf,
  plansEnforced,
  upgradeMessage,
  type Capability,
} from "./plans";
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
  if (!collection)
    throw new ApiError(
      "スプレッドシートが見つかりません（削除された、または権限がありません）。",
      404,
    );
  return collection;
}

/** Load a record by id, asserting it belongs to the caller's workspace. */
export async function getRecordForUser(user: CurrentUser, recordId: string) {
  const record = await db.record.findFirst({
    where: { id: recordId, collection: { workspaceId: user.workspace.id } },
    include: { collection: { include: { fields: true } } },
  });
  if (!record)
    throw new ApiError(
      "レコードが見つかりません（削除された、または権限がありません）。",
      404,
    );
  return record;
}

/**
 * その機能が使えるか確かめる。使えなければここで止める。
 *
 * 判定を各APIに書き散らさず、**必ずこの1本を通す**。塞ぎ忘れた入口は
 * 誰も報告してくれない——気づくのは「なぜか使えている」と言われたときで、
 * そのときには既に使われている。
 *
 * 402（Payment Required）ではなく 403 を返す。402 は決済フローを持つ
 * クライアントのための番号で、この製品にはまだ申し込む先が無い。
 * 状態としては「今のあなたには許可されていない」が正しい。
 */
export function assertCapability(user: CurrentUser, cap: Capability): void {
  if (!plansEnforced) return;
  if (can(user.workspace.plan, cap)) return;
  throw new ApiError(upgradeMessage(cap), 403);
}

/**
 * 取り込んだファイル（ブック）の数の上限。
 *
 * Free を1ファイルにしているので、2つ目を入れようとしたときに止まる。
 * 数えるのは既存のブックだけで、これから作るぶんは呼び出し側が
 * `adding` で渡す。
 */
export async function assertCanCreateWorkbook(
  user: CurrentUser,
  adding = 1,
): Promise<void> {
  if (!plansEnforced) return;
  const limit = limitOf(user.workspace.plan, "workbooks");
  const existing = await db.workbook.count({
    where: { workspaceId: user.workspace.id },
  });
  if (existing + adding <= limit) return;
  throw new ApiError(
    `取り込めるファイルは ${limit.toLocaleString("ja-JP")} 個までです（いま ${existing.toLocaleString("ja-JP")} 個）。Pro は準備中です。既存のファイルを削除すると、新しいファイルを取り込めます。`,
    403,
  );
}

export async function assertCanCreateCollection(
  user: CurrentUser,
): Promise<void> {
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
  if (!plansEnforced) return;
  const plan = getPlan(user.workspace.plan);
  const count = await db.record.count({ where: { collectionId } });
  if (count + adding > limitOf(plan.id, "recordsPerCollection")) {
    throw new ApiError(
      `プラン「${plan.name}」の1テーブルあたり行数上限（${limitOf(plan.id, "recordsPerCollection").toLocaleString()}）を超えます。`,
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
  | "collection.created"
  // 消した記録は必ず残す。「無くなっている」に気づいたときに、誰がいつ
  // 消したのかを辿れる場所がここしか無い。
  | "collection.deleted";

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
