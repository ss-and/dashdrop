/**
 * Single report schedule endpoint (tenant-scoped).
 * PATCH  — update frequency / recipients / enabled.
 * DELETE — remove the schedule.
 */
import { z } from "zod";
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { db, toJson } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const updateReportSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
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
      recipients:
        input.recipients !== undefined ? toJson(input.recipients) : undefined,
    },
  });

  const recipients = Array.isArray(updated.recipients)
    ? (updated.recipients as unknown[]).filter(
        (r): r is string => typeof r === "string",
      )
    : [];

  return ok({
    id: updated.id,
    dashboardId: updated.dashboardId,
    frequency: updated.frequency,
    recipients,
    enabled: updated.enabled,
    lastSentAt: updated.lastSentAt,
  });
});

export const DELETE = withAuth(async (_req, { user, params }) => {
  const workspaceId = user.workspace.id;
  const schedule = await findSchedule(workspaceId, params.id);

  await db.reportSchedule.delete({ where: { id: schedule.id } });

  return ok({ id: schedule.id });
});
