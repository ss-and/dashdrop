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
  truncationMessage,
  DEFAULT_MAX_ROWS,
  NOTION_IMPORT_BUDGET_MS,
  type NotionQueryResult,
} from "@/lib/notion";

const BATCH_SIZE = 500;

/**
 * Notionの読み取り予算（40秒）＋行の書き込み分。予算を先に使い切れば日本語の
 * エラー／警告を返せるが、プラットフォーム側に切られると利用者には何も残らない。
 */
export const maxDuration = 60;

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
  // 全体の締め切り。1リクエスト15秒×30往復＝最悪450秒を防ぐ唯一の歯止め。
  const deadlineAt = Date.now() + NOTION_IMPORT_BUDGET_MS;
  let database: Record<string, unknown>;
  let query: NotionQueryResult;
  try {
    database = await fetchDatabase(token, body.databaseId, { deadlineAt });
    query = await queryDatabase(token, body.databaseId, {
      maxRows: Math.min(DEFAULT_MAX_ROWS, plan.limits.recordsPerCollection + 1),
      deadlineAt,
    });
    await recordResult(user.workspace.id, "notion", true);
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "Notionの読み込みに失敗しました。";
    await recordResult(user.workspace.id, "notion", false, message);
    throw err instanceof ApiError ? err : new ApiError(message, 502);
  }

  const pages = query.pages;
  // 打ち切りは「警告付きの成功」。ここでエラーにすると上限超えの利用者は
  // 何も取り込めなくなるので、代わりにAPIレスポンスと操作ログの両方に載せて
  // 「完全に取り込めた」と誤解させない。
  const truncatedMessage = truncationMessage(query);

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
    //
    // 順序は「保証」でなければ意味がない。以前は両方 .catch(() => {}) で、
    // Workbook の削除も無条件に走っていた。Collection の削除だけ失敗すると
    // 「失敗しました」と伝えた裏で中途半端なシートが独立して残る。
    let rolledBack = true;
    if (createdCollectionId) {
      try {
        await db.collection.delete({ where: { id: createdCollectionId } });
      } catch (cleanupErr) {
        rolledBack = false;
        console.error(
          `Notion import rollback: collection ${createdCollectionId} could not be deleted; workbook ${workbook.id} kept so it is not orphaned`,
          cleanupErr,
        );
      }
    }
    if (rolledBack) {
      try {
        await db.workbook.delete({ where: { id: workbook.id } });
      } catch (cleanupErr) {
        // Collection は消えているので孤児は残らない。空の Workbook のみ。
        rolledBack = false;
        console.error(
          `Notion import rollback: empty workbook ${workbook.id} could not be deleted`,
          cleanupErr,
        );
      }
    }

    if (!rolledBack) {
      // 片付けきれなかったことは黙らない。利用者にも管理者にも伝える。
      const base =
        err instanceof ApiError ? err.message : "インポート中にエラーが発生しました";
      console.error("Notion import failed and rollback was incomplete:", err);
      throw new ApiError(
        `${base}（取り込み途中のデータを削除できませんでした。スプレッドシート一覧をご確認ください）`,
        err instanceof ApiError ? err.status : 500,
      );
    }
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
    // 監査ログを見ただけで「全行入ったのか」が分かるようにする。
    truncated: query.truncated,
    truncationReason: query.stoppedBy,
    ...(truncatedMessage ? { truncationMessage: truncatedMessage } : {}),
  });

  return ok({
    collectionId,
    workbookId: workbook.id,
    imported: pages.length,
    skipped,
    sheetsImported: 1,
    truncated: query.truncated,
    truncationReason: query.stoppedBy,
    // UIはこの文言をそのまま表示する。null なら全行取り込めている。
    warning: truncatedMessage,
    collections: [
      { id: collectionId, name: collectionName, imported: pages.length, skipped },
    ],
  });
});
