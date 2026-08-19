/**
 * Notification helper. In-app notifications are the always-available channel;
 * email/Slack are sent additionally only when configured.
 *
 * Slack is configured *per workspace* (Settings → 連携), never per deployment:
 * one shared webhook would post every tenant's alerts into a single channel.
 *
 * `SLACK_WEBHOOK_URL`（デプロイ全体のフォールバック）は「設定し忘れないこと」を
 * ドキュメントで祈るのではなく、コードで強制する。詳細は resolveFallbackWebhook。
 */
import { db, toJson } from "./db";
import { env } from "./env";
import { getSecret, validateSecret } from "./integrations";
import {
  buildMessage,
  notifyWorkspaceSlack,
  postToSlack,
  type SlackMessageInput,
} from "./slack";

export interface NotifyInput {
  type?: "alert" | "report" | "system";
  title: string;
  body?: string;
  url?: string;
  meta?: Record<string, unknown>;
}

/** Create an in-app notification for a workspace. Never throws. */
export async function createNotification(
  workspaceId: string,
  input: NotifyInput,
): Promise<void> {
  try {
    await db.notification.create({
      data: {
        workspaceId,
        type: input.type ?? "system",
        title: input.title,
        body: input.body ?? "",
        url: input.url,
        meta: input.meta ? toJson(input.meta) : undefined,
      },
    });
  } catch (err) {
    console.error("Failed to create notification", err);
  }
}

