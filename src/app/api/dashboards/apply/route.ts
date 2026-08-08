/**
 * Apply a dashboard template to the caller's workspace.
 * POST { templateKey, withSampleData? } — creates the template's collections
 * (with sample data by default) and a Dashboard referencing them, then returns
 * the new dashboard id so the client can navigate to it.
 */
import { z } from "zod";
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { getTemplate } from "@/lib/dashboard-templates";
import { applyTemplate } from "@/lib/apply-template";

const applySchema = z.object({
  templateKey: z.string().min(1),
  withSampleData: z.boolean().optional(),
});

export const POST = withAuth(async (req, { user }) => {
  const { templateKey, withSampleData } = await readJson(req, applySchema);

  const template = getTemplate(templateKey);
  if (!template) {
    throw new ApiError("テンプレートが見つかりません", 404);
  }

  const { dashboardId } = await applyTemplate(user, template, {
    withSampleData: withSampleData ?? true,
  });

  return ok({ dashboardId });
});
