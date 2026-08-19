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

export const GET = withAuth(async (_req, { user }) => {
  const summary = await getIntegration(user.workspace.id, "slack");
  return ok(summary ?? notConnected());
});

export const POST = withAuth(async (req, { user }) => {
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

  // 控えは「空欄なら消える」ようにしたいので、null でも常に config を渡す。
  await saveIntegration(user.workspace.id, "slack", webhookUrl, {
    channelHint: channelHint ?? "",
  });
  // saveIntegration は履歴を白紙に戻す。いま通ったテスト送信が、この Webhook に
  // とっての最初の「最終送信」になる。
  await recordResult(user.workspace.id, "slack", true);

  const summary = await getIntegration(user.workspace.id, "slack");
  return ok(summary ?? notConnected());
});

export const DELETE = withAuth(async (_req, { user }) => {
  await deleteIntegration(user.workspace.id, "slack");
  return ok({ ok: true });
});
