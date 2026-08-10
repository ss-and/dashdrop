/**
 * Cross-spreadsheet relations engine.
 *
 * Three field types work together to pull data ACROSS spreadsheets:
 *   - relation : stores linked target-record id(s) (writable)
 *   - lookup   : shows a field from the linked records (computed, read-only)
 *   - rollup   : aggregates a field across the linked records (computed)
 *
 * This module resolves those computed values on read, provides link-picker
 * options, and validates relation writes — always scoped to the caller's
 * workspace so links can never reach another tenant's data.
 */
import "server-only";
import { db } from "./db";
import { ApiError } from "./api";
import { displayValue, type FieldType } from "./field-types";

export interface RelationConfig {
  targetCollectionId: string;
  displayFieldKey?: string;
  multiple?: boolean;
}
export interface LookupConfig {
  via: string; // key of a relation field on this collection
  target: string; // field key on the linked target collection
}
export interface RollupConfig {
  via: string;
  target: string;
  op: "sum" | "count" | "avg" | "min" | "max";
}

export interface EngineField {
  key: string;
  name: string;
  type: string;
  config?: unknown;
  options?: unknown;
}
export interface EngineCollection {
  id: string;
  workspaceId: string;
  name: string;
  fields: EngineField[];
}
export interface EngineRecord {
  id: string;
  data: Record<string, unknown>;
}

function asIdArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string" && v) return [v];
  return [];
}

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s¥]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

/** Pick the best field to label a record in a link picker. */
export function pickDisplayField(fields: EngineField[]): EngineField | null {
  const writable = fields.filter(
    (f) => f.type !== "lookup" && f.type !== "rollup",
  );
  return (
    writable.find((f) => f.type === "text") ??
    writable.find((f) => ["email", "phone", "url", "longtext"].includes(f.type)) ??
    writable[0] ??
    null
  );
}

interface ResolvedRelation {
  idToLabel: Map<string, string>;
  idToData: Map<string, Record<string, unknown>>;
  targetFields: Map<string, EngineField>;
}

export interface ResolvedRecords {
  /** records with a `computed` bag for lookup/rollup field values */
  records: Array<{ id: string; data: Record<string, unknown>; computed: Record<string, unknown> }>;
  /** relationLabels[fieldKey][recordId] = display label of the linked record */
  relationLabels: Record<string, Record<string, string>>;
}

/**
 * Resolve a collection's records: attach labels for relation links and compute
 * lookup/rollup values. Tenant-scoped; broken links (deleted targets) resolve
 * to blanks rather than throwing.
 */
