/**
 * Live widget preview for the drag-and-drop builder.
 * POST { collectionSlugs: string[], layout: unknown[] }
 *   → { results: Record<widgetId, WidgetData | null> }
 *
 * Tolerant by design: each layout item is parsed independently, so a
 * half-configured widget just yields `null` (the UI shows a "設定を完成させて"
 * hint) instead of failing the whole request. Reuses the exact same
 * aggregation path as the real renderer, so the preview matches the saved
 * dashboard byte-for-byte. Tenant-safe: only the caller's sheets are loaded.
 */
import { z } from "zod";
import { withAuth, ok, readJson } from "@/lib/api";
import { loadDashboardCollections } from "@/lib/apply-template";
import { computeWidget, type CollectionMap } from "@/lib/aggregate";
import { widgetSchema, type WidgetData } from "@/lib/widgets";

const bodySchema = z.object({
  collectionSlugs: z.array(z.string()).max(24).default([]),
  layout: z.array(z.unknown()).max(24).default([]),
});

export const POST = withAuth(async (req, { user }) => {
  const { collectionSlugs, layout } = await readJson(req, bodySchema);

  let map: CollectionMap = new Map();
  if (collectionSlugs.length > 0) {
    map = await loadDashboardCollections(user.workspace.id, collectionSlugs);
  }

  const now = new Date();
  const results: Record<string, WidgetData | null> = {};
  for (const raw of layout) {
    const id =
      raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string"
        ? (raw as { id: string }).id
        : null;
    if (!id) continue;
    const parsed = widgetSchema.safeParse(raw);
    results[id] = parsed.success ? computeWidget(parsed.data, map, now) : null;
  }

  return ok({ results });
});
