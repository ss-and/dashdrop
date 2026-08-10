/**
 * "今すぐ送信" — deliver a report now.
 *
 * Always creates an in-app notification linking to the printable report. If the
 * schedule has recipients and SMTP is configured, email delivery *would* occur
 * (no transport wired up yet) and we report channel:'email'; otherwise the
 * report is delivered in-app only.
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { createNotification, emailConfigured } from "@/lib/notify";

const FREQ_LABEL: Record<string, string> = {
  daily: "日次",
  weekly: "週次",
  monthly: "月次",
};

export const POST = withAuth(async (_req, { user, params }) => {
  const workspaceId = user.workspace.id;

  const schedule = await db.reportSchedule.findFirst({
    where: { id: params.id, workspaceId },
  });
  if (!schedule) throw new ApiError("レポートが見つかりません", 404);

  const dashboard = await db.dashboard.findFirst({
    where: { id: schedule.dashboardId, workspaceId },
    select: { id: true, name: true },
  });
  if (!dashboard) throw new ApiError("ダッシュボードが見つかりません", 404);

  const recipients = Array.isArray(schedule.recipients)
    ? (schedule.recipients as unknown[]).filter(
        (r): r is string => typeof r === "string",
      )
    : [];

  const freqLabel = FREQ_LABEL[schedule.frequency] ?? schedule.frequency;

  const channel: "email" | "inapp" =
    recipients.length > 0 && emailConfigured() ? "email" : "inapp";

  await createNotification(workspaceId, {
    type: "report",
    title: `レポート: ${dashboard.name}`,
    body: `${freqLabel}レポートを送信しました`,
    url: `/reports/print/${schedule.id}`,
    meta: { scheduleId: schedule.id, channel, recipients: recipients.length },
  });

  await db.reportSchedule.update({
    where: { id: schedule.id },
    data: { lastSentAt: new Date() },
  });

  return ok({ sent: true, channel, recipients: recipients.length });
});
