/**
 * Per-workspace Slack connection.
 *
 * POST   — verify an incoming-webhook URL by actually posting to it, then store it.
 * DELETE — disconnect.
 * GET    — the (masked) status the settings screen renders.
 *
 * The webhook URL is a live credential: it is sealed before storage and only
 * ever returned masked. Nothing here echoes the raw value back to the client.
 */
import { z } from "zod";
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import {
  saveIntegration,
  deleteIntegration,
  getIntegration,
  validateSecret,
  normaliseChannelHint,
  recordResult,
  type IntegrationSummary,
} from "@/lib/integrations";
import { buildMessage, postToSlack } from "@/lib/slack";

const connectSchema = z.object({
  webhookUrl: z.string().min(1, "Webhook URL を入力してください。"),
  /** 通知先チャンネル名の控え。宛先ではなく、あとから見分けるための表示用。 */
  channelHint: z.string().optional(),
});

function notConnected(): IntegrationSummary {
  return {
    provider: "slack",
    connected: false,
    enabled: false,
    masked: null,
    config: {},
    lastOkAt: null,
    lastError: null,
    status: "disconnected",
  };
}

/**
 * 接続時に本物の Slack へ1件投げて疎通を確かめるため、プラットフォーム既定の
 * 10 秒では足りないことがある（postToSlack 自体は8秒で打ち切る）。途中で
 * 関数を殺されると、Slack には「接続しました」が届いたのに保存されていない、
 * という食い違いが起きるので、余裕を持たせる。
 */
export const maxDuration = 30;

export const GET = withAuth(async (_req, { user }) => {
  const summary = await getIntegration(user.workspace.id, "slack");
  return ok(summary ?? notConnected());
});

export const POST = withAuth(async (req, { user }) => {
  /*
   * Slack は**無料でも使える**。
   *
   * 理由は原価ではなく、広がり方。Slack で起きるのは2つだけで、
   *   1. アラートが発火したときの自動通知（src/lib/alerts.ts）
   *   2. ダッシュボードを手で Slack に送る
   * このうち 1 は「アラート」の権限（alerts）で別に閉じているので、ここを
   * 開けても自動通知は開かない。開くのは 2——**チームの目に DashDrop が
   * 触れる経路**だけ。共有リンクと同じで、これは製品が広がる仕組みなので、
   * 閉じると自分の首を絞める。送信そのものの原価も HTTP POST 1本でほぼ0。
   *
   * だから integrations の権限からは外してある（残っているのは Notion と
   * Google スプレッドシートで、こちらは取り込み経路を持つぶん重い）。
   */
  const body = await readJson(req, connectSchema);

  // 形の検査を先に済ませる。https://hooks.slack.com 以外を弾くのはここで、
  // これがこのエンドポイントを SSRF の踏み台にしないための一線。
  // 保存より前に呼ぶことで、送信先として使えない URL に POST しに行かない。
  const webhookUrl = validateSecret("slack", body.webhookUrl);
  const channelHint = normaliseChannelHint(body.channelHint);

  // 形が正しいだけの死んだ Webhook（チャンネル削除済み、Slack側で失効）は
  // 保存できてしまい、「接続済み」と表示されたままアラートだけが黙って
  // 届かなくなる。実際に1通投げて、通ったものだけを保存する。
  const probe = await postToSlack(
    webhookUrl,
    buildMessage({
      title: "DashDrop と接続しました",
      body: "このチャンネルにアラートを通知します。この1通は接続確認のテストです。",
      fields: [
        { label: "ワークスペース", value: user.workspace.name },
        { label: "接続した人", value: user.name },
      ],
    }),
  );
  if (!probe.ok) {
    // 保存しない代わりに、なぜ保存しなかったのかをそのまま返す。画面は
    // 入力内容を保持したままなので、直して再送信できる。
    throw new ApiError(
      `${probe.error}（この Webhook URL は保存していません）`,
      502,
    );
  }

  // ここから先で失敗すると、Slack には「接続しました」が届いているのに保存は
  // されていない、という食い違いが残る。黙って汎用の500を返すと、利用者は
  // 「Slackには届いたのに画面は失敗と言う」意味が分からないので、そう伝える。
  try {
    // 控えは「空欄なら消える」ようにしたいので、null でも常に config を渡す。
    await saveIntegration(user.workspace.id, "slack", webhookUrl, {
      channelHint: channelHint ?? "",
    });
    // saveIntegration は履歴を白紙に戻す。いま通ったテスト送信が、この Webhook
    // にとっての最初の「最終送信」になる。
    await recordResult(user.workspace.id, "slack", true);
  } catch (err) {
    console.error("Slack webhook probe succeeded but saving failed", err);
    throw new ApiError(
      "Slackへの送信は成功しましたが、設定の保存に失敗しました。Slackに届いた接続確認のメッセージは無視して、もう一度お試しください。",
      500,
    );
  }

  const summary = await getIntegration(user.workspace.id, "slack");
  return ok(summary ?? notConnected());
});

export const DELETE = withAuth(async (_req, { user }) => {
  await deleteIntegration(user.workspace.id, "slack");
  return ok({ ok: true });
});
