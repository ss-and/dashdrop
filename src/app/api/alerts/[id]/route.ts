/**
 * Single alert rule endpoint.
 * PATCH  — update name/threshold/operator/metric/enabled (scoped).
 * DELETE — remove the rule (scoped).
 */
import { z } from "zod";
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { measureSchema, filterSchema } from "@/lib/widgets";

const metricSchema = z.object({
  measure: measureSchema,
  filters: z.array(filterSchema).optional(),
});

const updateAlertSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  threshold: z.number().finite().optional(),
  operator: z.enum(["gt", "gte", "lt", "lte"]).optional(),
  metric: metricSchema.optional(),
  enabled: z.boolean().optional(),
});

async function findRule(workspaceId: string, id: string) {
  const rule = await db.alertRule.findFirst({ where: { id, workspaceId } });
  if (!rule) throw new ApiError("アラートが見つかりません。", 404);
  return rule;
}

export const PATCH = withAuth(async (req, { user, params }) => {
  await findRule(user.workspace.id, params.id);
  const input = await readJson(req, updateAlertSchema);

  const rule = await db.alertRule.update({
    where: { id: params.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
      ...(input.operator !== undefined ? { operator: input.operator } : {}),
      ...(input.metric !== undefined ? { metric: toJson(input.metric) } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    },
  });

  return ok(rule);
});

export const DELETE = withAuth(async (_req, { user, params }) => {
  await findRule(user.workspace.id, params.id);
  await db.alertRule.delete({ where: { id: params.id } });
  return ok({ id: params.id });
});
