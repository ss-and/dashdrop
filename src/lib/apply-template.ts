/**
 * Apply a dashboard template (or an ad-hoc DashboardTemplate from the AI flow)
 * to a workspace: create its collections + fields, seed realistic sample rows,
 * and persist a Dashboard whose widget layout references the actually-created
 * collection slugs. Tenant-safe and plan-limited.
 */
import { db, toJson } from "./db";
import { ApiError } from "./errors";
import { slugify, uniqueName } from "./utils";
import { getPlan } from "./plans";
import {
  assertWithinCollectionLimit,
  takenSlugsWithReserved,
} from "./master-objects";
import { logActivity } from "./workspace";
import { generateSampleRows } from "./sample-data";
import {
  dashboardTemplateSchema,
  dashboardLayoutSchema,
  type DashboardTemplate,
  type WidgetSpec,
} from "./widgets";
import { autoLayout, type AutoSheet } from "./widget-builder";
import { profileFields } from "./data-profile";
import { autoLayoutFromProfiles, type ProfiledSheet } from "./auto-layout";
import type { CurrentUser } from "./auth";
import type { AggCollection, CollectionMap } from "./aggregate";
import {
  resolveCollectionRecords,
  type EngineCollection,
} from "./relations";

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
  assertWithinCollectionLimit(plan, existing, template.collections.length);
  for (const c of template.collections) {
    const rows = withSampleData ? c.sampleRows : 0;
    if (rows > plan.limits.recordsPerCollection) {
      throw new ApiError(
        `プラン「${plan.name}」の1テーブルあたり行数上限を超えます。`,
        403,
      );
    }
  }

  // マスターDBの slug は予約語 — 詳細は master-objects.ts。
  const takenSlugs = takenSlugsWithReserved(existing);
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

export interface CustomDashboardInput {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  collectionSlugs: string[];
  layout: unknown; // validated here against dashboardLayoutSchema
}

/**
 * Persist a user-built ("custom") dashboard whose widgets reference *existing*
 * spreadsheets in the workspace — including sheets imported from Excel/Sheets.
 * This is the save target for the drag-and-drop builder: no collections are
 * created, we only bind widgets to real data by slug.
 */
export async function createCustomDashboard(
  user: CurrentUser,
  input: CustomDashboardInput,
): Promise<{ dashboardId: string }> {
  const workspaceId = user.workspace.id;

  const parsed = dashboardLayoutSchema.safeParse(input.layout);
  if (!parsed.success) {
    throw new ApiError(
      "ウィジェットを1つ以上追加し、各ウィジェットの設定（データ元・項目）を完成させてください。",
      400,
    );
  }

  // Keep only slugs that actually belong to this workspace.
  const owned = await db.collection.findMany({
    where: { workspaceId, slug: { in: input.collectionSlugs } },
    select: { slug: true },
  });
  const slugs = owned.map((c) => c.slug);
  if (slugs.length === 0) {
    throw new ApiError("データ元のスプレッドシートを選んでください。", 400);
  }
  // Every widget must point at one of the bound sheets.
  const layout = parsed.data.filter((w) => slugs.includes(w.collection));
  if (layout.length === 0) {
    throw new ApiError(
      "ウィジェットのデータ元が、選んだスプレッドシートと一致していません。",
      400,
    );
  }

  const dashboard = await db.dashboard.create({
    data: {
      workspaceId,
      name: input.name.trim() || "無題のダッシュボード",
      category: "custom",
      description: input.description?.trim() ?? "",
      icon: input.icon ?? "dashboard",
      color: input.color ?? "khaki",
      collectionSlugs: toJson(slugs),
      layout: toJson(layout),
      source: "custom",
      position: await db.dashboard.count({ where: { workspaceId } }),
    },
  });

  await logActivity(workspaceId, "collection.created", {
    dashboardId: dashboard.id,
    source: "builder",
  });

  return { dashboardId: dashboard.id };
}

/**
 * One-click "おすすめ構成で自動作成": build a starter dashboard from a freshly
 * imported file (workbook) or a single sheet, using autoLayout heuristics.
 * Returns the new dashboard id + name so the caller can navigate to it.
 */
/** 傾向を掴むのに十分な行数。全件読む必要はない。 */
const AUTO_PROFILE_SAMPLE = 5000;

