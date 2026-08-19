/**
 * Cross-spreadsheet relations engine.
 *
 * Three field types work together to pull data ACROSS spreadsheets:
 *   - relation : stores linked target-record id(s) (writable)
 *   - lookup   : shows a field from the linked records (computed, read-only)
 *   - rollup   : aggregates a field across the linked records (computed)
 *   - vlookup  : joins another spreadsheet on a KEY COLUMN rather than on
 *                stored link ids — Excel's VLOOKUP / SUMIF (computed).
 *                Pure core lives in src/lib/vlookup.ts.
 *
 * This module resolves those computed values on read, provides link-picker
 * options, and validates relation writes — always scoped to the caller's
 * workspace so links can never reach another tenant's data.
 */
import "server-only";
import { db } from "./db";
import { ApiError } from "./errors";
import {
  displayValue,
  isComputedField,
  isFieldType,
  type FieldType,
  type SelectOption,
} from "./field-types";
import {
  VLOOKUP_TARGET_ROW_CAP,
  resolveVlookupField,
  validateVlookupConfig,
  type VlookupConfig,
} from "./vlookup";

export type { VlookupConfig, VlookupAggregate } from "./vlookup";
export { resolveVlookupValues, normaliseKey, buildKeyIndex } from "./vlookup";
import { parseFormula, validateFormula, evaluateFormula } from "./formula";
import { orderFormulaFields, toFormulaRow } from "./formula-fields";
export type { FormulaConfig } from "./formula-fields";
export { orderFormulaFields } from "./formula-fields";

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
  const writable = fields.filter((f) => !isComputedField(f.type));
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
  /**
   * lookupLabels[lookupFieldKey][保存値] = 選択肢の表示ラベル。
   *
   * select / multiselect を引くルックアップ用の副次チャネル。computed の値は
   * ダッシュボードの集計・保存済みフィルタが参照するため「保存値（コード）」の
   * ままにしておかなければならない（直接の select 列と同じく、データは生の値、
   * ラベルは表示時に当てる）。そこで relationLabels と同じ形で「生の値 → 人間が
   * 読めるラベル」の対応表だけを別に渡し、画面側で表示の直前に差し替える。
   */
  lookupLabels: Record<string, Record<string, string>>;
  /**
   * vlookupWarnings[vlookup列のkey] = 利用者に見せる日本語の注意書き。
   *
   * 突合先が上限（VLOOKUP_TARGET_ROW_CAP 行）を超えていて、一部の行しか
   * 見ていない場合にだけ入る。ここが空だと「突合できなかった」ことと
   * 「突合したが該当が無かった」ことが画面上まったく区別できず、
   * 20,000 行のマスターに対して 75% が黙って空欄になる。
   */
  vlookupWarnings: Record<string, string>;
}

/** 選択肢を持つ（＝ラベル差し替えの対象になる）フィールド型。 */
function isOptionedType(type: string): boolean {
  return type === "select" || type === "multiselect";
}

/**
 * 選択肢配列から「保存値 → ラベル」の対応表を作る。ラベル未設定の選択肢は
 * 入れない（空文字で上書きすると、表示が空欄になって何が入っているのか
 * 分からなくなるため）。
 */
function optionLabelMap(options: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  if (!Array.isArray(options)) return map;
  for (const raw of options as SelectOption[]) {
    if (!raw || typeof raw !== "object") continue;
    const { value, label } = raw;
    if (typeof value !== "string" || typeof label !== "string" || label === "") continue;
    map[value] = label;
  }
  return map;
}

/**
 * ルックアップの値を表示用ラベルへ置き換える（純粋関数）。
 *
 * - 対応表に無いコード（選択肢から消えた値など）は、何が保存されているのか
 *   利用者に見せ続けるため、そのまま残す。空欄にはしない。
 * - リンクが複数件のときは値の配列、multiselect を引いたときは配列の配列に
 *   なるため、再帰的にたどる。
 * - 文字列以外（数値・真偽値・null）は触らない。0 や false が消えてはいけない。
 */
export function labelLookupValue(
  value: unknown,
  labels: Record<string, string> | undefined,
): unknown {
  if (!labels) return value;
  if (Array.isArray(value)) return value.map((v) => labelLookupValue(v, labels));
  if (typeof value !== "string") return value;
  return labels[value] ?? value;
}

/**
 * computed バッグ全体にルックアップのラベルを当てた「表示用のコピー」を返す。
 * 元の computed（集計・フィルタが読む生の値）は書き換えない。
 */
