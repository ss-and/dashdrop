/**
 * Send a real test message to the workspace's connected Slack webhook.
 *
 * A settings screen that only says "saved" proves nothing — the webhook may
 * point at a deleted channel. This posts an actual message and records the
 * outcome so 最終送信 / エラー on the card reflect reality.
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { getSecret, recordResult } from "@/lib/integrations";
import { buildMessage, postToSlack } from "@/lib/slack";

export const POST = withAuth(async (_req, { user }) => {
  const webhookUrl = await getSecret(user.workspace.id, "slack");
  if (!webhookUrl) {
    throw new ApiError(
      "Slackが接続されていません。先に Webhook URL を登録してください。",
      400,
    );
  }

  const res = await postToSlack(
    webhookUrl,
    buildMessage({
      title: "DashDrop の接続テストです",
      body: "このメッセージが見えていれば、Slackへの通知は正しく設定されています。",
      fields: [
        { label: "ワークスペース", value: user.workspace.name },
        { label: "送信者", value: user.name },
      ],
    }),
  );

  await recordResult(
    user.workspace.id,
    "slack",
    res.ok,
    res.ok ? undefined : res.error,
  );

  if (!res.ok) {
    // Slack に拒否された送信を HTTP 200 で返すと、この API を読むもの
    // （カード以外の呼び出し元、監視、将来のリトライ）は成功と区別できない。
    // 失敗は失敗のステータスで返し、理由は本文の error に載せる。
    throw new ApiError(res.error, 502);
  }

  return ok({ ok: true, sentAt: new Date().toISOString() });
});