/**
 * 自動作成したダッシュボードの説明文。
 *
 * ただの文言ではなく**目印**として使っている。同じファイルを入れ直すたびに
 * 同じ名前のダッシュボードが増えると、サイドバーに区別の付かない行が並ぶ。
 * 作り直しなら作り直しと分かるように、この文言を持つものだけを更新の対象に
 * する（利用者が自分で作ったダッシュボードは、名前がたまたま同じでも触らない）。
 */
const AUTO_DESCRIPTION = "取り込んだデータから自動作成しました。";

export async function createAutoDashboard(
  user: CurrentUser,
  opts: { workbookId?: string; collectionId?: string },
): Promise<{
  dashboardId: string;
  name: string;
  /** 既存の自動ダッシュボードを作り直したか。false なら新規作成。 */
  replaced: boolean;
  /** 一緒に片付けた同名の重複の数。 */
  merged: number;
}> {
  const workspaceId = user.workspace.id;

  let sheets: AutoSheet[] = [];
  let baseName = "ダッシュボード";

  if (opts.workbookId) {
    const wb = await db.workbook.findFirst({
      where: { id: opts.workbookId, workspaceId },
      include: {
        collections: {
          orderBy: { position: "asc" },
          include: { fields: { orderBy: { position: "asc" } } },
        },
      },
    });
    if (!wb) throw new ApiError("ファイルが見つかりません", 404);
    baseName = wb.name;
    sheets = wb.collections.map((c) => ({
      slug: c.slug,
      name: c.name,
      fields: c.fields.map((f) => ({ key: f.key, name: f.name, type: f.type })),
    }));
  } else if (opts.collectionId) {
    const c = await db.collection.findFirst({
      where: { id: opts.collectionId, workspaceId },
      include: { fields: { orderBy: { position: "asc" } } },
    });
    if (!c) throw new ApiError("スプレッドシートが見つかりません", 404);
    baseName = c.name;
    sheets = [
      {
        slug: c.slug,
        name: c.name,
        fields: c.fields.map((f) => ({ key: f.key, name: f.name, type: f.type })),
      },
    ];
  } else {
    throw new ApiError("対象が指定されていません", 400);
  }

  /*
   * 列の中身を数えてから組み立てる。
   *
   * 列名と型だけで決めていたときは、`案件ID` を軸にドーナツを作り（全部1件の
   * スライス）、値の無い数式列を合計して 0 を並べていた。1行読めば分かることを
   * 読まずに推測していたのが原因なので、ここでレコードを取り、統計を渡す。
   * 行数は上限つき——傾向を見るのに全件は要らない。
   */
  const profiled: ProfiledSheet[] = [];
  for (const sheet of sheets) {
    const collection = await db.collection.findFirst({
      where: { workspaceId, slug: sheet.slug },
      select: { id: true },
    });
    if (!collection) continue;
    const records = await db.record.findMany({
      where: { collectionId: collection.id },
      select: { data: true },
      take: AUTO_PROFILE_SAMPLE,
    });
    const rows = records.map(
      (r) => (r.data as Record<string, unknown>) ?? {},
    );
    profiled.push({
      slug: sheet.slug,
      name: sheet.name,
      rowCount: rows.length,
      fields: profileFields(rows, sheet.fields),
    });
  }

  // 中身が読めたときはそれを使い、読めなければ従来の型ベースに落とす。
  const layout = profiled.some((p) => p.rowCount > 0)
    ? autoLayoutFromProfiles(profiled)
    : autoLayout(sheets);
  if (layout.length === 0) {
    throw new ApiError(
      "自動作成できる項目が見つかりませんでした。ビルダーから手動で作成してください。",
      422,
    );
  }

  const usedSlugs = Array.from(new Set(layout.map((w) => w.collection)));
  const name = `${baseName} ダッシュボード`;

  /*
   * 同じ名前の自動ダッシュボードが既にあれば、新しく作らずに中身を差し替える。
   *
   * 利用者の指摘そのもの:「ダッシュボード重複しているやつとかわかりづらくなるね、
   * 同じExcel名なら上書きとかが良さそうだよ」。URL も変わらないので、
   * ブックマークや共有リンクもそのまま生きる。
   */
  const siblings = await db.dashboard.findMany({
    where: { workspaceId, name, description: AUTO_DESCRIPTION },
    orderBy: { createdAt: "asc" },
    select: { id: true, shareToken: true },
  });

  if (siblings.length === 0) {
    const { dashboardId } = await createCustomDashboard(user, {
      name,
      description: AUTO_DESCRIPTION,
      collectionSlugs: usedSlugs,
      layout,
    });
    return { dashboardId, name, replaced: false, merged: 0 };
  }

  const keep = siblings[0];
  await updateCustomDashboard(user, keep.id, {
    name,
    description: AUTO_DESCRIPTION,
    collectionSlugs: usedSlugs,
    layout,
  });

  /*
   * 過去に増えてしまった同名の自動ダッシュボードは、ここで1本にまとめる。
   * どれも同じファイルから同じ手順で作られたもので、名前が同じである以上
   * 利用者には見分けが付かない——残しても選べない。
   *
   * ただし共有リンクを配ってあるものは消さない。こちらの都合で、外の人が見て
   * いるページを消してよい理由にはならない。
   */
  const removable = siblings.slice(1).filter((d) => d.shareToken === null);
  if (removable.length > 0) {
    await db.dashboard.deleteMany({
      where: { id: { in: removable.map((d) => d.id) } },
    });
  }

  return { dashboardId: keep.id, name, replaced: true, merged: removable.length };
}

