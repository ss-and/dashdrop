/**
 * One-click auto dashboard.
 * POST { workbookId?: string, collectionId?: string } → { dashboardId, name }
 *
 * Builds a sensible starter dashboard (KPIs + a time series + a breakdown + a
 * detail table) from a freshly imported file or a single sheet, so the user goes
 * from "取り込んだ" to "見られる" in one click, then tweaks in the builder.
 */
import { z } from "zod";
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { createAutoDashboard } from "@/lib/apply-template";
import { dashboardIntentSchema } from "@/lib/dashboard-intent";

const bodySchema = z
  .object({
    workbookId: z.string().optional(),
    collectionId: z.string().optional(),
    /** 取り込みで聞いた「どんな画面が欲しいか」。省略すればおまかせ。 */
    intent: dashboardIntentSchema.optional(),
  })
  .refine((b) => b.workbookId || b.collectionId, {
    message: "workbookId か collectionId のいずれかが必要です",
  });

export const POST = withAuth(async (req, { user }) => {
  const body = await readJson(req, bodySchema);
  try {
    const result = await createAutoDashboard(user, body);
    return ok(result);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error("auto dashboard failed:", err);
    throw new ApiError("ダッシュボードの自動作成に失敗しました", 500);
  }
});