export async function resolveCollectionRecords(
  workspaceId: string,
  collection: EngineCollection,
  records: EngineRecord[],
): Promise<ResolvedRecords> {
  const relationFields = collection.fields.filter((f) => f.type === "relation");
  const perRelation = new Map<string, ResolvedRelation>();
  const relationLabels: Record<string, Record<string, string>> = {};

  for (const rf of relationFields) {
    const cfg = (rf.config ?? {}) as RelationConfig;
    relationLabels[rf.key] = {};
    if (!cfg.targetCollectionId) {
      perRelation.set(rf.key, { idToLabel: new Map(), idToData: new Map(), targetFields: new Map() });
      continue;
    }
    // Load the target collection (scoped) + only the linked records.
    const target = await db.collection.findFirst({
      where: { id: cfg.targetCollectionId, workspaceId },
      include: { fields: { orderBy: { position: "asc" } } },
    });
    if (!target) {
      perRelation.set(rf.key, { idToLabel: new Map(), idToData: new Map(), targetFields: new Map() });
      continue;
    }
    const ids = new Set<string>();
    for (const r of records) for (const id of asIdArray(r.data[rf.key])) ids.add(id);

    const targetFields = new Map(target.fields.map((f) => [f.key, f as unknown as EngineField]));
    const displayKey =
      cfg.displayFieldKey ??
      pickDisplayField(target.fields as unknown as EngineField[])?.key ??
      null;
    const displayField = displayKey ? targetFields.get(displayKey) : null;

    const idToLabel = new Map<string, string>();
    const idToData = new Map<string, Record<string, unknown>>();
    if (ids.size > 0) {
      const linked = await db.record.findMany({
        where: { id: { in: [...ids] }, collectionId: target.id },
        select: { id: true, data: true },
      });
      for (const rec of linked) {
        const data = (rec.data as Record<string, unknown>) ?? {};
        idToData.set(rec.id, data);
        const raw = displayKey ? data[displayKey] : null;
        const label = displayField
          ? displayValue(displayField.type as FieldType, raw) || "（無題）"
          : String(raw ?? "（無題）");
        idToLabel.set(rec.id, label);
      }
    }
    perRelation.set(rf.key, { idToLabel, idToData, targetFields });
    relationLabels[rf.key] = Object.fromEntries(idToLabel);
  }

  // Compute lookup / rollup per record.
  const outRecords = records.map((r) => {
    const computed: Record<string, unknown> = {};
    for (const f of collection.fields) {
      if (f.type === "lookup") {
        const cfg = (f.config ?? {}) as LookupConfig;
        const rel = perRelation.get(cfg.via);
        if (!rel) continue;
        const ids = asIdArray(r.data[cfg.via]);
        const vals = ids
          .map((id) => rel.idToData.get(id)?.[cfg.target])
          .filter((v) => v !== undefined && v !== null && v !== "");
        computed[f.key] = vals.length <= 1 ? (vals[0] ?? null) : vals;
      } else if (f.type === "rollup") {
        const cfg = (f.config ?? {}) as RollupConfig;
        const rel = perRelation.get(cfg.via);
        if (!rel) {
          computed[f.key] = cfg.op === "count" ? 0 : null;
          continue;
        }
        const ids = asIdArray(r.data[cfg.via]);
        if (cfg.op === "count") {
          computed[f.key] = ids.length;
          continue;
        }
        const nums = ids
          .map((id) => toNum(rel.idToData.get(id)?.[cfg.target]))
          .filter((n): n is number => n !== null);
        if (nums.length === 0) {
          computed[f.key] = null;
        } else if (cfg.op === "sum") computed[f.key] = nums.reduce((a, b) => a + b, 0);
        else if (cfg.op === "avg")
          computed[f.key] = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
        else if (cfg.op === "min") computed[f.key] = Math.min(...nums);
        else if (cfg.op === "max") computed[f.key] = Math.max(...nums);
      }
    }
    return { id: r.id, data: r.data, computed };
  });

  return { records: outRecords, relationLabels };
}

/** Options for a relation picker: recent records of the target collection. */
export async function getLinkOptions(
  workspaceId: string,
  targetCollectionId: string,
  q?: string,
  limit = 20,
): Promise<{ collectionName: string; displayFieldKey: string | null; options: Array<{ id: string; label: string }> }> {
  const target = await db.collection.findFirst({
    where: { id: targetCollectionId, workspaceId },
    include: { fields: { orderBy: { position: "asc" } } },
  });
  if (!target) {
    throw new ApiError(
      "リンク先のスプレッドシートが見つかりません（削除された、または別のワークスペースです）。",
      404,
    );
  }
  const displayField = pickDisplayField(target.fields as unknown as EngineField[]);
  const displayKey = displayField?.key ?? null;

  const recs = await db.record.findMany({
    where: { collectionId: target.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, data: true },
  });

  let options = recs.map((r) => {
    const data = (r.data as Record<string, unknown>) ?? {};
    const raw = displayKey ? data[displayKey] : null;
    const label = displayField
      ? displayValue(displayField.type as FieldType, raw) || "（無題）"
      : String(raw ?? "（無題）");
    return { id: r.id, label };
  });

  if (q && q.trim()) {
    const needle = q.trim().toLowerCase();
    options = options.filter((o) => o.label.toLowerCase().includes(needle));
  }
  return { collectionName: target.name, displayFieldKey: displayKey, options: options.slice(0, limit) };
}

