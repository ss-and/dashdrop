/**
 * Install 参考スプレッドシート into the caller's workspace.
 *
 * POST { keys: string[], withSampleData?: boolean }
 *   → { created: [{ id, key, name }], skipped: string[], seededRows }
 *
 * Unlike the CRM installer this is *not* idempotent by slug: a sample sheet is
 * an example the user is meant to edit, so adding 売上日報 twice yields
 * 「売上日報-2」 rather than an error. Slugs are made unique against the
 * workspace's existing collections via slugify + uniqueName.
 */
import { z } from "zod";
import { withAuth, ok, readJson } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { db, toJson } from "@/lib/db";
import { getPlan } from "@/lib/plans";
import { logActivity } from "@/lib/workspace";
import { coerceValue } from "@/lib/field-types";
import { slugify, uniqueName } from "@/lib/utils";
import { getSampleSheet, type SampleSheet } from "@/lib/sample-sheets";

const bodySchema = z.object({
  keys: z
    .array(z.string().min(1))
    .min(1, "追加する参考スプレッドシートを選んでください")
    .max(20, "一度に追加できるのは20件までです"),
  withSampleData: z.boolean().optional(),
});

export const POST = withAuth(async (req, { user }) => {
  const body = await readJson(req, bodySchema);
  const withSampleData = body.withSampleData ?? true;
  const workspaceId = user.workspace.id;
  const plan = getPlan(user.workspace.plan);

  // --- Resolve keys ---------------------------------------------------------
  const skipped: string[] = [];
  const seen = new Set<string>();
  const sheets: SampleSheet[] = [];
  const unknown: string[] = [];

  for (const key of body.keys) {
    if (seen.has(key)) {
      // The same sheet was requested twice in one call — add it once.
      skipped.push(key);
      continue;
    }
    seen.add(key);
    const sheet = getSampleSheet(key);
    if (!sheet) {
      unknown.push(key);
      continue;
    }
    sheets.push(sheet);
  }

  if (unknown.length > 0) {
    throw new ApiError(
      `見つからない参考スプレッドシートが指定されました: ${unknown.join("、")}`,
      400,
    );
  }

  // --- Plan limit, before any write ----------------------------------------
  const existing = await db.collection.findMany({
    where: { workspaceId },
    select: { slug: true, name: true },
  });

  if (existing.length + sheets.length > plan.limits.collections) {
    throw new ApiError(
      `プラン「${plan.name}」のスプレッドシート上限（${plan.limits.collections}）を超えます。不要なスプレッドシートを削除するか、プランを変更してください。`,
      403,
    );
  }

  const takenSlugs = new Set(existing.map((c) => c.slug));
  const takenNames = new Set(existing.map((c) => c.name));

  const created: Array<{ id: string; key: string; name: string }> = [];
  let seededRows = 0;
  let position = existing.length;

  try {
    for (const sheet of sheets) {
      const slug = uniqueName(slugify(sheet.key || sheet.name), takenSlugs);
      takenSlugs.add(slug);
      const name = uniqueName(sheet.name, takenNames);
      takenNames.add(name);

      const collection = await db.collection.create({
        data: {
          workspaceId,
          name,
          slug,
          description: sheet.description,
          icon: sheet.icon,
          color: "khaki",
          template: "custom",
          position: position++,
          fields: {
            create: sheet.fields.map((f, i) => ({
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
      created.push({ id: collection.id, key: sheet.key, name });

      if (!withSampleData) continue;

      const rows = sheet.rows.slice(0, plan.limits.recordsPerCollection);
      for (const row of rows) {
        const data: Record<string, unknown> = {};
        for (const f of sheet.fields) {
          const raw = row[f.key];
          if (raw === undefined || raw === null || raw === "") continue;
          const res = coerceValue(f.type, raw, f.options);
          if (res.ok) data[f.key] = res.value;
        }
        await db.record.create({
          data: {
            collectionId: collection.id,
            createdById: user.id,
            isSampleData: true,
            data: toJson(data),
          },
        });
        seededRows += 1;
      }
    }

    if (created.length > 0) {
      await logActivity(workspaceId, "collection.created", {
        source: "sample-sheets",
        sheets: created.map((c) => c.key),
      });
    }

    return ok({ created, skipped, seededRows });
  } catch (err) {
    // Roll back so a failure never leaves half-built sample sheets behind.
    if (created.length > 0) {
      await db.collection
        .deleteMany({ where: { id: { in: created.map((c) => c.id) } } })
        .catch(() => {});
    }
    if (err instanceof ApiError) throw err;
    console.error("sample-sheets install failed:", err);
    throw new ApiError("参考スプレッドシートの追加に失敗しました", 500);
  }
});
