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
  | { use: false; reason: "unset" | "invalid" | "multi-tenant" };

/**
 * `SLACK_WEBHOOK_URL` を使ってよいかを決める。DBに触れない純粋関数なので、
 * 「複数テナントでは絶対に使わない」という判断だけをDBなしでテストできる。
 *
 * 方針: フォールバックは残すが、**1ワークスペースしか存在しないデプロイ**
 * （自己ホストの単一テナント。env を書くほうが設定画面より楽、という本来の用途）
 * に限定する。削除ではなく限定にしたのは、.env.example に載っている既存の
 * 自己ホスト環境の通知を黙って止めないため。ワークスペースが2つ以上ある
 * デプロイでは、Slack未接続のテナントの通知が運営のチャンネルに流れ込む
 * テナント間の情報漏えいそのものなので、無条件に使わない。
 *
 * URL自体もユーザー入力のWebhookと同じ `validateSecret` に通す。env 経由なら
 * 安全という前提は成り立たない（タイプミスや、サーバーに任意の宛先へ
 * POSTさせるSSRFを、ホストのピン留めで弾く）。
 */
export function resolveFallbackWebhook(
  raw: string | undefined,
  workspaceCount: number,
): FallbackDecision {
  const url = (raw ?? "").trim();
  if (!url) return { use: false, reason: "unset" };
  if (workspaceCount > 1) return { use: false, reason: "multi-tenant" };
  try {
    return { use: true, url: validateSecret("slack", url) };
  } catch {
    return { use: false, reason: "invalid" };
  }
}

const FALLBACK_WARNING: Record<"invalid" | "multi-tenant", string> = {
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
 * Best-effort Slack delivery for one workspace. Never throws.
 *
 * Order of resolution:
 *  1. The workspace's own incoming webhook (the normal, multi-tenant path).
 *  2. `SLACK_WEBHOOK_URL` — 単一ワークスペースのデプロイでのみ有効
 *     （resolveFallbackWebhook でホストのピン留めとテナント数を検証する）。
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
  } catch (err) {
    console.error("Failed to resolve Slack integration", err);
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
