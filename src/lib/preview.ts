/**
 * Build an in-memory preview of a dashboard template — the same computed widget
 * data the live renderer uses, but from freshly generated sample rows and
 * WITHOUT touching the database. Powers the "見てから使う" gallery preview.
 */
import { generateSampleRows } from "./sample-data";
import {
  computeDashboard,
  type AggCollection,
  type CollectionMap,
} from "./aggregate";
import type { DashboardTemplate } from "./widgets";

export function buildTemplatePreview(template: DashboardTemplate) {
  const map: CollectionMap = new Map();
  for (const c of template.collections) {
    const rows = generateSampleRows(c);
    const agg: AggCollection = {
      slug: c.slug,
      name: c.name,
      fields: c.fields.map((f) => ({
        key: f.key,
        name: f.name,
        type: f.type,
        options: f.options ?? null,
      })),
      records: rows.map((r, i) => ({
        id: `preview-${i}`,
        data: r.data,
        createdAt: r.createdAt,
      })),
    };
    map.set(c.slug, agg);
  }
  return computeDashboard(template.widgets, map);
}
