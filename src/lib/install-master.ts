/**
 * The shared installer behind 顧客データベース (CRM) と 人事データベース (HR).
 *
 * Both master databases are declared the same way (see crm-objects.ts /
 * hr-objects.ts) and installed the same way, so the mechanics live here once.
 * Three passes, because a relation can point at an object created later:
 *
 *   1. create every missing Collection with its non-relational Fields
 *   2. write relation / lookup / rollup / formula config, now that ids exist
 *   3. seed demo rows, resolving relation values from display name → record id
 *
 * Idempotent by slug: objects the workspace already has are skipped, so the
 * button is safe to press twice.
 *
 * プラン上限はここでは見ない。組み込みのマスターDBはユーザーの枠を消費しない、
 * というのが製品の決めごとで、その判断は src/lib/master-objects.ts にある。
 * 行数の上限は通常の追加操作（assertCanAddRecords）で効く。
 */
import { db, toJson } from "./db";
import { ApiError } from "./errors";
import { logActivity } from "./workspace";
import { coerceValue, isComputedField } from "./field-types";
import type { FieldType, SelectOption } from "./field-types";
import type { CurrentUser } from "./auth";

/** One typed column of a master object. Structurally matches CrmField / HrField. */
export interface MasterField {
  key: string;
  name: string;
  type: FieldType;
  required?: boolean;
  options?: SelectOption[];
  relation?: { to: string; multiple?: boolean; displayFieldKey?: string };
  lookup?: { via: string; target: string };
  rollup?: {
    via: string;
    target: string;
    op: "sum" | "count" | "avg" | "min" | "max";
  };
  formula?: { expression: string };
}

/** One object of a master database. Structurally matches CrmObject / HrObject. */
export interface MasterObject {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  fields: MasterField[];
  samples: Record<string, unknown>[];
}

export interface InstallMasterResult {
  created: Array<{ id: string; slug: string; name: string }>;
  skipped: string[];
  seededRows: number;
  /** 指す先が消えていたため貼り直した relation 列の数。 */
  repairedRelations: number;
}

export interface InstallMasterOptions {
  withSampleData?: boolean;
  /** Activity-log tag and error-message subject, e.g. "crm" / "hr". */
  source: string;
  /** 「顧客データベース」— used verbatim in user-facing errors. */
  label: string;
}

/**
 * 表示名の索引を作るときに読む行数の上限。デモ行の紐づけ先を引くだけなので、
 * 巨大なマスターを丸ごとメモリに載せる必要はない。
 */
const PRELOAD_LIMIT = 5000;

/** The field that labels a record of this object (first required field). */
function primaryKeyOf(obj: MasterObject): string {
  return (obj.fields.find((f) => f.required) ?? obj.fields[0]).key;
}

/**
 * Whether `fieldKeys` looks like the column set this object installs.
 *
 * Slugs are unique per workspace, so an existing collection on one of our slugs
 * is either (a) a previous install of this same object, or (b) an unrelated
 * sheet the user happened to name so that it slugified onto ours. Skipping (b)
 * as "already installed" used to silently point the other objects' relations at
 * that stranger's rows — the 社員 sheet of the 人事データベース would be
 * somebody's memo table, and every 勤怠 row would link to nothing.
 *
 * There is no marker column to check, so this is a heuristic: the record label
 * must exist, and at least half of the declared columns must be present. A real
 * install matches trivially even after the owner deletes a few columns; an
 * unrelated sheet essentially never does.
 */
function looksLikeOurObject(
  obj: MasterObject,
  fields: Array<{ key: string; config: unknown }>,
): boolean {
  // 過去にこのインストーラが書いた config が残っていれば、それが動かぬ証拠。
  // 列を削られていても（勤怠番号や申請番号は「要らない列」に見えるので実際に
  // 消される）、これで確実に自分のものだと分かる。
  const ourKeys = new Set(
    obj.fields.filter((f) => f.relation || f.lookup || f.rollup || f.formula).map((f) => f.key),
  );
  if (fields.some((f) => ourKeys.has(f.key) && f.config !== null && f.config !== undefined)) {
    return true;
  }
  const fieldKeys = new Set(fields.map((f) => f.key));
  if (!fieldKeys.has(primaryKeyOf(obj))) return false;
  const present = obj.fields.filter((f) => fieldKeys.has(f.key)).length;
  return present * 2 >= obj.fields.length;
}

