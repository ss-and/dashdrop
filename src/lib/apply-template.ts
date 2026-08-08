/**
 * Apply a dashboard template (or an ad-hoc DashboardTemplate from the AI flow)
 * to a workspace: create its collections + fields, seed realistic sample rows,
 * and persist a Dashboard whose widget layout references the actually-created
 * collection slugs. Tenant-safe and plan-limited.
 */
import { db, toJson } from "./db";
import { ApiError } from "./api";
import { slugify, uniqueName } from "./utils";
import { getPlan } from "./plans";
import { logActivity } from "./workspace";
import { generateSampleRows } from "./sample-data";
import {
  dashboardTemplateSchema,
  type DashboardTemplate,
  type WidgetSpec,
} from "./widgets";
import type { CurrentUser } from "./auth";
import type { AggCollection, CollectionMap } from "./aggregate";

const SAMPLE_BATCH = 200;

export interface ApplyResult {
  dashboardId: string;
  collections: Array<{ id: string; slug: string; name: string }>;
  seededRows: number;
}

/**
 * @param withSampleData seed demo rows so charts populate immediately (default true)
 */
export async function applyTemplate(
  user: CurrentUser,
  templateInput: DashboardTemplate,
  opts: { withSampleData?: boolean; source?: string } = {},
): Promise<ApplyResult> {
  const template = dashboardTemplateSchema.parse(templateInput);
  const withSampleData = opts.withSampleData ?? true;
  const workspaceId = user.workspace.id;
  const plan = getPlan(user.workspace.plan);

  // --- Plan limits (checked before any write) ---
  const existing = await db.collection.findMany({
    where: { workspaceId },
    select: { slug: true },
  });
  if (existing.length + template.collections.length > plan.limits.collections) {
    throw new ApiError(
      `プラン「${plan.name}」のテーブル上限（${plan.limits.collections}）を超えます。`,
      403,
    );
  }
  for (const c of template.collections) {
    const rows = withSampleData ? c.sampleRows : 0;
    if (rows > plan.limits.recordsPerCollection) {
      throw new ApiError(
        `プラン「${plan.name}」の1テーブルあたり行数上限を超えます。`,
        403,
      );
    }
  }

  const takenSlugs = new Set(existing.map((c) => c.slug));
  const slugMap = new Map<string, string>(); // template slug -> actual slug
  const created: Array<{ id: string; slug: string; name: string }> = [];
  let seededRows = 0;
  let position = existing.length;

  try {
    for (const tc of template.collections) {
      const actualSlug = uniqueName(slugify(tc.slug || tc.name), takenSlugs);
      takenSlugs.add(actualSlug);
      slugMap.set(tc.slug, actualSlug);

      const collection = await db.collection.create({
        data: {
          workspaceId,
          name: tc.name,
          slug: actualSlug,
          description: "",
          icon: tc.icon,
          color: tc.color,
          template: "custom",
          position: position++,
          fields: {
            create: tc.fields.map((f, i) => ({
              key: f.key,
              name: f.name,
              type: f.type,
              required: f.required ?? false,
              options: f.options ? toJson(f.options) : undefined,
              position: i,
            })),
          },
        },
      });
      created.push({ id: collection.id, slug: actualSlug, name: tc.name });

      if (withSampleData && tc.sampleRows > 0) {
        const rows = generateSampleRows(tc);
        for (let i = 0; i < rows.length; i += SAMPLE_BATCH) {
          const batch = rows.slice(i, i + SAMPLE_BATCH);
          await db.$transaction(
            batch.map((row) =>
              db.record.create({
                data: {
                  collectionId: collection.id,
                  createdById: user.id,
                  isSampleData: true,
                  createdAt: row.createdAt,
                  data: toJson(row.data),
                },
              }),
            ),
          );
        }
        seededRows += rows.length;
      }
    }

    // Rewrite widget collection references to the actual slugs.
    const layout: WidgetSpec[] = template.widgets.map((w) => ({
      ...w,
      collection: slugMap.get(w.collection) ?? w.collection,
    }));

    const dashboard = await db.dashboard.create({
      data: {
        workspaceId,
        name: template.name,
        category: template.category,
        description: template.description,
        icon: template.icon,
        color: template.color,
        collectionSlugs: toJson(created.map((c) => c.slug)),
        layout: toJson(layout),
        source: opts.source ?? `template:${template.key}`,
        position: await db.dashboard.count({ where: { workspaceId } }),
      },
    });

    await logActivity(workspaceId, "collection.created", {
      dashboardId: dashboard.id,
      template: template.key,
    });

    return { dashboardId: dashboard.id, collections: created, seededRows };
  } catch (err) {
    // Roll back any collections we created so a failure leaves no partial state.
    if (created.length > 0) {
      await db.collection
        .deleteMany({ where: { id: { in: created.map((c) => c.id) } } })
        .catch(() => {});
    }
    if (err instanceof ApiError) throw err;
    console.error("applyTemplate failed:", err);
    throw new ApiError("ダッシュボードの作成に失敗しました", 500);
  }
}

/**
 * Build the CollectionMap (keyed by slug) a dashboard needs to render, scoped
 * to the workspace. Only loads the collections the dashboard references.
 */
export async function loadDashboardCollections(
  workspaceId: string,
  slugs: string[],
): Promise<CollectionMap> {
  const collections = await db.collection.findMany({
    where: { workspaceId, slug: { in: slugs } },
    include: {
      fields: { orderBy: { position: "asc" } },
      records: { orderBy: { createdAt: "asc" } },
    },
  });

  const map: CollectionMap = new Map();
  for (const c of collections) {
    const agg: AggCollection = {
      slug: c.slug,
      name: c.name,
      fields: c.fields.map((f) => ({
        key: f.key,
        name: f.name,
        type: f.type,
        options: (f.options as AggCollection["fields"][number]["options"]) ?? null,
      })),
      records: c.records.map((r) => ({
        id: r.id,
        data: (r.data as Record<string, unknown>) ?? {},
        createdAt: r.createdAt,
        isSampleData: r.isSampleData,
      })),
    };
    map.set(c.slug, agg);
  }
  return map;
}
