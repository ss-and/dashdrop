/**
 * レポート1件のエンドポイント（テナント内に限定）。
 * PATCH  — 頻度の変更 / 自動配信の停止・再開。
 * DELETE — レポートの削除。
 *
 * 宛先メールは扱わない（メールを送る経路がこの製品に無い。理由は ./ の
 * route.ts と send/route.ts のコメントを参照）。
 */
import { z } from "zod";
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { REPORT_FREQUENCIES, scheduledNextRun } from "../schedule";

const updateReportSchema = z.object({
  frequency: z.enum(REPORT_FREQUENCIES).optional(),
  enabled: z.boolean().optional(),
});

async function findSchedule(workspaceId: string, id: string) {
  const schedule = await db.reportSchedule.findFirst({
    where: { id, workspaceId },
  });
  if (!schedule) throw new ApiError("レポートが見つかりません", 404);
  return schedule;
}

export const PATCH = withAuth(async (req, { user, params }) => {
  const workspaceId = user.workspace.id;
  const schedule = await findSchedule(workspaceId, params.id);
  const input = await readJson(req, updateReportSchema);

  const updated = await db.reportSchedule.update({
    where: { id: schedule.id },
    data: {
      frequency: input.frequency ?? undefined,
      enabled: input.enabled ?? undefined,
    },
  });

  return ok({
    id: updated.id,
    dashboardId: updated.dashboardId,
    frequency: updated.frequency,
    enabled: updated.enabled,
    lastSentAt: updated.lastSentAt,
    nextRunAt: scheduledNextRun(updated),
  });
});

export const DELETE = withAuth(async (_req, { user, params }) => {
  const workspaceId = user.workspace.id;
  const schedule = await findSchedule(workspaceId, params.id);

  await db.reportSchedule.delete({ where: { id: schedule.id } });

  return ok({ id: schedule.id });
});
