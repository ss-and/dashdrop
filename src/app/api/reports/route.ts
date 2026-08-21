/**
 * 定期レポートのコレクション エンドポイント。
 * GET  — このワークスペースのレポート一覧（ダッシュボード名を添えて）。
 * POST — 自分のダッシュボードに対してレポートを作る。
 *
 * 宛先メールは受け取らない。この製品にメールを送る経路が無いためで、
 * 送れない宛先を預かって「送信しました」と言わないための線引き。
 * 配信はアプリ内通知（＋印刷 / PDF ページ）で行う。
 */
import { z } from "zod";
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { REPORT_FREQUENCIES, scheduledNextRun } from "./schedule";
import { assertCapability } from "@/lib/workspace";

const createReportSchema = z.object({
  dashboardId: z.string().trim().min(1, "ダッシュボードを選択してください"),
  frequency: z.enum(REPORT_FREQUENCIES),
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

  const rows = schedules.map((s) => ({
    id: s.id,
    dashboardId: s.dashboardId,
    dashboardName: nameById.get(s.dashboardId) ?? "(削除されたダッシュボード)",
    frequency: s.frequency,
    enabled: s.enabled,
    lastSentAt: s.lastSentAt,
    nextRunAt: scheduledNextRun(s),
    createdAt: s.createdAt,
  }));

  return ok(rows);
});

export const POST = withAuth(async (req, { user }) => {
  // reports は有料プランの機能。判定は assertCapability に一本化する。
  assertCapability(user, "reports");
  const workspaceId = user.workspace.id;
  const input = await readJson(req, createReportSchema);

  const dashboard = await db.dashboard.findFirst({
    where: { id: input.dashboardId, workspaceId },
    select: { id: true, name: true },
  });
  if (!dashboard) throw new ApiError("ダッシュボードが見つかりません", 404);

  const schedule = await db.reportSchedule.create({
    data: {
      workspaceId,
      dashboardId: dashboard.id,
      frequency: input.frequency,
      enabled: true,
    },
  });

  return ok({
    id: schedule.id,
    dashboardId: schedule.dashboardId,
    dashboardName: dashboard.name,
    frequency: schedule.frequency,
    enabled: schedule.enabled,
    lastSentAt: schedule.lastSentAt,
    nextRunAt: scheduledNextRun(schedule),
    createdAt: schedule.createdAt,
  });
});
