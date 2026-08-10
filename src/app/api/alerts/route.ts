/**
 * Alert rules collection endpoint.
 * GET  — list this workspace's threshold rules (with the source sheet's name).
 * POST — create a rule targeting one collection's metric.
 */
import { z } from "zod";
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { measureSchema, filterSchema } from "@/lib/widgets";

const metricSchema = z.object({
  measure: measureSchema,
  filters: z.array(filterSchema).optional(),
});

const createAlertSchema = z.object({
  name: z.string().min(1, "名前を入力してください").max(120),
  collectionId: z.string().min(1, "スプレッドシートを選択してください"),
  metric: metricSchema,
  operator: z.enum(["gt", "gte", "lt", "lte"]),
  threshold: z.number().finite("しきい値を入力してください"),
  channel: z.enum(["inapp", "slack"]).optional(),
});

export const GET = withAuth(async (_req, { user }) => {
  const [rules, collections] = await Promise.all([
    db.alertRule.findMany({
      where: { workspaceId: user.workspace.id },
      orderBy: { createdAt: "desc" },
    }),
    db.collection.findMany({
      where: { workspaceId: user.workspace.id },
      select: { id: true, name: true },
    }),
  ]);

  const nameById = new Map(collections.map((c) => [c.id, c.name]));
  return ok(
    rules.map((r) => ({
      ...r,
      collectionName: nameById.get(r.collectionId) ?? "（削除されたシート）",
    })),
  );
});

export const POST = withAuth(async (req, { user }) => {
  const input = await readJson(req, createAlertSchema);

  // Scope the target collection to this workspace before writing.
  const collection = await db.collection.findFirst({
    where: { id: input.collectionId, workspaceId: user.workspace.id },
    select: { id: true, name: true },
  });
  if (!collection) {
    throw new ApiError(
      "指定されたスプレッドシートが見つかりません。ワークスペース内のシートを選択してください。",
      404,
    );
  }

  const rule = await db.alertRule.create({
    data: {
      workspaceId: user.workspace.id,
      name: input.name,
      collectionId: collection.id,
      metric: toJson(input.metric),
      operator: input.operator,
      threshold: input.threshold,
      channel: input.channel ?? "inapp",
    },
  });

  return ok({ ...rule, collectionName: collection.name });
});
