/**
 * Custom dashboard collection endpoint.
 * POST { name, description?, collectionSlugs: string[], layout: WidgetSpec[] }
 *   → { dashboardId }
 *
 * Saves a dashboard built with the drag-and-drop builder. Unlike the template
 * "apply" flow, this creates NO collections — every widget binds to a sheet the
 * workspace already owns (imported Excel/Sheets included), by slug.
 */
import { z } from "zod";
import { withAuth, ok, readJson } from "@/lib/api";
import { createCustomDashboard } from "@/lib/apply-template";

const bodySchema = z.object({
  name: z.string().min(1, "ダッシュボード名を入力してください"),
  description: z.string().optional(),
  theme: z.string().optional(),
  collectionSlugs: z.array(z.string()).min(1).max(24),
  layout: z.array(z.unknown()).min(1).max(48),
});

export const POST = withAuth(async (req, { user }) => {
  const body = await readJson(req, bodySchema);
  /*
   * 検証済みの body をそのまま渡す。
   *
   * 【回帰】以前はここで項目を1つずつ書き写していて、`theme` を足したときに
   * スキーマだけ直して写し忘れた。**400 にもならず、静かに標準の配色で
   * 保存される**ので、ビルダーで色を選んだ人には「選べるのに効かない」と
   * しか見えない。写経をやめれば、この種の取りこぼしは起きない。
   */
  const { dashboardId } = await createCustomDashboard(user, body);
  return ok({ dashboardId });
});
