/**
 * 共有（Slack / Notion）が共通で使う下ごしらえ。
 *
 * どちらの送り先でも「どのダッシュボードを、どのリンクで、どんな数字と一緒に
 * 送るか」は同じ。ここで1回だけ作って両方に渡す。別々に組み立てると、Slackには
 * 合計が出てNotionには出ない、という食い違いがすぐ生まれる。
 */
import { ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { loadDashboardCollections } from "@/lib/apply-template";
import { computeDashboard } from "@/lib/aggregate";
import { buildDigest, type DashboardDigest } from "@/lib/dashboard-digest";
import type { WidgetSpec } from "@/lib/widgets";

export interface ShareSubject {
  id: string;
  name: string;
  description: string;
  /** 送るリンク。 */
  url: string;
  /**
   * そのリンクがログイン無しで開けるか。
   *
   * 共有リンクを作っていないダッシュボードは、社内メンバーしか開けない。
   * それを黙って送ると、受け取った人が「リンクが壊れている」と受け取る。
   */
  publicLink: boolean;
  digest: DashboardDigest;
}

function appUrl(path: string): string {
  return `${env.APP_URL.replace(/\/$/, "")}${path}`;
}

export async function loadShareSubject(
  workspaceId: string,
  dashboardId: string,
): Promise<ShareSubject> {
  const dashboard = await db.dashboard.findFirst({
    where: { id: dashboardId, workspaceId },
  });
  if (!dashboard) throw new ApiError("ダッシュボードが見つかりません。", 404);

  const slugs = Array.isArray(dashboard.collectionSlugs)
    ? dashboard.collectionSlugs.filter((s): s is string => typeof s === "string")
    : [];
  const layout = (dashboard.layout as WidgetSpec[]) ?? [];
  const map = await loadDashboardCollections(workspaceId, slugs);

  return {
    id: dashboard.id,
    name: dashboard.name,
    description: dashboard.description ?? "",
    url: dashboard.shareToken
      ? appUrl(`/share/d/${dashboard.shareToken}`)
      : appUrl(`/d/${dashboard.id}`),
    publicLink: Boolean(dashboard.shareToken),
    digest: buildDigest(computeDashboard(layout, map)),
  };
}

/** 送信日時の一言。「いつ時点の数字か」が分からない共有は、後で誤読される。 */
export function stampedAt(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(now);
}
