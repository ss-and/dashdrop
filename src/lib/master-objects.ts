/**
 * The built-in master databases — 顧客データベース (CRM) と 人事データベース (HR).
 *
 * These objects are installed by DashDrop itself, not created by the owner, so
 * they are treated differently from a spreadsheet someone imported:
 *
 *  - ナビゲーション: they are pinned (sidebar bottom / launcher top / home) and
 *    must be excluded from the「取り込んだファイル」「その他」listings.
 *  - プラン上限: they do **not** consume the workspace's spreadsheet quota.
 *    Free は 10 シートだが、CRM 5 + HR 5 でちょうど使い切ってしまい、
 *    「Excel を取り込む」という製品の中心機能が一切使えなくなる。製品側が
 *    用意した土台でユーザーの枠を潰さない、という判断。行数の上限
 *    (recordsPerCollection) は通常どおり適用される。
 *
 * 注意: 上限の除外は slug で判定している。ユーザーが自分で作ったシートの slug が
 * たまたまマスターの slug と一致した場合、その 1 枠は上限から外れる（最大 10 枠）。
 * 代わりにそのオブジェクトはインストール時にスキップされるため、実害は小さい。
 * 厳密にやるなら Collection に builtin フラグを持たせること。
 *
 * 上限の判定は必ず `assertWithinCollectionLimit` を通すこと。数え方が1箇所でも
 * ずれると、「作れるのに取り込めない」ような噛み合わない状態が生まれる
 * （実際に、インストーラだけ除外して取り込み側を直し忘れ、Freeプランが
 * Excelを1枚も取り込めなくなる不具合を出した）。
 *
 * Definitions only — no DB access — so this module is safe to import anywhere.
 */
import { ApiError } from "./errors";
import { limitOf, type Plan } from "./plans";
import { CRM_SLUGS } from "./crm-objects";
import { HR_SLUGS } from "./hr-objects";

/** 顧客データベース + 人事データベース の slug（表示順）。 */
export const MASTER_SLUGS: string[] = [...CRM_SLUGS, ...HR_SLUGS];

const MASTER_SLUG_SET = new Set<string>(MASTER_SLUGS);

/** Whether `slug` belongs to a built-in master database object. */
export function isMasterSlug(slug: string): boolean {
  return MASTER_SLUG_SET.has(slug);
}

/** How many of `collections` count against the plan's spreadsheet quota. */
export function countBillableCollections(
  collections: Array<{ slug: string }>,
): number {
  return collections.reduce((n, c) => (isMasterSlug(c.slug) ? n : n + 1), 0);
}

/**
 * Throw unless `adding` more user spreadsheets fit in the plan.
 *
 * 唯一の上限判定。組み込みのマスターDBは `existing` から除外して数える。
 * マスターDB自体を作る場合は、そもそも枠を消費しないので呼ばなくてよい。
 */
export function assertWithinCollectionLimit(
  plan: Plan,
  existing: Array<{ slug: string }>,
  adding: number,
): void {
  const billable = countBillableCollections(existing);
  const limit = limitOf(plan.id, "collections");
  if (billable + adding <= limit) return;
  throw new ApiError(
    `プラン「${plan.name}」のスプレッドシート上限（${limit}）を超えます。` +
      `現在 ${billable} 件で、あと ${Math.max(limit - billable, 0)} 件まで追加できます。` +
      `不要なスプレッドシートを削除するか、プランを変更してください。` +
      `（顧客データベース・人事データベースは上限に含みません）`,
    403,
  );
}

/**
 * Slugs a user-created spreadsheet may not take.
 *
 * マスターDBの slug は予約語として扱う。ユーザーが「Accounts」という名前の
 * Excel を取り込むと slug が `accounts` になり、後から顧客データベースを
 * 作ろうとしたときに「もう有る」と判定されて、他のオブジェクトの関連が
 * そのシートを向いてしまう。さらに、上限から除外される枠を只で得られる。
 * 入口で別の slug（accounts-2）に寄せてしまえば、どちらも起きない。
 *
 * 既存のワークスペースには衝突済みの slug が残りうるので、インストーラ側の
 * 照合（install-master.ts の looksLikeOurObject）は保険として残してある。
 */
export function reservedSlugs(): Set<string> {
  return new Set(MASTER_SLUGS);
}

/**
 * The set of slugs a new user spreadsheet must avoid: everything already in the
 * workspace, plus the reserved master slugs.
 */
export function takenSlugsWithReserved(
  existing: Array<{ slug: string }>,
): Set<string> {
  const taken = reservedSlugs();
  for (const c of existing) taken.add(c.slug);
  return taken;
}