export function applyLookupLabels(
  computed: Record<string, unknown>,
  lookupLabels: Record<string, Record<string, string>>,
): Record<string, unknown> {
  const keys = Object.keys(lookupLabels);
  if (keys.length === 0) return computed;
  const out: Record<string, unknown> = { ...computed };
  for (const key of keys) {
    if (!(key in out)) continue;
    out[key] = labelLookupValue(out[key], lookupLabels[key]);
  }
  return out;
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

  // ---- lookup のラベル対応表 ------------------------------------------------
  // リンク先が select / multiselect のときだけ「保存値 → ラベル」を集める。
  // perRelation.targetFields はリンク先の options ごと持っているので、追加の
  // クエリは要らない。ここで作るのは表示用の対応表だけで、computed に入る値は
  // 生のまま（集計・保存済みフィルタが壊れないように）。
  const lookupLabels: Record<string, Record<string, string>> = {};
  for (const lf of collection.fields.filter((f) => f.type === "lookup")) {
    const cfg = (lf.config ?? {}) as LookupConfig;
    const targetField = perRelation.get(cfg.via)?.targetFields.get(cfg.target);
    if (!targetField || !isOptionedType(targetField.type)) continue;
    lookupLabels[lf.key] = optionLabelMap(targetField.options);
  }

  // ---- vlookup (sheet join on a key column) -------------------------------
  // One query + one index per vlookup field, then a single pass over the local
  // rows: O(n+m), never a nested scan. Only the target's STORED values are
  // read, so this can never trigger the target sheet's own computed fields
  // (that is what makes an A -> B -> A cycle impossible).
  const perVlookup = new Map<string, unknown[]>();
  const vlookupWarnings: Record<string, string> = {};
  for (const vf of collection.fields.filter((f) => f.type === "vlookup")) {
    const cfg = (vf.config ?? {}) as VlookupConfig;
    const blank = cfg.aggregate === "count" ? 0 : null;
    const allBlank = () => records.map(() => blank);

    if (!cfg.targetCollectionId || !cfg.localKey || !cfg.targetKey || !cfg.targetField) {
      perVlookup.set(vf.key, allBlank());
      continue;
    }
    // Workspace-scoped: a target in another workspace simply resolves to
    // blanks — never a leak, never a throw.
    const target = await db.collection.findFirst({
      where: { id: cfg.targetCollectionId, workspaceId },
      include: { fields: { orderBy: { position: "asc" } } },
    });
    if (!target) {
      perVlookup.set(vf.key, allBlank());
      continue;
    }
    const tf = target.fields.find((f) => f.key === cfg.targetField);
    // A vlookup cannot pull another computed column (cycle safety); validation
    // rejects it up front, but stale configs resolve to blanks here too.
    if (!tf || isComputedField(tf.type)) {
      perVlookup.set(vf.key, allBlank());
      continue;
    }
    // 上限を超えているかどうかを知るために総数も数える。件数が分からないと
    // 「一部しか見ていない」ことを画面に出せない。
    const [targetRows, targetTotal] = await Promise.all([
      db.record.findMany({
        where: { collectionId: target.id },
        orderBy: { createdAt: "asc" }, // the target sheet's own order ("first")
        take: VLOOKUP_TARGET_ROW_CAP, // capped: see VLOOKUP_TARGET_ROW_CAP
        select: { id: true, data: true },
      }),
      db.record.count({ where: { collectionId: target.id } }),
    ]);
    // vlookup も lookup と同じで、引いてきた先が select / multiselect なら
    // 保存値（"fulltime"）ではなくラベル（「正社員」）を見せる。ここを
    // lookup だけ直して vlookup を忘れると、同じ症状が別の列で残る。
    // ただし concat は複数値を1つの文字列に畳んだ後なので対象外。
    if (isOptionedType(tf.type) && cfg.aggregate !== "concat") {
      const map = optionLabelMap(tf.options);
      if (Object.keys(map).length > 0) lookupLabels[vf.key] = map;
    }

    const resolvedVlookup = resolveVlookupField(
      cfg,
      records.map((r) => ({ data: r.data })),
      targetRows.map((t) => ({ data: (t.data as Record<string, unknown>) ?? {} })),
      isFieldType(tf.type) ? tf.type : "text",
      { targetTotal },
    );
    perVlookup.set(vf.key, resolvedVlookup.values);
    if (resolvedVlookup.truncated && resolvedVlookup.warning) {
      vlookupWarnings[vf.key] = resolvedVlookup.warning;
    }
  }

  // Formula fields are parsed once for the whole collection and evaluated in
  // dependency order per record — never re-parsed per row.
  const preparedFormulas = orderFormulaFields(collection.fields);

  // Compute lookup / rollup / vlookup per record.
  const outRecords = records.map((r, rowIndex) => {
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
      } else if (f.type === "vlookup") {
        const vals = perVlookup.get(f.key);
        const cfg = (f.config ?? {}) as VlookupConfig;
        computed[f.key] = vals ? vals[rowIndex] : cfg.aggregate === "count" ? 0 : null;
      }
    }

    // Formulas last, so they can read lookup/rollup/vlookup results, and in
    // dependency order so a formula can build on another formula.
    for (const pf of preparedFormulas) {
      computed[pf.key] = evaluateFormula(
        pf.ast,
        toFormulaRow(r.data, computed),
      );
    }

    return { id: r.id, data: r.data, computed };
  });

  return { records: outRecords, relationLabels, lookupLabels, vlookupWarnings };
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
 * Validate a relation/lookup/rollup/vlookup field's config at creation/update
 * time. Ensures targets exist in the workspace and `via` points at a real
 * relation field — with actionable error messages.
 *
 * `selfCollectionId` is the collection the field lives on; it is what lets the
 * vlookup branch reject a self-join (which would risk a cycle).
 */
