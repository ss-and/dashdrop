/**
 * Scheduled reports collection endpoint.
 * GET  — list this workspace's ReportSchedules, joined with their dashboard name.
 * POST — create a schedule for a dashboard the caller owns.
 */
import { z } from "zod";
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { db, toJson } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createReportSchema = z.object({
  dashboardId: z.string().trim().min(1, "ダッシュボードを選択してください"),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  recipients: z
    .array(
      z
        .string()
        .trim()
        .refine((v) => EMAIL_RE.test(v), {
          message: "メールアドレスの形式が正しくありません",
        }),
    )
    .optional(),
});

export const GET = withAuth(async (_req, { user }) => {
  const workspaceId = user.workspace.id;

  const schedules = await db.reportSchedule.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });

  // No FK relation from ReportSchedule -> Dashboard, so resolve names in a
  // single scoped query and map by id.
  const dashboardIds = [...new Set(schedules.map((s) => s.dashboardId))];
  const dashboards = dashboardIds.length
    ? await db.dashboard.findMany({
        where: { workspaceId, id: { in: dashboardIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(dashboards.map((d) => [d.id, d.name]));

  const rows = schedules.map((s) => {
    const recipients = Array.isArray(s.recipients)
      ? (s.recipients as unknown[]).filter((r): r is string => typeof r === "string")
      : [];
    return {
      id: s.id,
      dashboardId: s.dashboardId,
      dashboardName: nameById.get(s.dashboardId) ?? "(削除されたダッシュボード)",
      frequency: s.frequency,
      recipients,
      enabled: s.enabled,
      lastSentAt: s.lastSentAt,
      createdAt: s.createdAt,
    };
  });

  return ok(rows);
});

export const POST = withAuth(async (req, { user }) => {
  const workspaceId = user.workspace.id;
  const input = await readJson(req, createReportSchema);

  const dashboard = await db.dashboard.findFirst({
    where: { id: input.dashboardId, workspaceId },
    select: { id: true, name: true },
  });
  if (!dashboard) throw new ApiError("ダッシュボードが見つかりません", 404);

  const recipients = input.recipients ?? [];

  const schedule = await db.reportSchedule.create({
    data: {
      workspaceId,
      dashboardId: dashboard.id,
      frequency: input.frequency,
      recipients: recipients.length ? toJson(recipients) : undefined,
      enabled: true,
    },
  });

  return ok({
    id: schedule.id,
    dashboardId: schedule.dashboardId,
    dashboardName: dashboard.name,
    frequency: schedule.frequency,
    recipients,
    enabled: schedule.enabled,
    lastSentAt: schedule.lastSentAt,
    createdAt: schedule.createdAt,
  });
});