/** Turn an in-app path ("/c/abc") into a link Slack can open. */
function absoluteUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return `${env.APP_URL.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}

/**
 * env フォールバックの判定結果。使わない場合は理由を残す（運用者への警告用）。
 */
export type FallbackDecision =
  | { use: true; url: string }
  | { use: false; reason: "unset" | "not-opted-in" | "invalid" | "multi-tenant" };

/** `SLACK_WEBHOOK_SINGLE_TENANT` の真偽解釈。既定は「同意していない」。 */
export function isSingleTenantOptIn(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/**
 * `SLACK_WEBHOOK_URL` を使ってよいかを決める。DBに触れない純粋関数なので、
 * 「複数テナントでは絶対に使わない」という判断だけをDBなしでテストできる。
 *
 * 方針: フォールバックは残すが、次の2つが**両方**成り立つときだけ使う。
 *   1. 運用者が `SLACK_WEBHOOK_SINGLE_TENANT=true` と明示的に宣言している
 *   2. 実際にワークスペースが1つしかない
 *
 * 1 が要るのは、「今ワークスペースが1つ」を自己ホストの証拠として扱うと、
 * ホスティング版でも最初の1社が登録した直後や、整理して1社になった瞬間に
 * フォールバックが復活し、そのお客さまの通知（ルール名・数値・レコードへの
 * リンク）が運営のチャンネルへ流れてしまうため。2 が要るのは、宣言したまま
 * テナントが増えた場合の保険。削除ではなく限定にしたのは、.env.example に
 * 載っている既存の自己ホスト環境の通知を黙って止めないため。
 *
 * URL自体もユーザー入力のWebhookと同じ `validateSecret` に通す。env 経由なら
 * 安全という前提は成り立たない（タイプミスや、サーバーに任意の宛先へ
 * POSTさせるSSRFを、ホストのピン留めで弾く）。
 */
export function resolveFallbackWebhook(
  raw: string | undefined,
  workspaceCount: number,
  optIn: boolean,
): FallbackDecision {
  const url = (raw ?? "").trim();
  if (!url) return { use: false, reason: "unset" };
  if (!optIn) return { use: false, reason: "not-opted-in" };
  if (workspaceCount > 1) return { use: false, reason: "multi-tenant" };
  try {
    return { use: true, url: validateSecret("slack", url) };
  } catch {
    return { use: false, reason: "invalid" };
  }
}

const FALLBACK_WARNING: Record<
  "not-opted-in" | "invalid" | "multi-tenant",
  string
> = {
  "not-opted-in":
    "SLACK_WEBHOOK_URL は設定されていますが、SLACK_WEBHOOK_SINGLE_TENANT=true が無いため無視しました（単一テナントのデプロイでのみ使用できます）。",
  invalid:
    "SLACK_WEBHOOK_URL は https://hooks.slack.com/... である必要があります。無視しました。",
  "multi-tenant":
    "SLACK_WEBHOOK_URL はワークスペースが複数あるデプロイでは使用できません（他テナントの通知が混ざるため）。無視しました。",
};

/** 同じ設定ミスをアラート評価のたびに出力しないよう、理由ごとに一度だけ警告する。 */
const warned = new Set<string>();

/**
 * 使ってよい場合だけ env フォールバックのURLを返す。決して throw しない。
 *
 * ワークスペース数は毎回問い合わせる: 「単一テナントだ」という判定をキャッシュ
 * すると、2つ目のワークスペースが作られた瞬間から漏えいする側に倒れる。
 * 件数そのものは不要で 2件目の有無だけ分かればよいので take: 2 で十分。
 */
async function deploymentFallbackWebhook(): Promise<string | null> {
  try {
    if (!env.SLACK_WEBHOOK_URL.trim()) return null;
    const workspaces = await db.workspace.findMany({
      select: { id: true },
      take: 2,
    });
    const decision = resolveFallbackWebhook(
      env.SLACK_WEBHOOK_URL,
      workspaces.length,
      isSingleTenantOptIn(env.SLACK_WEBHOOK_SINGLE_TENANT),
    );
    if (decision.use) return decision.url;
    if (decision.reason !== "unset" && !warned.has(decision.reason)) {
      warned.add(decision.reason);
      console.warn(FALLBACK_WARNING[decision.reason]);
    }
    return null;
  } catch (err) {
    console.error("Failed to resolve the Slack fallback webhook", err);
    return null;
  }
}

/**
 * このワークスペースに Slack の Integration 行が保存されているか。
 *
 * `getSecret` は「未接続」でも「行はあるが復号できない／無効化されている」でも
 * 同じ null を返す（decryptSecret は throw せず null を返す設計）。null だけを
 * 手がかりにすると後者がデプロイ共通のWebhookへ流れてしまうので、行の有無は
 * 別に確かめる。
 *
 * 問い合わせに失敗したときは false（＝行なし）として扱うが、これで漏えいには
 * ならない。フォールバックを使うにはこの直後の `deploymentFallbackWebhook` が
 * ワークスペース数の問い合わせに成功する必要があり、DBが応答しない状況では
 * そちらも null を返して送信自体が起きないため。
 */
async function hasStoredSlackIntegration(workspaceId: string): Promise<boolean> {
  try {
    const row = await db.integration.findFirst({
      where: { workspaceId, provider: "slack" },
      select: { id: true },
    });
    return row !== null;
  } catch (err) {
    console.error("Failed to look up the stored Slack integration", err);
    return false;
  }
}

/**
 * Best-effort Slack delivery for one workspace. Never throws.
 *
 * Order of resolution:
 *  1. The workspace's own incoming webhook (the normal, multi-tenant path).
 *  2. `SLACK_WEBHOOK_URL` — 単一ワークスペースのデプロイでのみ有効
 *     （resolveFallbackWebhook でホストのピン留めとテナント数を検証する）。
 *
 * 2 に落ちてよいのは「Slackを一度も接続していない」ワークスペースだけ。
 */
export async function sendWorkspaceSlack(
  workspaceId: string,
  input: SlackMessageInput,
): Promise<boolean> {
  const message: SlackMessageInput = {
    ...input,
    url: absoluteUrl(input.url),
  };

  try {
    const connected = await getSecret(workspaceId, "slack");
    if (connected) return await notifyWorkspaceSlack(workspaceId, message);

    // 自分の Slack を接続しているのに使えない場合（AUTH_SECRET の入れ替えで
    // 復号できない、設定画面で無効化された）。デプロイ共通の宛先へ回すと、
    // そのワークスペースの通知が本人の知らないチャンネルに出てしまうので、
    // 送らずに諦める。以前はこの分岐が無く、null を「未接続」と誤読して
    // フォールバックへ落ちていた。
    if (await hasStoredSlackIntegration(workspaceId)) {
      console.error(
        `Slack is connected for workspace ${workspaceId} but the credential is unusable; not falling back to the deployment webhook`,
      );
      return false;
    }
  } catch (err) {
    // 取り出しそのものが失敗した場合も同じ扱い（送らない）。
    console.error("Failed to resolve Slack integration", err);
    return false;
  }

  const fallback = await deploymentFallbackWebhook();
  if (!fallback) return false;
  const res = await postToSlack(fallback, buildMessage(message));
  return res.ok;
}

/**
 * @deprecated Plain-text delivery through the deployment-wide webhook only.
 * Use `sendWorkspaceSlack(workspaceId, …)` so the message reaches the channel
 * the *workspace* connected. Retained for self-hosted single-tenant setups —
 * 宛先がテナントに紐づかないため、フォールバックと同じゲートを必ず通す。
 */
export async function sendSlack(text: string): Promise<boolean> {
  const url = await deploymentFallbackWebhook();
  if (!url) return false;
  const res = await postToSlack(url, buildMessage({ title: text }));
  return res.ok;
}

/**
 * Best-effort email delivery. Real SMTP sending requires a mail transport
 * (added when SMTP_* is configured); until then this reports whether email
 * *would* be sent so the caller can fall back to in-app.
 */
export function emailConfigured(): boolean {
  return env.SMTP_HOST.length > 0 && env.SMTP_USER.length > 0;
}
