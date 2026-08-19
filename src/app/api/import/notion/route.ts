/**
 * Notion import commit endpoint.
 * POST JSON: { databaseId: string, collectionName?: string }
 *
 * Same end state as /api/import and /api/import/gsheets — one Workbook holding
 * one Collection with typed Fields and one Record per row — but the source is a
 * Notion database read through the REST API with the workspace's stored token.
 *
 * Fields come from the Notion *schema* (property types), not from sampled
 * values: Notion already knows a column is a date or a select, so guessing from
 * strings would only lose information. Plan limits are checked before any write
 * and the whole import is all-or-nothing.
 */
import { withAuth, ok, ApiError, readJson } from "@/lib/api";
import { z } from "zod";
import { db, toJson } from "@/lib/db";
import { slugify, uniqueName } from "@/lib/utils";
import { assertCanCreateCollection, logActivity } from "@/lib/workspace";
import { getPlan } from "@/lib/plans";
import { coerceValue } from "@/lib/field-types";
import { getSecret, recordResult } from "@/lib/integrations";
import {
  fetchDatabase,
  queryDatabase,
  notionFields,
  databaseTitle,
  readPropertyValue,
  DEFAULT_MAX_ROWS,
} from "@/lib/notion";

const BATCH_SIZE = 500;

const bodySchema = z.object({
  databaseId: z.string().min(1, "データベースを選択してください。"),
  collectionName: z.string().optional(),
});

export const POST = withAuth(async (req, { user }) => {
  const body = await readJson(req, bodySchema);

  const token = await getSecret(user.workspace.id, "notion");
  if (!token) {
    throw new ApiError(
      "Notionが接続されていません。設定画面でインテグレーション トークンを登録してください。",
      400,
    );
  }

  // Cheap guard before we fetch anything.
  await assertCanCreateCollection(user);
  const plan = getPlan(user.workspace.plan);

  // --- Read Notion: schema first, then rows ---
  let database: Record<string, unknown>;
  let pages: Record<string, unknown>[];
  try {
    database = await fetchDatabase(token, body.databaseId);
    pages = await queryDatabase(token, body.databaseId, {
      maxRows: Math.min(DEFAULT_MAX_ROWS, plan.limits.recordsPerCollection + 1),
    });
    await recordResult(user.workspace.id, "notion", true);
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "Notionの読み込みに失敗しました。";
    await recordResult(user.workspace.id, "notion", false, message);
    throw err instanceof ApiError ? err : new ApiError(message, 502);
  }

  const fields = notionFields(database);
  if (fields.length === 0) {
    throw new ApiError(
      "このデータベースには取り込める列がありません。",
      422,
    );
  }
  if (pages.length > plan.limits.recordsPerCollection) {
    throw new ApiError(
      `データベースの行数がプラン「${plan.name}」の上限（${plan.limits.recordsPerCollection.toLocaleString()}）を超えます。`,
      403,
    );
  }

  // --- Prepare names/slugs BEFORE any write ---
  const existing = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
    select: { slug: true },
  });
  if (existing.length + 1 > plan.limits.collections) {
    throw new ApiError(
      `プラン「${plan.name}」のスプレッドシート上限（${plan.limits.collections}）を超えます。`,
      403,
    );
  }
  const takenSlugs = new Set(existing.map((c) => c.slug));

  const collectionName =
    (body.collectionName && body.collectionName.trim()) ||
    databaseTitle(database) ||
    "Notion";
  const slug = uniqueName(slugify(collectionName), takenSlugs);

  // --- Flatten every Notion page into a DashDrop record ---
  let skipped = 0;
  const recordData = pages.map((page) => {
    const props = page.properties;
    const source =
      typeof props === "object" && props !== null
        ? (props as Record<string, unknown>)
        : {};
    const data: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = readPropertyValue(source[f.notionName]);
      const result = coerceValue(f.type, raw, f.options);
      if (result.ok) data[f.key] = result.value;
      else {
        data[f.key] = null;
        skipped += 1;
      }
    }
    return data;
  });

  // --- One Workbook grouping the imported database ---
  const workbook = await db.workbook.create({
    data: {
      workspaceId: user.workspace.id,
      name: collectionName,
      source: "notion",
    },
  });

  let createdCollectionId: string | null = null;
  let collectionId: string;
  try {
    const collection = await db.collection.create({
      data: {
        workspaceId: user.workspace.id,
        workbookId: workbook.id,
        name: collectionName,
        slug,
        description: "",
        icon: "table",
        color: "khaki",
        template: "custom",
        position: existing.length,
        fields: {
          create: fields.map((f, index) => ({
            key: f.key,
            name: f.name,
            type: f.type,
            required: false,
            options: f.options ? toJson(f.options) : undefined,
            position: index,
          })),
        },
      },
    });
    collectionId = collection.id;
    createdCollectionId = collection.id;

    for (let i = 0; i < recordData.length; i += BATCH_SIZE) {
      const batch = recordData.slice(i, i + BATCH_SIZE);
      await db.$transaction(
        batch.map((data) =>
          db.record.create({
            data: {
              collectionId: collection.id,
              createdById: user.id,
              data: toJson(data),
            },
          }),
        ),
      );
    }

    await logActivity(user.workspace.id, "collection.created", {
      collectionId: collection.id,
      name: collectionName,
      template: "custom",
      source: "notion",
    });
  } catch (err) {
    // All-or-nothing: drop the collection (fields/records cascade) first — the
    // workbook relation is SetNull, so deleting the workbook alone would leave
    // a half-imported orphan spreadsheet behind.
    if (createdCollectionId) {
      await db.collection
        .delete({ where: { id: createdCollectionId } })
        .catch(() => {});
    }
    await db.workbook.delete({ where: { id: workbook.id } }).catch(() => {});
    if (err instanceof ApiError) throw err;
    console.error("Notion import failed:", err);
    throw new ApiError("インポート中にエラーが発生しました", 500);
  }

  await logActivity(user.workspace.id, "import.completed", {
    sheets: 1,
    rows: pages.length,
    source: "notion",
    collectionId,
    workbookId: workbook.id,
    fileName: collectionName,
    sheetNames: [collectionName],
    skipped,
  });

  return ok({
    collectionId,
    workbookId: workbook.id,
    imported: pages.length,
    skipped,
    sheetsImported: 1,
    collections: [
      { id: collectionId, name: collectionName, imported: pages.length, skipped },
    ],
  });
});
