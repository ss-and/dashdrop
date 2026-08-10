/**
 * Alert preview endpoint. Computes the current value of a metric over one
 * collection so the create/edit form can show "現在値" before saving a rule.
 */
import { z } from "zod";
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { computeMetricValue } from "@/lib/alerts";
import { measureSchema, filterSchema } from "@/lib/widgets";

const previewSchema = z.object({
  collectionId: z.string().min(1, "スプレッドシートを選択してください"),
  metric: z.object({
    measure: measureSchema,
    filters: z.array(filterSchema).optional(),
  }),
});

export const POST = withAuth(async (req, { user }) => {
  const input = await readJson(req, previewSchema);

  const collection = await db.collection.findFirst({
    where: { id: input.collectionId, workspaceId: user.workspace.id },
    select: { id: true },
  });
  if (!collection) {
    throw new ApiError("指定されたスプレッドシートが見つかりません。", 404);
  }

  const value = await computeMetricValue(
    user.workspace.id,
    collection.id,
    input.metric,
  );

  return ok({ value });
});
