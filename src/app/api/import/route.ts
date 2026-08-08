/**
 * Import commit endpoint.
 * POST multipart/form-data:
 *   - file           : the .xlsx/.xls/.csv to import
 *   - collectionName : desired table name (falls back to the sheet name)
 *   - fields         : optional JSON string of [{ name, key, type, required?, options? }]
 *                      chosen/overridden by the user; when absent we infer.
 *
 * Creates a Collection + its Fields, then bulk-inserts one Record per sheet row
 * with each cell coerced to its field type. Tenant-safe and plan-limited.
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { db, toJson } from "@/lib/db";
import { slugify, uniqueName, toFieldKey } from "@/lib/utils";
import {
  assertCanCreateCollection,
  assertCanAddRecords,
  logActivity,
} from "@/lib/workspace";
import {
  isFieldType,
  coerceValue,
  FIELD_TYPES,
  type FieldType,
  type SelectOption,
} from "@/lib/field-types";
import { readSheet, inferFields } from "@/lib/excel";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];
const MAX_ROWS = 50_000;
const BATCH_SIZE = 500;

interface FinalField {
  name: string;
  key: string;
  type: FieldType;
  required: boolean;
  options?: SelectOption[];
}

/** Parse the user-supplied `fields` JSON into a validated, key-unique schema. */
function parseProvidedFields(raw: string): FinalField[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const takenKeys = new Set<string>();
  const fields: FinalField[] = [];
  for (const item of parsed) {
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
    fields.push({
      name,
      key,
      type,
      required: rec.required === true,
      options,
    });
  }
  return fields.length ? fields : null;
}

export const POST = withAuth(async (req, { user }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError("multipart/form-data の解析に失敗しました", 400);
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
  if (file.size > MAX_BYTES) {
    throw new ApiError("ファイルサイズが上限（5MB）を超えています", 413);
  }

  const buffer = await file.arrayBuffer();
  const { sheetName, headers, rows, sampleByHeader } = readSheet(buffer);

  if (headers.length === 0) {
    throw new ApiError("シートから列を検出できませんでした", 422);
  }
  if (rows.length > MAX_ROWS) {
    throw new ApiError(
      `行数が上限（${MAX_ROWS.toLocaleString()}）を超えています`,
      413,
    );
  }

  // Determine the final field schema: user override or auto-inference.
  const providedRaw = form.get("fields");
  const provided =
    typeof providedRaw === "string" ? parseProvidedFields(providedRaw) : null;
  const finalFields: FinalField[] =
    provided ??
    inferFields(headers, sampleByHeader).map((f) => ({
      ...f,
      required: false,
    }));

  // --- Plan limit: can this workspace create another collection? ---
  await assertCanCreateCollection(user);

  const nameInput = form.get("collectionName");
  const collectionName =
    (typeof nameInput === "string" && nameInput.trim()) ||
    sheetName ||
    "インポート";

  // Unique slug within the workspace.
  const existing = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
    select: { slug: true },
  });
  const takenSlugs = new Set(existing.map((c) => c.slug));
  const slug = uniqueName(slugify(collectionName), takenSlugs);
  const position = existing.length;

  // Create the collection + its typed fields in one shot.
  const collection = await db.collection.create({
    data: {
      workspaceId: user.workspace.id,
      name: collectionName,
      slug,
      description: "",
      icon: "table",
      color: "khaki",
      template: "custom",
      position,
      fields: {
        create: finalFields.map((f, index) => ({
          key: f.key,
          name: f.name,
          type: f.type,
          required: f.required,
          options: f.options ? toJson(f.options) : undefined,
          position: index,
        })),
      },
    },
    include: { fields: { orderBy: { position: "asc" } } },
  });

  // --- Plan limit: can we add this many rows? ---
  await assertCanAddRecords(user, collection.id, rows.length);

  // Map each sheet row -> Record.data, coercing per field type. Header order
  // aligns with field order, so we resolve the source cell by position first
  // and fall back to name/key lookups for robustness.
  let skipped = 0; // count of invalid cells nulled out
  const recordData: Record<string, unknown>[] = rows.map((row) => {
    const data: Record<string, unknown> = {};
    finalFields.forEach((f, i) => {
      const sourceHeader = headers[i];
      const raw =
        (sourceHeader !== undefined ? row[sourceHeader] : undefined) ??
        row[f.name] ??
        row[f.key] ??
        null;
      const result = coerceValue(f.type, raw, f.options);
      if (result.ok) {
        data[f.key] = result.value;
      } else {
        data[f.key] = null;
        skipped += 1;
      }
    });
    return data;
  });

  // Bulk insert in batched transactions — createMany can't carry Json well on
  // SQLite, so we loop create()s inside a transaction per batch.
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
    name: collection.name,
    template: "custom",
    source: "import",
  });
  await logActivity(user.workspace.id, "import.completed", {
    rows: rows.length,
    collection: collection.name,
    collectionId: collection.id,
  });

  return ok({
    collectionId: collection.id,
    imported: rows.length,
    skipped,
  });
});