/**
 * Validate that every relation value in `data` points to a real record in its
 * target collection (workspace-scoped). Throws ApiError with a clear reason.
 */
export async function validateRelationWrites(
  workspaceId: string,
  fields: EngineField[],
  data: Record<string, unknown>,
): Promise<void> {
  for (const f of fields) {
    if (f.type !== "relation") continue;
    if (!(f.key in data)) continue;
    const ids = asIdArray(data[f.key]);
    if (ids.length === 0) continue;
    const cfg = (f.config ?? {}) as RelationConfig;
    if (!cfg.targetCollectionId) {
      throw new ApiError(
        `フィールド「${f.name}」のリンク先が設定されていません。フィールド設定でリンク先スプレッドシートを選んでください。`,
        422,
      );
    }
    const found = await db.record.count({
      where: {
        id: { in: ids },
        collection: { id: cfg.targetCollectionId, workspaceId },
      },
    });
    if (found !== ids.length) {
      throw new ApiError(
        `フィールド「${f.name}」でリンク先に存在しないレコードが指定されています（削除された可能性があります）。リンクを選び直してください。`,
        422,
      );
    }
  }
}

/**
 * Validate a relation/lookup/rollup field's config at creation/update time.
 * Ensures targets exist in the workspace and `via` points at a real relation
 * field — with actionable error messages.
 */
export async function validateFieldConfig(
  workspaceId: string,
  type: string,
  config: unknown,
  siblingFields: EngineField[],
): Promise<Record<string, unknown> | undefined> {
  const cfg = (config ?? {}) as Record<string, unknown>;
  if (type === "relation") {
    const targetCollectionId = String(cfg.targetCollectionId ?? "");
    if (!targetCollectionId) {
      throw new ApiError("リンク先のスプレッドシートを選んでください。", 422);
    }
    const target = await db.collection.findFirst({
      where: { id: targetCollectionId, workspaceId },
      include: { fields: true },
    });
    if (!target) {
      throw new ApiError("選んだリンク先スプレッドシートが見つかりません。", 404);
    }
    const displayFieldKey =
      typeof cfg.displayFieldKey === "string" && cfg.displayFieldKey
        ? cfg.displayFieldKey
        : (pickDisplayField(target.fields as unknown as EngineField[])?.key ?? undefined);
    return { targetCollectionId, displayFieldKey, multiple: cfg.multiple === true };
  }

  if (type === "lookup" || type === "rollup") {
    const via = String(cfg.via ?? "");
    const rel = siblingFields.find((f) => f.key === via && f.type === "relation");
    if (!rel) {
      throw new ApiError(
        `${type === "lookup" ? "ルックアップ" : "ロールアップ"}には、まず「リンク（他シート参照）」フィールドが必要です。参照するリンクフィールドを選んでください。`,
        422,
      );
    }
    const relCfg = (rel.config ?? {}) as RelationConfig;
    const target =
      relCfg.targetCollectionId &&
      (await db.collection.findFirst({
        where: { id: relCfg.targetCollectionId, workspaceId },
        include: { fields: true },
      }));
    if (!target) {
      throw new ApiError("リンク先スプレッドシートが見つかりません。リンクフィールドの設定を確認してください。", 404);
    }
    const targetKey = String(cfg.target ?? "");
    const tf = target.fields.find((f) => f.key === targetKey);
    if (!tf) {
      throw new ApiError("集計・参照する項目（リンク先の列）を選んでください。", 422);
    }
    if (type === "rollup") {
      const op = String(cfg.op ?? "sum");
      if (!["sum", "count", "avg", "min", "max"].includes(op)) {
        throw new ApiError("ロールアップの集計方法（合計/件数/平均/最小/最大）を選んでください。", 422);
      }
      return { via, target: targetKey, op };
    }
    return { via, target: targetKey };
  }
  return config as Record<string, unknown> | undefined;
}
