/**
 * Import commit endpoint (multi-tab).
 * POST multipart/form-data:
 *   - file   : the .xlsx/.xls/.csv to import
 *   - sheets : JSON string of
 *              [{ sheetName, collectionName?, fields?: [{name,key,type,required?,options?}] }]
 *              — one entry per sheet (tab) the user chose to import.
 *
 * Back-compat: if `sheets` is absent, falls back to a single-sheet import using
 * `collectionName` + `fields` against the first sheet.
 *
 * Each selected sheet becomes its own Collection (spreadsheet) with typed
 * Fields and one Record per row. Tenant-safe and plan-limited; all-or-nothing
 * (any failure rolls back every collection created in this request).
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { slugify, uniqueName, toFieldKey } from "@/lib/utils";
import { getPlan } from "@/lib/plans";
import {
  assertWithinCollectionLimit,
  takenSlugsWithReserved,
} from "@/lib/master-objects";
import { logActivity } from "@/lib/workspace";
import {
  isFieldType,
  coerceValue,
  type FieldType,
  type SelectOption,
} from "@/lib/field-types";
import { readSheet, inferFields, MAX_IMPORT_BYTES } from "@/lib/excel";

const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];
const MAX_LABEL = "15MB";
const BATCH_SIZE = 500;

interface FinalField {
  name: string;
  key: string;
  type: FieldType;
  required: boolean;
  options?: SelectOption[];
}

interface SheetSelection {
  sheetName: string;
  collectionName?: string;
  fields?: unknown;
}

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
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError("ファイルを読み取れませんでした。もう一度アップロードしてください。", 400);
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    throw new ApiError("ファイルが指定されていません", 400);
  }
  const fileName = file.name ?? "";
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    throw new ApiError("対応形式は .xlsx / .xls / .csv です", 415);
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ApiError(`ファイルサイズが上限（${MAX_LABEL}）を超えています`, 413);
  }

  // Resolve which sheets to import.
  let selections: SheetSelection[] = [];
  const sheetsRaw = form.get("sheets");
  if (typeof sheetsRaw === "string" && sheetsRaw.trim()) {
    try {
      const parsed = JSON.parse(sheetsRaw);
      if (Array.isArray(parsed)) {
        selections = parsed
          .filter((s) => s && typeof s === "object" && typeof s.sheetName === "string")
          .map((s) => ({
            sheetName: s.sheetName,
            collectionName:
              typeof s.collectionName === "string" ? s.collectionName : undefined,
            fields: s.fields,
          }));
      }
    } catch {
      throw new ApiError("取り込むシートの指定が正しくありません。画面をもう一度読み込んでお試しください。", 400);
    }
  }

  const buffer = await file.arrayBuffer();
  const plan = getPlan(user.workspace.plan);

  // Back-compat single-sheet path.
  if (selections.length === 0) {
    const nameInput = form.get("collectionName");
    const fieldsInput = form.get("fields");
    let fields: unknown = undefined;
    if (typeof fieldsInput === "string" && fieldsInput.trim()) {
      try {
        fields = JSON.parse(fieldsInput);
      } catch {
        fields = undefined;
      }
    }
    selections = [
      {
        sheetName: "", // first sheet
        collectionName:
          typeof nameInput === "string" ? nameInput : undefined,
        fields,
      },
    ];
  }

  // Existing slugs for uniqueness across the whole batch.
  const existing = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
    select: { slug: true },
  });
  // マスターDBの slug は予約語 — 詳細は master-objects.ts。
  const takenSlugs = takenSlugsWithReserved(existing);

  // --- Prepare + validate every selected sheet BEFORE any write ---

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

  // 上限は「実際に作るシートの数」で判定する。選択された数で数えると、
  // 空タブを含むファイルで、実際には収まるのに 403 になってしまう。
  // まだ何も書いていないので、ここで弾いても副作用は無い。
  assertWithinCollectionLimit(plan, existing, jobs.length);

  // --- Group all sheets under one Workbook (the file) ---
  const fileBase = fileName.replace(/\.[^.]+$/, "").trim() || "インポート";
  const workbook = await db.workbook.create({
    data: {
      workspaceId: user.workspace.id,
      name: fileBase,
      source: ext === ".csv" ? "csv" : "excel",
    },
  });

  // --- Create each collection + its records; roll back all on any failure ---
  const created: Array<{ id: string; name: string; imported: number; skipped: number }> = [];
  const createdIds: string[] = [];
  let position = existing.length;

  try {
    for (const job of jobs) {
      const collection = await db.collection.create({
        data: {
          workspaceId: user.workspace.id,
          workbookId: workbook.id,
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
        source: "import",
      });
    }
  } catch (err) {
    if (createdIds.length > 0) {
      await db.collection
        .deleteMany({ where: { id: { in: createdIds } } })
        .catch(() => {});
    }
    await db.workbook.delete({ where: { id: workbook.id } }).catch(() => {});
    if (err instanceof ApiError) throw err;
    console.error("Import failed:", err);
    throw new ApiError("インポート中にエラーが発生しました", 500);
  }

  const totalRows = created.reduce((a, c) => a + c.imported, 0);
  await logActivity(user.workspace.id, "import.completed", {
    sheets: created.length,
    rows: totalRows,
    collectionId: created[0].id,
    workbookId: workbook.id,
    fileName,
    source: ext === ".csv" ? "csv" : "excel",
    sheetNames: created.map((c) => c.name),
    skipped: created.reduce((a, c) => a + c.skipped, 0),
  });

  return ok({
    collections: created,
    collectionId: created[0].id, // first, for redirect
    workbookId: workbook.id,
    sheetsImported: created.length,
    imported: totalRows,
  });
});
