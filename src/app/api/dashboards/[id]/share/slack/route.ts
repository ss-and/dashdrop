/**
 * Slackへ共有。
 * POST → 接続済みのSlack（ワークスペース設定のIncoming Webhook）へ1通投げる。
 *
 * グラフそのものは送れないので、送るのは「見出し・主要な数字・開くためのリンク」。
 * それだけで要点が分かることを狙っている（Slackで見て、必要な人だけ開く）。
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { getIntegration } from "@/lib/integrations";
import { notifyWorkspaceSlack } from "@/lib/slack";
import { breakdownLines, isEmptyDigest } from "@/lib/dashboard-digest";
import { loadShareSubject, stampedAt } from "../digest";

export const POST = withAuth(async (_req, { user, params }) => {
  const workspaceId = user.workspace.id;

  // 未接続のまま送ろうとしたときは、何をすればいいかまで返す。
  // 「送信に失敗しました」だけでは、設定に行けばよいことが分からない。
  const integration = await getIntegration(workspaceId, "slack");
  if (!integration?.connected || !integration.enabled) {
    throw new ApiError(
      "Slackが接続されていません。設定 › 連携 で Incoming Webhook を登録してください。",
      409,
    );
  }

  const subject = await loadShareSubject(workspaceId, params.id);

  const bodyParts: string[] = [];
  if (subject.description) bodyParts.push(subject.description);
  // 内訳は1本だけ。Slackは縦に長い投稿ほど読まれない。
  const top = subject.digest.breakdowns[0];
  if (top) {
    bodyParts.push(`${top.title}\n${breakdownLines(top).join("\n")}`);
  }
  if (isEmptyDigest(subject.digest)) {
    // 空の投稿は故障に見える。数字が無いことを事実として書く。
    bodyParts.push("このダッシュボードにはまだ集計できる数字がありません。");
  }
  bodyParts.push(`${stampedAt()} 時点`);

  const delivered = await notifyWorkspaceSlack(workspaceId, {
    title: subject.name,
    body: bodyParts.join("\n\n"),
    url: subject.url,
    linkLabel: "ダッシュボードを開く",
    fields: subject.digest.kpis.map((k) => ({ label: k.label, value: k.value })),
  });

  if (!delivered) {
    // notifyWorkspaceSlack は理由を返さないが、失敗は設定画面に記録されている。
    throw new ApiError(
      "Slackへの送信に失敗しました。設定 › 連携 で接続状態をご確認ください。",
      502,
    );
  }

  return ok({
    delivered: "slack" as const,
    publicLink: subject.publicLink,
  });
});
