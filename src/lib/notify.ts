/**
 * Notification helper. In-app notifications are the always-available channel;
 * email/Slack are sent additionally only when configured.
 *
 * Slack is configured *per workspace* (Settings → 連携), never per deployment:
 * one shared webhook would post every tenant's alerts into a single channel.
 */
import { db, toJson } from "./db";
import { env } from "./env";
import { getSecret } from "./integrations";
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
 * Best-effort Slack delivery for one workspace. Never throws.
 *
 * Order of resolution:
 *  1. The workspace's own incoming webhook (the normal, multi-tenant path).
 *  2. `SLACK_WEBHOOK_URL` — kept ONLY as a fallback for a self-hosted,
 *     single-tenant deployment where one owner runs one workspace and would
 *     rather set an env var than click through the settings screen. It must
 *     stay unset on the hosted multi-tenant service, where it would leak one
 *     tenant's notifications into another's channel.
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

  const fallback = env.SLACK_WEBHOOK_URL ?? "";
  if (!fallback) return false;
  const res = await postToSlack(fallback, buildMessage(message));
  return res.ok;
}

/**
 * @deprecated Plain-text delivery through the deployment-wide webhook only.
 * Use `sendWorkspaceSlack(workspaceId, …)` so the message reaches the channel
 * the *workspace* connected. Retained for self-hosted single-tenant setups.
 */
export async function sendSlack(text: string): Promise<boolean> {
  const url = env.SLACK_WEBHOOK_URL ?? "";
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
