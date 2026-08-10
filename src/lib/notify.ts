/**
 * Notification helper. In-app notifications are the always-available channel;
 * email/Slack are sent additionally only when configured (env keys present).
 */
import { db, toJson } from "./db";
import { env } from "./env";

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

/** Best-effort Slack delivery via an incoming-webhook URL (if configured). */
export async function sendSlack(text: string): Promise<boolean> {
  const url = env.SLACK_WEBHOOK_URL ?? "";
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Best-effort email delivery. Real SMTP sending requires a mail transport
 * (added when SMTP_* is configured); until then this reports whether email
 * *would* be sent so the caller can fall back to in-app.
 */
export function emailConfigured(): boolean {
  return env.SMTP_HOST.length > 0 && env.SMTP_USER.length > 0;
}
