/**
 * データを消すときの下ごしらえと後始末。
 *
 * 消すこと自体は1行で書けるが、この製品では「消した後に何が壊れるか」を
 * 先に言えることの方が大事になる。スプレッドシートを消すと、それを見ていた
 * ダッシュボードは中身が空になり、通知ルールは存在しないシートを見張り続ける。
 * どちらも**エラーにならない**ので、黙って消すと後から原因を辿れない。
 *
 * ここは2つだけを担う。
 *   1. 消す前に「巻き添えになるもの」を数えて返す（画面が押す前に見せる）。
 *   2. 消すときに、外部キーで消えないもの（通知ルール）を一緒に片付ける。
 */
import { db } from "./db";

export interface DeleteImpact {
  /** 消える行数。 */
  recordCount: number;
  /** 中身が一部でも欠けるダッシュボードの名前（残す）。 */
  affectedDashboards: string[];
  /**
   * 見るものが1つも無くなるダッシュボード。
   *
   * データ元が全部消えるので、残しても空の枠が並ぶだけになる。利用者が
   * 作ったものを勝手に消しはしないが、一緒に片付けられる選択肢は出す。
   * 共有リンクを配ってあるものは、ここには入れない——こちらの都合で、
   * 外の人が見ているページを消してよい理由にはならない。
   */
  emptiedDashboards: Array<{ id: string; name: string }>;
  /** 一緒に消える通知ルールの名前。 */
  affectedAlerts: string[];
}

/**
 * 指定した slug のシートを消したときに、巻き添えになるものを数える。
 *
 * Dashboard.collectionSlugs は JSON 配列で、SQLite では JSON の中を条件に
 * できない。ワークスペースのダッシュボードは多くても数十件なので、読んで
 * JS 側で突き合わせる。
 */
export async function collectDeleteImpact(
  workspaceId: string,
  collectionIds: string[],
  slugs: string[],
): Promise<DeleteImpact> {
  const [recordCount, dashboards, alerts] = await Promise.all([
    collectionIds.length === 0
      ? Promise.resolve(0)
      : db.record.count({ where: { collectionId: { in: collectionIds } } }),
    db.dashboard.findMany({
      where: { workspaceId },
      select: { id: true, name: true, collectionSlugs: true, shareToken: true },
    }),
    collectionIds.length === 0
      ? Promise.resolve([])
      : db.alertRule.findMany({
          where: { workspaceId, collectionId: { in: collectionIds } },
          select: { name: true },
        }),
  ]);

  const doomed = new Set(slugs);
  const affectedDashboards: string[] = [];
  const emptiedDashboards: Array<{ id: string; name: string }> = [];

  for (const d of dashboards) {
    const bound = Array.isArray(d.collectionSlugs)
      ? d.collectionSlugs.filter((s): s is string => typeof s === "string")
      : [];
    if (bound.length === 0 || !bound.some((s) => doomed.has(s))) continue;
    affectedDashboards.push(d.name);
    // 全部のデータ元が消えるものだけ、一緒に片付ける候補にする。
    if (bound.every((s) => doomed.has(s)) && d.shareToken === null) {
      emptiedDashboards.push({ id: d.id, name: d.name });
    }
  }

  return {
    recordCount,
    affectedDashboards,
    emptiedDashboards,
    affectedAlerts: alerts.map((a) => a.name),
  };
}

/** 空になるダッシュボードを片付ける。呼び出し側が選んだときだけ。 */
export async function deleteEmptiedDashboards(
  workspaceId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await db.dashboard.deleteMany({
    where: { workspaceId, id: { in: ids } },
  });
  return res.count;
}

/**
 * シートを消す。フィールドと行はカスケードで消えるが、通知ルールは
 * Collection への外部キーではなく id を持っているだけなので消えない。
 * 放っておくと、存在しないシートを見張り続ける壊れたルールが残る。
 */
export async function deleteCollections(
  workspaceId: string,
  collectionIds: string[],
): Promise<void> {
  if (collectionIds.length === 0) return;
  await db.$transaction([
    db.alertRule.deleteMany({
      where: { workspaceId, collectionId: { in: collectionIds } },
    }),
    db.collection.deleteMany({
      where: { workspaceId, id: { in: collectionIds } },
    }),
  ]);
}
