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
 * Definitions only — no DB access — so this module is safe to import anywhere.
 */
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