/**
 * Update a custom (or any) dashboard's editable fields in place. Only the
 * provided fields change; `layout` is re-validated and re-scoped to the bound
 * (or newly provided) sheets.
 */
export async function updateCustomDashboard(
  user: CurrentUser,
  dashboardId: string,
  input: Partial<CustomDashboardInput>,
): Promise<{ dashboardId: string }> {
  const workspaceId = user.workspace.id;
  const existing = await db.dashboard.findFirst({
    where: { id: dashboardId, workspaceId },
  });
  if (!existing) throw new ApiError("ダッシュボードが見つかりません", 404);

  const data: Record<string, unknown> = {};
  if (typeof input.name === "string") {
    data.name = input.name.trim() || "無題のダッシュボード";
  }
  if (typeof input.description === "string") {
    data.description = input.description.trim();
  }

  // Resolve the sheets this dashboard binds to (new list or the current one).
  let slugs: string[] | null = null;
  if (input.collectionSlugs) {
    const owned = await db.collection.findMany({
      where: { workspaceId, slug: { in: input.collectionSlugs } },
      select: { slug: true },
    });
    slugs = owned.map((c) => c.slug);
    data.collectionSlugs = toJson(slugs);
  } else if (Array.isArray(existing.collectionSlugs)) {
    slugs = (existing.collectionSlugs as unknown[]).filter(
      (s): s is string => typeof s === "string",
    );
  }

  if (input.layout !== undefined) {
    const parsed = dashboardLayoutSchema.safeParse(input.layout);
    if (!parsed.success) {
      throw new ApiError(
        "ウィジェットの設定を完成させてください。",
        400,
      );
    }
    const scoped = slugs
      ? parsed.data.filter((w) => slugs!.includes(w.collection))
      : parsed.data;
    if (scoped.length === 0) {
      throw new ApiError("有効なウィジェットがありません。", 400);
    }
    data.layout = toJson(scoped);
  }

  await db.dashboard.update({ where: { id: dashboardId }, data });
  return { dashboardId };
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
    // Resolve relation rollup/lookup so widgets can aggregate cross-spreadsheet
    // values (the computed field values are merged into each record's data).
    const resolved = await resolveCollectionRecords(
      workspaceId,
      c as unknown as EngineCollection,
      c.records.map((r) => ({ id: r.id, data: (r.data as Record<string, unknown>) ?? {} })),
    );
    const computedById = new Map(resolved.records.map((r) => [r.id, r.computed]));

    const agg: AggCollection = {
      slug: c.slug,
      name: c.name,
      id: c.id,
      fields: c.fields.map((f) => ({
        key: f.key,
        name: f.name,
        type: f.type,
        options: (f.options as AggCollection["fields"][number]["options"]) ?? null,
      })),
      records: c.records.map((r) => ({
        id: r.id,
        data: {
          ...((r.data as Record<string, unknown>) ?? {}),
          ...(computedById.get(r.id) ?? {}),
        },
        createdAt: r.createdAt,
        isSampleData: r.isSampleData,
      })),
    };
    map.set(c.slug, agg);
  }
  return map;
}