/** Relation samples hold display names; multi-value ones are separated by 、 or ,. */
function splitRelationValue(raw: unknown): string[] {
  return String(raw)
    .split(/[、,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function installMasterObjects(
  user: CurrentUser,
  objects: MasterObject[],
  opts: InstallMasterOptions,
): Promise<InstallMasterResult> {
  const withSampleData = opts.withSampleData ?? true;
  const workspaceId = user.workspace.id;

  const existing = await db.collection.findMany({
    where: { workspaceId },
    select: {
      id: true,
      slug: true,
      name: true,
      fields: { select: { key: true, config: true } },
    },
  });
  const bySlug = new Map(existing.map((c) => [c.slug, c]));

  // Refuse to build on top of a stranger's sheet that collided on one of our
  // slugs — wiring relations into it would corrupt both databases.
  for (const obj of objects) {
    const clash = bySlug.get(obj.slug);
    if (!clash) continue;
    if (!looksLikeOurObject(obj, clash.fields)) {
      throw new ApiError(
        // 名前を変えても slug は変わらない（PATCH は name/description/icon/color
        // のみ）ので、「名前を変えてください」とは言わないこと。
        `「${clash.name}」というスプレッドシートが${opts.label}の「${obj.name}」と内部名で衝突しているため、作成できません。中身を書き出してから「${clash.name}」を削除するか、サポートへご連絡ください。`,
        409,
      );
    }
  }

  const toCreate = objects.filter((o) => !bySlug.has(o.slug));
  const skipped = objects.filter((o) => bySlug.has(o.slug)).map((o) => o.slug);

  const created: Array<{ id: string; slug: string; name: string }> = [];
  /** slug -> collection id, for every object present after this run. */
  const idBySlug = new Map<string, string>(
    objects
      .filter((o) => bySlug.has(o.slug))
      .map((o) => [o.slug, bySlug.get(o.slug)!.id]),
  );
  let seededRows = 0;
  let repaired = 0;
  let position = existing.length;

  try {
    /* --- Pass 1: create collections with non-relational fields ------------- */
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

    /* --- Pass 2: wire relation / lookup / rollup / formula config ---------- */
    // 既にあるオブジェクトのうち、relation の指す先が消えているものを貼り直す。
    // 親（社員など）だけ削除して作り直すと、子（勤怠・休暇申請・評価）の
    // targetCollectionId が消えた id を指したままになり、関連の列が黙って
    // 空欄になるうえ、リンクの選択画面が 404 で開けなくなって手作業でも
    // 直せなくなる。作成した分（下のループ）だけでは、この向きは直らない。
    const liveIds = new Set(idBySlug.values());
    for (const obj of objects) {
      if (!bySlug.has(obj.slug)) continue; // 作る分は下のループが書く
      const collectionId = idBySlug.get(obj.slug);
      if (!collectionId) continue;
      for (const f of obj.fields) {
        if (!f.relation) continue;
        const targetId = idBySlug.get(f.relation.to);
        if (!targetId) continue;
        const current = await db.field.findUnique({
          where: { collectionId_key: { collectionId, key: f.key } },
          select: { config: true },
        });
        if (!current) continue;
        const cfg = (current.config ?? {}) as { targetCollectionId?: string };
        if (cfg.targetCollectionId && liveIds.has(cfg.targetCollectionId)) continue;
        await db.field.update({
          where: { collectionId_key: { collectionId, key: f.key } },
          data: {
            config: toJson({
              targetCollectionId: targetId,
              displayFieldKey: f.relation.displayFieldKey,
              multiple: f.relation.multiple ?? false,
            }),
          },
        });
        repaired += 1;
      }
    }

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
        } else if (f.formula) {
          config = { expression: f.formula.expression };
        }
        if (config === null) continue;
        await db.field.update({
          where: { collectionId_key: { collectionId, key: f.key } },
          data: { config: toJson(config) },
        });
      }
    }

    /* --- Pass 3: seed demo rows, resolving relation names to record ids ---- */
    if (withSampleData) {
      /** slug -> (display name -> record id). */
      const recordIdByName = new Map<string, Map<string, string>>();

      // 既にあるオブジェクトの行も引けるようにしておく。ここを作成分だけで
      // 作ると、「一部のシートだけ消して作り直す」ときに relation が全部
      // 空のまま入ってしまう（勤怠 30 行が誰にも紐づかない、という状態）。
      //
      // 読むのは「これから作る分が指す先」だけ、かつ PRELOAD_LIMIT 件まで。
      // 全オブジェクトを無条件に読むと、既にインストール済みのワークスペースで
      // ボタンをもう一度押しただけで全行（Business なら最大500万行）を
      // 読み込んでしまう。
      const neededSlugs = new Set(
        toCreate.flatMap((o) =>
          o.fields.filter((f) => f.relation).map((f) => f.relation!.to),
        ),
      );
      for (const obj of objects) {
        if (!neededSlugs.has(obj.slug)) continue;
        if (!bySlug.has(obj.slug)) continue;
        const collectionId = idBySlug.get(obj.slug);
        if (!collectionId) continue;
        const rows = await db.record.findMany({
          where: { collectionId },
          // 表示名の索引しか作らないので、行全体ではなく id と data だけ。
          select: { id: true, data: true },
          // 同じ表示名は先勝ちにしたいので、並びを固定する（無指定だと
          // DB次第で実行ごとに紐づけ先が変わりうる）。
          orderBy: { createdAt: "asc" },
          take: PRELOAD_LIMIT,
        });
        const nameMap = new Map<string, string>();
        const labelKey = primaryKeyOf(obj);
        for (const row of rows) {
          const label = (row.data as Record<string, unknown> | null)?.[labelKey];
          if (label === undefined || label === null || label === "") continue;
          // 同じ表示名が複数あれば先勝ち — 後勝ちだと実行のたびに紐づけ先が変わる。
          const key = String(label);
          if (!nameMap.has(key)) nameMap.set(key, row.id);
        }
        recordIdByName.set(obj.slug, nameMap);
      }

      for (const obj of toCreate) {
        const collectionId = idBySlug.get(obj.slug)!;
        const nameMap = recordIdByName.get(obj.slug) ?? new Map<string, string>();
        recordIdByName.set(obj.slug, nameMap);

        for (const sample of obj.samples) {
          const data: Record<string, unknown> = {};
          for (const f of obj.fields) {
            const raw = sample[f.key];
            if (raw === undefined || raw === null || raw === "") continue;

            if (f.relation) {
              // Sample stores the target's display name — resolve to id(s).
              const targetMap = recordIdByName.get(f.relation.to);
              if (!targetMap) continue;
              const names = f.relation.multiple
                ? splitRelationValue(raw)
                : [String(raw)];
              const ids = names
                .map((n) => targetMap.get(n))
                .filter((id): id is string => Boolean(id));
              if (ids.length > 0) data[f.key] = ids;
              continue;
            }
            if (isComputedField(f.type)) continue; // computed on read

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

          // Index by the display value so later objects can link to this row.
          const label = sample[primaryKeyOf(obj)];
          if (label !== undefined && label !== null && label !== "") {
            nameMap.set(String(label), record.id);
          }
        }
      }
    }

    if (created.length > 0) {
      await logActivity(workspaceId, "collection.created", {
        source: opts.source,
        objects: created.map((c) => c.slug),
      });
    }

    return { created, skipped, seededRows, repairedRelations: repaired };
  } catch (err) {
    // Roll back what this call created, so a failure leaves no half-built DB.
    if (created.length > 0) {
      await db.collection
        .deleteMany({ where: { id: { in: created.map((c) => c.id) } } })
        .catch(() => {});
    }
    if (err instanceof ApiError) throw err;
    console.error(`install ${opts.source} failed:`, err);
    throw new ApiError(`${opts.label}の作成に失敗しました`, 500);
  }
}
