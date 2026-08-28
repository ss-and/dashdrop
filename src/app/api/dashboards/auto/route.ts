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

/**
 * 取り込み直後に必ず続けて叩かれる、「入れたらグラフが出てきた」の後半。
 *
 * 中身は軽くない——シート1枚につき2クエリ、さらに1枚あたり最大5,000行
 * （AUTO_PROFILE_SAMPLE）を読んで列の傾向を数える。タブの多いブックでは
 * 素直に数秒〜十数秒かかるので、既定（10〜15秒）のままだと、取り込みは
 * 成功しているのにグラフの手前だけが切られる。
 *
 * 60 は Vercel Pro の最大（800秒）ではなく、Hobby でも他のホスティングでも
 * 通る値。/api/import・/api/import/preview・/api/import/analyze と同じ値。
 */
export const maxDuration = 60;

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
