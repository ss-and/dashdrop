/**
 * Collections collection endpoint.
 * GET  — list the current workspace's collections (with record counts).
 * POST — create a new collection (+ its typed fields), enforcing plan limits.
 */
import { withAuth, ok, readJson } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { slugify, toFieldKey, uniqueName } from "@/lib/utils";
import { takenSlugsWithReserved } from "@/lib/master-objects";
import { createCollectionSchema } from "@/lib/validation";
import {
  assertCanCreateCollection,
  logActivity,
} from "@/lib/workspace";
import { FIELD_TYPES, isFieldType } from "@/lib/field-types";
import { validateFieldConfig, type EngineField } from "@/lib/relations";

export const GET = withAuth(async (_req, { user }) => {
  const collections = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
    orderBy: { position: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      icon: true,
      color: true,
      template: true,
      position: true,
      _count: { select: { records: true } },
    },
  });
  return ok(collections);
});

export const POST = withAuth(async (req, { user }) => {
  await assertCanCreateCollection(user);
  const input = await readJson(req, createCollectionSchema);

  // Build a slug unique within the workspace by suffixing (-2, -3, …).
  const existing = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
    select: { slug: true },
  });
  // マスターDBの slug は予約語 — 詳細は master-objects.ts。
  const takenSlugs = takenSlugsWithReserved(existing);
  const slug = uniqueName(slugify(input.name), takenSlugs);

  const position = existing.length;

  // Derive fields — keep keys unique & stable within the collection.
  const takenKeys = new Set<string>();
  const derived = (input.fields ?? []).map((f, index) => {
    const rawKey = f.key?.trim() || toFieldKey(f.name);
    const key = uniqueName(rawKey, takenKeys);
    takenKeys.add(key);
    const type = isFieldType(f.type) ? f.type : FIELD_TYPES[0];
    return {
      key,
      name: f.name,
      type,
      required: f.required ?? false,
      options: f.options,
      config: f.config as Record<string, unknown> | undefined,
      position: typeof f.position === "number" ? f.position : index,
    };
  });

  // 【不具合の再発防止】ここだけ config を無検証で保存していたため、項目追加
  // 経由なら弾かれる設定（他ワークスペースのシートを指すリンク、構文の通らない
  // 計算式など）が、シート新規作成の経路からはそのまま保存できてしまっていた。
  // 検証はリンク列を先に済ませる — ルックアップ／ロールアップは、リンク列の
  // 確定した config（リンク先シート）を見ないと検証できないため。
  const siblings: EngineField[] = derived.map((f) => ({
    key: f.key,
    name: f.name,
    type: f.type,
    config: f.config,
    options: f.options,
  }));
  const siblingByKey = new Map(siblings.map((s) => [s.key, s]));
  for (const relationFirst of [true, false]) {
    for (const f of derived) {
      if ((f.type === "relation") !== relationFirst) continue;
      const config = await validateFieldConfig(
        user.workspace.id,
        f.type,
        f.config,
        siblings,
        undefined, // シートはまだ存在しないので自己参照はあり得ない
        f.key,
      );
      f.config = config;
      const sibling = siblingByKey.get(f.key);
      if (sibling) sibling.config = config;
    }
  }

  const fields = derived.map((f) => ({
    key: f.key,
    name: f.name,
    type: f.type,
    required: f.required,
    options: f.options ? toJson(f.options) : undefined,
    config: f.config ? toJson(f.config) : undefined,
    position: f.position,
  }));

  const collection = await db.collection.create({
    data: {
      workspaceId: user.workspace.id,
      name: input.name,
      slug,
      description: input.description ?? "",
      icon: input.icon ?? "table",
      color: input.color ?? "khaki",
      template: input.template ?? "custom",
      position,
      fields: fields.length ? { create: fields } : undefined,
    },
    include: { fields: { orderBy: { position: "asc" } } },
  });

  await logActivity(user.workspace.id, "collection.created", {
    collectionId: collection.id,
    name: collection.name,
    template: collection.template,
  });

  return ok(collection);
});