export async function validateFieldConfig(
  workspaceId: string,
  type: string,
  config: unknown,
  siblingFields: EngineField[],
  selfCollectionId?: string,
  /** The key of the field being saved — lets the formula branch reject cycles. */
  selfFieldKey?: string,
): Promise<Record<string, unknown> | undefined> {
  const cfg = (config ?? {}) as Record<string, unknown>;

  if (type === "formula") {
    const expression = typeof cfg.expression === "string" ? cfg.expression : "";
    if (!expression.trim()) {
      throw new ApiError("計算式を入力してください。", 422);
    }
    // Every non-formula field is addressable, plus the other formula fields.
    const available = siblingFields.map((f) => f.key);
    const res = validateFormula(expression, available);
    if (!res.ok) {
      throw new ApiError(res.error, 422);
    }
    // A formula must not depend on itself, directly or through another formula.
    const selfKey = selfFieldKey ?? null;
    if (selfKey) {
      const byKey = new Map(siblingFields.map((f) => [f.key, f]));
      const seen = new Set<string>();
      const reaches = (key: string): boolean => {
        if (key === selfKey) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        const f = byKey.get(key);
        if (!f || f.type !== "formula") return false;
        const src = ((f.config ?? {}) as { expression?: unknown }).expression;
        if (typeof src !== "string") return false;
        const parsed = parseFormula(src);
        return parsed.ok ? parsed.refs.some(reaches) : false;
      };
      if (res.refs.some(reaches)) {
        throw new ApiError(
          "計算式が自分自身を参照しています（循環参照）。別の項目を参照してください。",
          422,
        );
      }
    }
    return { expression };
  }

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
    // 表示列に自動計算の列は選べない。チップのラベルはリンク先の「保存済みの
    // データ」から引くので、計算列を指定すると全件が「（無題）」になる。
    // 回帰: 画面側の候補が lookup / rollup 決め打ちで formula / vlookup を出して
    // しまい、サーバも素通ししていた（pickDisplayField は元から計算列を除外して
    // いるので、明示指定のときだけの穴だった）。
    const displayField = displayFieldKey
      ? target.fields.find((f) => f.key === displayFieldKey)
      : undefined;
    if (displayField && isComputedField(displayField.type)) {
      throw new ApiError(
        `「${displayField.name}」は自動計算の列なので、表示する列には使えません。文字や数値など、値が入力されている列を選んでください。`,
        422,
      );
    }
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
    // 解決時に読むのはリンク先の「保存済みの値」だけ（vlookup と同じく、これが
    // A→B→A の循環を原理的に不可能にしている）。そのため自動計算の列を指すと、
    // 保存は成功するのに値は永久に空のまま＝原因の分からない空列になる。
    // 回帰: この分岐は列の存在しか見ておらず、vlookup 分岐（isComputedField で
    // 弾いている）と食い違っていた。
    if (isComputedField(tf.type)) {
      throw new ApiError(
        `「${tf.name}」は自動計算の列なので、${
          type === "lookup" ? "ルックアップ" : "ロールアップ"
        }の対象にできません。リンク先で値が入力されている列（文字・数値など）を選んでください。`,
        422,
      );
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

  if (type === "vlookup") {
    const targetCollectionId = String(cfg.targetCollectionId ?? "").trim();
    // Only hit the DB once we know the id is present and is not a self-join;
    // validateVlookupConfig raises the right Japanese error for both cases.
    const target =
      targetCollectionId && targetCollectionId !== selfCollectionId
        ? await db.collection.findFirst({
            where: { id: targetCollectionId, workspaceId },
            include: { fields: { orderBy: { position: "asc" } } },
          })
        : null;
    return validateVlookupConfig(cfg, {
      selfCollectionId,
      localFields: siblingFields.map((f) => ({ key: f.key, name: f.name, type: f.type })),
      target: target
        ? {
            id: target.id,
            name: target.name,
            fields: target.fields.map((f) => ({ key: f.key, name: f.name, type: f.type })),
          }
        : null,
    }) as unknown as Record<string, unknown>;
  }

  return config as Record<string, unknown> | undefined;
}
