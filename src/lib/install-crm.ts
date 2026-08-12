/**
 * Install the CRM core (顧客 / 担当者 / 商談 / 活動) into a workspace.
 *
 * This is what makes DashDrop the *master* database: the objects are created as
 * real Collections with typed Fields and resolved relations, then optionally
 * seeded with demo rows whose links are wired to actual record ids. Imported
 * spreadsheets stay untouched alongside them.
 *
 * Idempotent by slug: objects that already exist in the workspace are skipped,
 * so calling this twice never duplicates the customer database.
 */
import { db, toJson } from "./db";
import { ApiError } from "./errors";
import { getPlan } from "./plans";
import { logActivity } from "./workspace";
import { coerceValue } from "./field-types";
import { CRM_OBJECTS, type CrmObject } from "./crm-objects";
import type { CurrentUser } from "./auth";

export interface InstallCrmResult {
  created: Array<{ id: string; slug: string; name: string }>;
  skipped: string[];
  seededRows: number;
}

/** The field that labels a record of this object (first required text field). */
function primaryKeyOf(obj: CrmObject): string {
  return (obj.fields.find((f) => f.required) ?? obj.fields[0]).key;
}

export async function installCrm(
  user: CurrentUser,
  opts: { withSampleData?: boolean } = {},
): Promise<InstallCrmResult> {
  const withSampleData = opts.withSampleData ?? true;
  const workspaceId = user.workspace.id;
  const plan = getPlan(user.workspace.plan);

  const existing = await db.collection.findMany({
    where: { workspaceId },
    select: { id: true, slug: true, name: true },
  });
  const bySlug = new Map(existing.map((c) => [c.slug, c]));

  const toCreate = CRM_OBJECTS.filter((o) => !bySlug.has(o.slug));
  const skipped = CRM_OBJECTS.filter((o) => bySlug.has(o.slug)).map((o) => o.slug);

  if (existing.length + toCreate.length > plan.limits.collections) {
    throw new ApiError(
      `プラン「${plan.name}」のスプレッドシート上限（${plan.limits.collections}）を超えます。不要なスプレッドシートを削除するか、プランを変更してください。`,
      403,
    );
  }

  const created: Array<{ id: string; slug: string; name: string }> = [];
  // slug -> collection id, for every CRM object present after this run.
  const idBySlug = new Map<string, string>(
    CRM_OBJECTS.filter((o) => bySlug.has(o.slug)).map((o) => [
      o.slug,
      bySlug.get(o.slug)!.id,
    ]),
  );
  let seededRows = 0;
  let position = existing.length;

  try {
    // --- Pass 1: create collections with non-relational fields ---------------
    // Relation/lookup/rollup config is filled in pass 2, once every CRM
    // collection has an id (relations can point at objects created later).
    for (const obj of toCreate) {
      const collection = await db.collection.create({
        data: {
          workspaceId,
          name: obj.name,
          slug: obj.slug,
          description: obj.description,
          icon: obj.icon,
          color: obj.color,
          template: "custom",
          position: position++,
          fields: {
            create: obj.fields.map((f, i) => ({
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
      created.push({ id: collection.id, slug: obj.slug, name: obj.name });
      idBySlug.set(obj.slug, collection.id);
    }

    // --- Pass 2: wire relation / lookup / rollup config ----------------------
    for (const obj of toCreate) {
      const collectionId = idBySlug.get(obj.slug)!;
      for (const f of obj.fields) {
        let config: unknown = null;
        if (f.relation) {
          const targetId = idBySlug.get(f.relation.to);
          if (!targetId) continue; // target missing — leave unconfigured
          config = {
            targetCollectionId: targetId,
            displayFieldKey: f.relation.displayFieldKey,
            multiple: f.relation.multiple ?? false,
          };
        } else if (f.lookup) {
          config = { via: f.lookup.via, target: f.lookup.target };
        } else if (f.rollup) {
          config = { via: f.rollup.via, target: f.rollup.target, op: f.rollup.op };
        }
        if (config === null) continue;
        await db.field.update({
          where: { collectionId_key: { collectionId, key: f.key } },
          data: { config: toJson(config) },
        });
      }
    }

    // --- Pass 3: seed demo rows, resolving relation names to record ids ------
    if (withSampleData) {
      // displayName -> recordId, per CRM slug (built as we go).
      const recordIdByName = new Map<string, Map<string, string>>();

      for (const obj of toCreate) {
        const collectionId = idBySlug.get(obj.slug)!;
        const nameMap = new Map<string, string>();
        recordIdByName.set(obj.slug, nameMap);

        for (const sample of obj.samples) {
          const data: Record<string, unknown> = {};
          for (const f of obj.fields) {
            const raw = sample[f.key];
            if (raw === undefined || raw === null || raw === "") continue;

            if (f.relation) {
              // Sample stores the target's display name — resolve to an id.
              const targetMap = recordIdByName.get(f.relation.to);
              const id = targetMap?.get(String(raw));
              if (id) data[f.key] = [id];
              continue;
            }
            if (f.lookup || f.rollup) continue; // computed on read

            const res = coerceValue(f.type, raw, f.options);
            if (res.ok) data[f.key] = res.value;
          }

          const record = await db.record.create({
            data: {
              collectionId,
              createdById: user.id,
              isSampleData: true,
              data: toJson(data),
            },
          });
          seededRows += 1;

          // Index by the object's display value so later objects can link to it.
          const label = sample[primaryKeyOf(obj)];
          if (label) nameMap.set(String(label), record.id);
        }
      }
    }

    if (created.length > 0) {
      await logActivity(workspaceId, "collection.created", {
        source: "crm",
        objects: created.map((c) => c.slug),
      });
    }

    return { created, skipped, seededRows };
  } catch (err) {
    // Roll back anything this call created so a failure leaves no partial CRM.
    if (created.length > 0) {
      await db.collection
        .deleteMany({ where: { id: { in: created.map((c) => c.id) } } })
        .catch(() => {});
    }
    if (err instanceof ApiError) throw err;
    console.error("installCrm failed:", err);
    throw new ApiError("顧客データベースの作成に失敗しました", 500);
  }
}

/**
 * Which CRM objects a workspace currently has, as slug -> collection id.
 * Used by the home page / launcher to link straight to 顧客・商談・担当者.
 */
export async function getCrmCollections(workspaceId: string) {
  const rows = await db.collection.findMany({
    where: {
      workspaceId,
      slug: { in: CRM_OBJECTS.map((o) => o.slug) },
    },
    select: { id: true, slug: true, name: true, icon: true },
  });
  return rows;
}
