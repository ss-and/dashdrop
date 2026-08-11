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
  collectionSlugs: z.array(z.string()).min(1).max(24),
  layout: z.array(z.unknown()).min(1).max(24),
});

export const POST = withAuth(async (req, { user }) => {
  const body = await readJson(req, bodySchema);
  const { dashboardId } = await createCustomDashboard(user, {
    name: body.name,
    description: body.description,
    collectionSlugs: body.collectionSlugs,
    layout: body.layout,
  });
  return ok({ dashboardId });
});
