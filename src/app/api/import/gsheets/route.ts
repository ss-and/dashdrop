/**
 * Google Sheets import commit endpoint (no OAuth).
 * POST JSON:
 *   {
 *     url: string,                          // public / link-shared Sheets URL
 *     sheets: [{ sheetName, collectionName?, fields?: [{name,key,type,required?,options?}] }]
 *   }
 *
 * Mirrors /api/import: fetches the sheet as CSV via its public export URL, then
 * turns each selected sheet into its own Collection with typed Fields and one
 * Record per row. Tenant-safe and plan-limited; all-or-nothing (any failure
 * rolls back every collection created in this request).
 */
import { withAuth, ok, ApiError, readJson } from "@/lib/api";
import { z } from "zod";
import { db, toJson } from "@/lib/db";
import { slugify, uniqueName, toFieldKey } from "@/lib/utils";
import { assertCanCreateCollection, logActivity } from "@/lib/workspace";
import { getPlan } from "@/lib/plans";
import {
  isFieldType,
  coerceValue,
  type FieldType,
  type SelectOption,
} from "@/lib/field-types";
import { readSheet, inferFields } from "@/lib/excel";
import { toCsvExportUrl, fetchSheetCsv } from "@/lib/gsheets";

const BATCH_SIZE = 500;

interface FinalField {
  name: string;
  key: string;
  type: FieldType;
  required: boolean;
  options?: SelectOption[];
}

const bodySchema = z.object({
  url: z.string(),
  sheets: z
    .array(
      z.object({
        sheetName: z.string(),
        collectionName: z.string().optional(),
        fields: z.unknown().optional(),
      }),
    )
    .optional(),
});

/** Normalise a user-supplied fields array into a validated, key-unique schema. */
function parseFieldsArray(arr: unknown): FinalField[] | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const takenKeys = new Set<string>();
  const fields: FinalField[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name =
      typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : null;
    if (!name) continue;
    const type: FieldType = isFieldType(rec.type) ? rec.type : "text";
    const rawKey =
      typeof rec.key === "string" && rec.key.trim()
        ? toFieldKey(rec.key)
        : toFieldKey(name);
    const key = uniqueName(rawKey, takenKeys);
    takenKeys.add(key);
    const options = Array.isArray(rec.options)
      ? (rec.options as SelectOption[])
      : undefined;
    fields.push({ name, key, type, required: rec.required === true, options });
  }
  return fields.length ? fields : null;
}

interface PreparedJob {
  collectionName: string;
  slug: string;
  fields: FinalField[];
  headers: string[];
  rows: Record<string, unknown>[];
}

export const POST = withAuth(async (req, { user }) => {
  const body = await readJson(req, bodySchema);

  const exportUrl = toCsvExportUrl(body.url);
  if (!exportUrl) {
    throw new ApiError("Google SheetsのURLを貼り付けてください。", 400);
  }

  // Cheap guard before we fetch/prepare anything.
  await assertCanCreateCollection(user);

  const buffer = await fetchSheetCsv(exportUrl);
  const plan = getPlan(user.workspace.plan);

  // A CSV export is a single sheet; the wizard still sends a selection array.
  const selections =
    body.sheets && body.sheets.length > 0
      ? body.sheets
      : [{ sheetName: "", collectionName: undefined, fields: undefined }];

  // Existing slugs for uniqueness across the whole batch.
  const existing = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
    select: { slug: true },
  });
  const takenSlugs = new Set(existing.map((c) => c.slug));

  // --- Prepare + validate every selected sheet BEFORE any write ---
  if (existing.length + selections.length > plan.limits.collections) {
    throw new ApiError(
      `プラン「${plan.name}」のスプレッドシート上限（${plan.limits.collections}）を超えます。`,
      403,
    );
  }

  const jobs: PreparedJob[] = [];
  for (const sel of selections) {
    const { sheetName, headers, rows, sampleByHeader } = readSheet(
      buffer,
      sel.sheetName || undefined,
    );
    if (headers.length === 0) continue; // skip empty tabs silently
    if (rows.length > plan.limits.recordsPerCollection) {
      throw new ApiError(
        `シート「${sheetName}」の行数がプラン「${plan.name}」の上限（${plan.limits.recordsPerCollection.toLocaleString()}）を超えます。`,
        403,
      );
    }
    const fields =
      parseFieldsArray(sel.fields) ??
      inferFields(headers, sampleByHeader).map((f) => ({ ...f, required: false }));
    const collectionName =
      (sel.collectionName && sel.collectionName.trim()) || sheetName || "インポート";
    const slug = uniqueName(slugify(collectionName), takenSlugs);
    takenSlugs.add(slug);
    jobs.push({ collectionName, slug, fields, headers, rows });
  }

  if (jobs.length === 0) {
    throw new ApiError("取り込めるシートがありませんでした", 422);
  }

  // --- Create each collection + its records; roll back all on any failure ---
  const created: Array<{ id: string; name: string; imported: number; skipped: number }> = [];
  const createdIds: string[] = [];
  let position = existing.length;

  try {
    for (const job of jobs) {
      const collection = await db.collection.create({
        data: {
          workspaceId: user.workspace.id,
          name: job.collectionName,
          slug: job.slug,
          description: "",
          icon: "table",
          color: "khaki",
          template: "custom",
          position: position++,
          fields: {
            create: job.fields.map((f, index) => ({
              key: f.key,
              name: f.name,
              type: f.type,
              required: f.required,
              options: f.options ? toJson(f.options) : undefined,
              position: index,
            })),
          },
        },
      });
      createdIds.push(collection.id);

      let skipped = 0;
      const recordData = job.rows.map((row) => {
        const data: Record<string, unknown> = {};
        job.fields.forEach((f, i) => {
          const sourceHeader = job.headers[i];
          const raw =
            (sourceHeader !== undefined ? row[sourceHeader] : undefined) ??
            row[f.name] ??
            row[f.key] ??
            null;
          const result = coerceValue(f.type, raw, f.options);
          if (result.ok) data[f.key] = result.value;
          else {
            data[f.key] = null;
            skipped += 1;
          }
        });
        return data;
      });

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

      created.push({
        id: collection.id,
        name: job.collectionName,
        imported: job.rows.length,
        skipped,
      });
      await logActivity(user.workspace.id, "collection.created", {
        collectionId: collection.id,
        name: job.collectionName,
        template: "custom",
        source: "gsheets",
      });
    }
  } catch (err) {
    if (createdIds.length > 0) {
      await db.collection
        .deleteMany({ where: { id: { in: createdIds } } })
        .catch(() => {});
    }
    if (err instanceof ApiError) throw err;
    console.error("Google Sheets import failed:", err);
    throw new ApiError("インポート中にエラーが発生しました", 500);
  }

  const totalRows = created.reduce((a, c) => a + c.imported, 0);
  await logActivity(user.workspace.id, "import.completed", {
    sheets: created.length,
    rows: totalRows,
    source: "gsheets",
    collectionId: created[0].id,
  });

  return ok({
    collections: created,
    collectionId: created[0].id, // first, for redirect
    sheetsImported: created.length,
    imported: totalRows,
  });
});
