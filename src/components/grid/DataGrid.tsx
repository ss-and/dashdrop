"use client";

/**
 * Spreadsheet-style editable grid — the primary way users work with a
 * Collection's rows. No external grid library: a plain <table> plus React
 * state, with inline per-type cell editors, optimistic writes, error rollback,
 * a subtle saving indicator, and column-header actions (add / edit / delete a
 * field). Persistence goes through the records + fields API routes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import {
  FIELD_TYPE_META,
  displayValue,
  isComputedField,
  type SelectOption,
} from "@/lib/field-types";
import { CellView, CellEditor, type GridField } from "./cells";
import { FieldEditor } from "./FieldEditor";

interface GridRecord {
  id: string;
  data: Record<string, unknown>;
  /** Computed lookup/rollup values, keyed by field key. */
  computed: Record<string, unknown>;
}

interface RawField {
  id: string;
  key: string;
  name: string;
  // Prisma stores field.type as a plain string; narrowed to FieldType below.
  type: string;
  required: boolean;
  options: unknown;
  config?: unknown;
  position: number;
}

interface RawRecord {
  id: string;
  data: unknown;
  computed?: unknown;
}

/** Other spreadsheets in the workspace — passed to the field editor so it can
 *  configure relation / lookup / rollup targets. */
export interface WorkspaceCollection {
  id: string;
  name: string;
  fields: Array<{ key: string; name: string; type: string; config?: unknown }>;
}

const DRAFT_ID = "__draft__";
const EMPTY_COMPUTED: Record<string, unknown> = {};

/**
 * 1ページぶんの行数。サーバー側の一覧（app/(app)/c/[collectionId]/page.tsx の
 * take と records API の既定値）と同じ数にそろえてある。最初に渡ってくる行が
 * ちょうどこの数なら「まだ続きがあるかもしれない」と見なす。
 */
const PAGE_SIZE = 100;
/** records API が 1 回で返せる上限（route.ts の MAX_LIMIT）。 */
const MAX_PAGE_SIZE = 500;
/** 計算列の取り直しをまとめる待ち時間（ms）。 */
const COMPUTED_REFRESH_DELAY = 250;

function toGridRecord(r: RawRecord): GridRecord {
  return {
    id: r.id,
    data: (r.data as Record<string, unknown>) ?? {},
    computed: (r.computed as Record<string, unknown>) ?? {},
  };
}

/** 未入力セルの判定。undefined / null / "" / 空配列はすべて「空」と見なす。 */
function isEmptyCell(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * 2つのセル値が「保存しても結果が変わらない」か。
 *
 * 【不具合の再発防止】以前は `prev.data[key] === value` だけで判定していた。
 * 未入力の必須セルは prev 側が undefined、エディタが返すのは "" なので毎回
 * 「変更あり」になり、Tab で素通りしただけで PATCH が飛んで
 * 「◯◯は必須項目です」が出ていた。空同士・配列の中身も見て比較する。
 */
function sameCellValue(a: unknown, b: unknown): boolean {
  if (isEmptyCell(a) && isEmptyCell(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/** ラベル表（列key → 保存値 → 表示ラベル）を列ごとに深くマージする。 */
function mergeLabelMaps(
  base: Record<string, Record<string, string>>,
  extra: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  const out = { ...base };
  for (const [key, map] of Object.entries(extra)) {
    out[key] = { ...(out[key] ?? {}), ...map };
  }
  return out;
}

/**
 * 計算列（formula / lookup / rollup / vlookup）が参照している「入力列」の key 集合。
 *
 * どの列を編集したときに計算列を取り直す必要があるかを判断するために使う。
 * 設定の形が読み取れない計算列が1つでもあれば null を返し、呼び出し側は
 * 「どの列を編集しても計算に効く」と安全側に倒す（取りこぼして古い値を
 * 表示し続けるより、余分に1回取り直す方がましなため）。
 *
 * formula は式の中の {key} を数える。別の formula を参照していても、その
 * formula 自身の式もここで走査されるので、元になる入力列は必ず集合に入る。
 */
function computedSourceKeys(fields: GridField[]): Set<string> | null {
  const deps = new Set<string>();
  let opaque = false;
  for (const f of fields) {
    if (!isComputedField(f.type)) continue;
    const cfg = (f.config ?? {}) as Record<string, unknown>;
    if (f.type === "formula") {
      const expression = typeof cfg.expression === "string" ? cfg.expression : "";
      const refs = expression.match(/\{([^{}]+)\}/g);
      if (!refs) {
        opaque = true;
        continue;
      }
      for (const ref of refs) deps.add(ref.slice(1, -1).trim());
    } else if (f.type === "lookup" || f.type === "rollup") {
      // リンク列（via）が変わると引き直しになる。
      if (typeof cfg.via === "string") deps.add(cfg.via);
      else opaque = true;
    } else if (f.type === "vlookup") {
      // 結合キーの列（localKey）が変わると引き直しになる。
      if (typeof cfg.localKey === "string") deps.add(cfg.localKey);
      else opaque = true;
    } else {
      opaque = true;
    }
  }
  return opaque ? null : deps;
}

function toGridField(f: RawField): GridField {
  return {
    id: f.id,
    key: f.key,
    name: f.name,
    type: f.type as GridField["type"],
    required: f.required,
    options: (f.options as SelectOption[] | null) ?? null,
    config: (f.config as Record<string, unknown> | null) ?? null,
    position: f.position,
  };
}

type SortState = { key: string; dir: "asc" | "desc" };

/**
 * ルックアップ列の値を表示用ラベルへ置き換える。
 *
 * リンク先が select / multiselect のとき、computed に入っているのは保存値
 * （"parttime" のようなコード）。ダッシュボードの集計や保存済みフィルタが
 * その生の値を参照するので、データ側は絶対に書き換えず、表示の直前だけ
 * ラベル（「パート・アルバイト」）に差し替える。
 *
 * - 対応表に無いコードは、何が保存されているか分かるようそのまま出す。
 * - 複数リンク／multiselect では配列（や配列の配列）になるので再帰でたどる。
 * - 文字列以外（数値・真偽値・null）は触らない。0 や false を消さないため。
 *
 * 同じ規則は src/lib/relations.ts の labelLookupValue() にもある。あちらは
 * `server-only` なモジュールでクライアントから import できないため、ここに
 * 同じ規則を置いている。
 */
function labelLookupValue(
  value: unknown,
  labels: Record<string, string> | undefined,
): unknown {
  if (!labels) return value;
  if (Array.isArray(value)) return value.map((v) => labelLookupValue(v, labels));
  if (typeof value !== "string") return value;
  return labels[value] ?? value;
}

/**
 * Visible text for a cell — mirrors CellView's display logic (relation labels,
 * select/multiselect option labels, computed lookup/rollup) so that search
 * matches exactly what the user sees on screen.
 */
function cellDisplayText(
  field: GridField,
  data: Record<string, unknown>,
  computed: Record<string, unknown>,
  relLabels: Record<string, string> | undefined,
  lookupValueLabels: Record<string, string> | undefined,
): string {
  switch (field.type) {
    case "relation": {
      const ids = Array.isArray(data[field.key])
        ? (data[field.key] as string[])
        : [];
      return ids.map((id) => relLabels?.[id] ?? id).join(" ");
    }
    case "lookup":
    case "vlookup":
      // 検索は「画面に見えている文字」に一致してほしいので、ここもラベル後の値。
      // vlookup も lookup と同じく、引いた先が選択肢の列ならラベルで見せる。
      return displayValue(
        field.type,
        labelLookupValue(computed[field.key], lookupValueLabels),
      );
    case "rollup":
      return displayValue("rollup", computed[field.key]);
    case "formula":
      return displayValue(field.type, computed[field.key]);
    case "select": {
      const v = data[field.key];
      if (v === null || v === undefined || v === "") return "";
      const opt = field.options?.find((o) => o.value === v);
      return opt?.label ?? String(v);
    }
    case "multiselect": {
      const arr = Array.isArray(data[field.key])
        ? (data[field.key] as unknown[])
        : [];
      return arr
        .map(
          (v) => field.options?.find((o) => o.value === v)?.label ?? String(v),
        )
        .join(" ");
    }
    default:
      return displayValue(field.type, data[field.key]);
  }
}

/**
 * Comparable value for sorting. Numeric types (number / currency / rollup /
 * date) coerce to a number so they sort numerically; everything else falls back
 * to its display text (sorted lexicographically, Japanese-aware). `null` marks
 * an empty cell, which the comparator always pushes to the bottom.
 */
function cellSortValue(
  field: GridField,
  data: Record<string, unknown>,
  computed: Record<string, unknown>,
  relLabels: Record<string, string> | undefined,
  lookupValueLabels: Record<string, string> | undefined,
): number | string | null {
  if (field.type === "number" || field.type === "currency") {
    const raw = data[field.key];
    if (raw === null || raw === undefined || raw === "") return null;
    const n =
      typeof raw === "number"
        ? raw
        : Number(String(raw).replace(/[,\s¥$€£]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (field.type === "rollup") {
    const raw = computed[field.key];
    return typeof raw === "number" ? raw : null;
  }
  if (field.type === "formula" || field.type === "vlookup") {
    // Sort numerically when the computed value is a number, otherwise fall
    // through to its text so a text-valued join still orders sensibly.
    const raw = computed[field.key];
    if (typeof raw === "number") return raw;
    if (raw === null || raw === undefined || raw === "") return null;
    return String(raw);
  }
  if (field.type === "date") {
    const raw = data[field.key];
    if (raw === null || raw === undefined || raw === "") return null;
    const t = Date.parse(String(raw));
    return Number.isNaN(t) ? String(raw) : t;
  }
  const text = cellDisplayText(field, data, computed, relLabels, lookupValueLabels);
  return text === "" ? null : text;
}

/** Ordering for two sort values. Empty (null) cells always sort last. */
function compareCells(
  a: number | string | null,
  b: number | string | null,
  dir: "asc" | "desc",
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  let cmp: number;
  if (typeof a === "number" && typeof b === "number") cmp = a - b;
  else cmp = String(a).localeCompare(String(b), "ja");
  return dir === "desc" ? -cmp : cmp;
}

export function DataGrid({
  collection,
  fields: initialFields,
  initialRecords,
  relationLabels: initialRelationLabels,
  lookupLabels: initialLookupLabels,
  workspaceCollections,
}: {
  collection: { id: string; template: string };
  fields: RawField[];
  initialRecords: RawRecord[];
  relationLabels: Record<string, Record<string, string>>;
  /** lookupLabels[ルックアップ列のkey][保存値] = 選択肢のラベル（表示専用）。 */
  lookupLabels: Record<string, Record<string, string>>;
  workspaceCollections: WorkspaceCollection[];
}) {
  const [fields, setFields] = useState<GridField[]>(() =>
    initialFields.map(toGridField),
  );
  const [records, setRecords] = useState<GridRecord[]>(() =>
    initialRecords.map(toGridRecord),
  );
  const [relationLabels, setRelationLabels] = useState<
    Record<string, Record<string, string>>
  >(initialRelationLabels ?? {});
  const [lookupLabels, setLookupLabels] = useState<
    Record<string, Record<string, string>>
  >(initialLookupLabels ?? {});
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  /**
   * 下書き行の同期版。「行を追加」を押した瞬間の値を確実に読むために持つ。
   * ボタンを押すと（mousedown で）編集中セルの blur → 確定が先に走るので、
   * state だけを見ると 1 つ前の値を送ってしまうことがある。
   */
  const draftRef = useRef<Record<string, unknown>>({});
  /** 下書き行を送信中か（二重送信の防止と、ボタンの表示切り替えに使う）。 */
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);

  // 読み込み済みの範囲（P1-9）。サーバーは1ページぶんしか返さないので、
  // 「いま何件を手元に持っているか」と「続きがあるか」を画面に出す。
  const [hasMore, setHasMore] = useState(initialRecords.length >= PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  // Salesforce-style list controls: a text filter over displayed values and a
  // single active sort column (asc -> desc -> none).
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);

  // Cell being edited + a ref-backed draft value so instant-commit editors
  // (checkbox / select) read the freshest value rather than stale state.
  const [editing, setEditing] = useState<{ rowId: string; key: string } | null>(
    null,
  );
  const [editValue, setEditValue] = useState<unknown>(null);
  const editValueRef = useRef<unknown>(null);

  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [fieldModal, setFieldModal] = useState<
    { mode: "add" } | { mode: "edit"; field: GridField } | null
  >(null);
  const [menuField, setMenuField] = useState<string | null>(null);

  const busyRef = useRef(0);
  const bump = useCallback((delta: number) => {
    busyRef.current += delta;
    setBusy(busyRef.current);
  }, []);

  // イベントハンドラから「今の値」を読むための鏡。state はコールバックに
  // 閉じ込められると1つ前の値になり得るため、確定処理はこちらを見る。
  const recordsRef = useRef(records);
  useEffect(() => {
    recordsRef.current = records;
  }, [records]);
  /**
   * 編集中セルの同期版。
   *
   * 【不具合の再発防止】Enter → （input が消えることで）blur と、確定が二度
   * 呼ばれる経路がある。state の editing はまだ null になっていないので、
   * 同じセルが二度保存され、下書き行では 1 行の入力で 2 行できていた。
   * 確定したら即座にここを null にして、2 回目は入口で捨てる。
   */
  const editingRef = useRef<{ rowId: string; key: string } | null>(null);

  // セル編集を閉じたあと、フォーカスを戻す先（キーボード操作のときだけ設定）。
  const gridRef = useRef<HTMLDivElement>(null);
  const focusBackRef = useRef<{ rowId: string; key: string } | null>(null);

  const setDraftValue = useCallback((v: unknown) => {
    editValueRef.current = v;
    setEditValue(v);
  }, []);

  const startEdit = useCallback(
    (rowId: string, key: string, current: unknown) => {
      setError(null);
      editValueRef.current = current ?? null;
      setEditValue(current ?? null);
      editingRef.current = { rowId, key };
      setEditing({ rowId, key });
    },
    [],
  );

  const cancelEdit = useCallback(() => {
    // Esc はキーボード操作なので、閉じたあとは元のセルへフォーカスを戻す。
    focusBackRef.current = editingRef.current;
    editingRef.current = null;
    setEditing(null);
  }, []);

  /** Refresh field metadata from the server (after add / edit / delete). */
  const refetchFields = useCallback(async () => {
    const res = await fetch(`/api/collections/${collection.id}`);
    const json = await res.json();
    if (res.ok && json.ok) {
      setFields((json.data.fields as RawField[]).map(toGridField));
    }
  }, [collection.id]);

  /**
   * 行を取得する。`wanted` 件そろうまで cursor で継ぎ足す（API の上限は
   * 1回 MAX_PAGE_SIZE 件）。
   *
   * cursor には「取得済みの最後（＝最古）の行の id」を渡す。API が返す
   * nextCursor は次ページの先頭行そのものを指しており、API 側が cursor に
   * skip:1 を付けているため、そのまま渡すと 1 行取りこぼす。
   */
  const fetchRecordPages = useCallback(
    async (
      wanted: number,
      startCursor?: string,
    ): Promise<{
      records: RawRecord[];
      relationLabels: Record<string, Record<string, string>>;
      lookupLabels: Record<string, Record<string, string>>;
      hasMore: boolean;
    } | null> => {
      const out: RawRecord[] = [];
      let relLabels: Record<string, Record<string, string>> = {};
      let lookLabels: Record<string, Record<string, string>> = {};
      let cursor = startCursor;
      let more = false;
      while (out.length < wanted) {
        const params = new URLSearchParams({
          limit: String(Math.min(MAX_PAGE_SIZE, wanted - out.length)),
        });
        if (cursor) params.set("cursor", cursor);
        const res = await fetch(
          `/api/collections/${collection.id}/records?${params.toString()}`,
        );
        const json = await res.json();
        if (!res.ok || !json.ok) return null;
        const page = ((json.data.records as RawRecord[]) ?? []).slice();
        out.push(...page);
        relLabels = mergeLabelMaps(
          relLabels,
          (json.data.relationLabels as Record<
            string,
            Record<string, string>
          >) ?? {},
        );
        // ルックアップ先の列（選択肢）が差し替わることもあるので、ラベル対応表も
        // records と同じタイミングで取り直す。
        lookLabels = mergeLabelMaps(
          lookLabels,
          (json.data.lookupLabels as Record<
            string,
            Record<string, string>
          >) ?? {},
        );
        more = Boolean(json.data.nextCursor);
        if (page.length === 0 || !more) break;
        cursor = page[page.length - 1]?.id;
      }
      return {
        records: out,
        relationLabels: relLabels,
        lookupLabels: lookLabels,
        hasMore: more,
      };
    },
    [collection.id],
  );

  /**
   * 読み込み済みの行を丸ごと取り直す（列の追加・変更のあとに使う）。
   * 列の定義が変わると計算列もリンクのラベルも作り直しになるため。
   */
  const refreshRecords = useCallback(async () => {
    const page = await fetchRecordPages(
      Math.max(recordsRef.current.length, PAGE_SIZE),
    );
    if (!page) return;
    setRecords(page.records.map(toGridRecord));
    setRelationLabels(page.relationLabels);
    setLookupLabels(page.lookupLabels);
    setHasMore(page.hasMore);
  }, [fetchRecordPages]);

  /**
   * 計算列（formula / lookup / rollup / vlookup）とラベルだけを取り直して、
   * 手元の行にマージする。
   *
   * 【不具合の再発防止】保存が成功したとき data だけを差し替え、computed は
   * 前のまま持ち回っていたため、{売上} - {原価} のような列が編集後もずっと
   * 古い数字を表示していた（再読み込みするまで気付けない）。サーバーは
   * 計算値を書き込み時の応答に含めないので、ここで取り直すしかない。
   *
   * data は触らない。取得している最中に別のセルを編集していても、その入力を
   * 巻き戻さないため。
   */
  const refreshComputed = useCallback(async () => {
    try {
      const page = await fetchRecordPages(
        Math.max(recordsRef.current.length, PAGE_SIZE),
      );
      if (!page) return;
      const computedById = new Map(
        page.records.map((r) => [
          r.id,
          (r.computed as Record<string, unknown>) ?? {},
        ]),
      );
      setRecords((rs) =>
        rs.map((r) =>
          computedById.has(r.id)
            ? { ...r, computed: computedById.get(r.id) ?? {} }
            : r,
        ),
      );
      setRelationLabels((m) => mergeLabelMaps(m, page.relationLabels));
      setLookupLabels((m) => mergeLabelMaps(m, page.lookupLabels));
    } catch {
      // 計算値の取り直しに失敗しても、保存そのものは成功している。
      // ここでエラー表示は出さない（次の編集でまた取り直す）。
    }
  }, [fetchRecordPages]);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 計算列の取り直しを予約する。続けてセルを編集したときに 1 回にまとめる
   * （1セルごとにシート全体を取り直さないための間引き）。
   */
  const scheduleComputedRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshComputed();
    }, COMPUTED_REFRESH_DELAY);
  }, [refreshComputed]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    [],
  );

  /** この列を書き換えると計算列の値が変わるか。 */
  const computedDeps = useMemo(() => computedSourceKeys(fields), [fields]);
  const hasComputedColumn = useMemo(
    () => fields.some((f) => isComputedField(f.type)),
    [fields],
  );
  const affectsComputed = useCallback(
    (key: string) => {
      if (!hasComputedColumn) return false;
      return computedDeps === null || computedDeps.has(key);
    },
    [hasComputedColumn, computedDeps],
  );

  /** 続きの行を読み込む（P1-9：100件で黙って打ち切らない）。 */
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const loaded = recordsRef.current;
      const page = await fetchRecordPages(
        PAGE_SIZE,
        loaded[loaded.length - 1]?.id,
      );
      if (!page) {
        setError("行を読み込めませんでした");
        return;
      }
      setRecords((rs) => {
        const seen = new Set(rs.map((r) => r.id));
        return [
          ...rs,
          ...page.records.filter((r) => !seen.has(r.id)).map(toGridRecord),
        ];
      });
      setRelationLabels((m) => mergeLabelMaps(m, page.relationLabels));
      setLookupLabels((m) => mergeLabelMaps(m, page.lookupLabels));
      setHasMore(page.hasMore);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [fetchRecordPages]);

  /** After a field is added/edited: refresh both schema and computed values. */
  const handleFieldSaved = useCallback(async () => {
    await refetchFields();
    await refreshRecords();
  }, [refetchFields, refreshRecords]);

  /** 下書き行の 1 セルを更新する（ref と state を同時に進める）。 */
  const setDraftCell = useCallback((key: string, value: unknown) => {
    if (sameCellValue(draftRef.current[key], value)) return;
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    setDraft(next);
  }, []);

  /**
   * 編集中のセルを確定する。
   *
   * 【不具合の再発防止】以前は下書き行でもセルを離れるたびに POST しており、
   *   ・5 列入力すると 5 行できる（列ごとに 1 行）
   *   ・クリックしただけのセルで空の行ができる
   *   ・前の POST の最中に次のセルを確定すると 2 行できる
   * という状態だった。下書き行はここでは通信せず、手元に貯めるだけにして、
   * 行の作成は「行を追加」ボタン（createDraftRecord）だけが行う。
   */
  const commitEdit = useCallback(
    async (opts?: { focusBack?: boolean }) => {
      const target = editingRef.current;
      if (!target) return; // Enter → blur のように二度呼ばれても 1 回だけ
      const { rowId, key } = target;
      const value = editValueRef.current;
      editingRef.current = null;
      if (opts?.focusBack) focusBackRef.current = target;
      setEditing(null);

      if (rowId === DRAFT_ID) {
        // 触っただけ（値が変わっていない）のセルでは下書きを汚さない。
        setDraftCell(key, value);
        return;
      }

      // Existing record: optimistic PATCH with rollback on failure.
      const prev = recordsRef.current.find((r) => r.id === rowId);
      if (!prev) return;
      const prevValue = prev.data[key];
      if (sameCellValue(prevValue, value)) return; // 実質変更なし
      const committedField = fields.find((f) => f.key === key);

      setRecords((rs) =>
        rs.map((r) =>
          r.id === rowId ? { ...r, data: { ...r.data, [key]: value } } : r,
        ),
      );
      /**
       * 失敗したときに戻すのは「今回書き換えた列」だけ。
       *
       * 【不具合の再発防止】確定した時点の行データ全体を控えて戻していたため、
       * セルA→セルBと編集してBの保存が先に成功しAが失敗すると、サーバーには
       * 残っているBの値まで画面から消えていた。
       */
      const rollbackCell = () =>
        setRecords((rs) =>
          rs.map((r) => {
            if (r.id !== rowId) return r;
            const data = { ...r.data };
            if (prevValue === undefined) delete data[key];
            else data[key] = prevValue;
            return { ...r, data };
          }),
        );

      bump(1);
      try {
        const res = await fetch(`/api/records/${rowId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: { [key]: value } }),
        });
        const json = await res.json();
        if (res.ok && json.ok) {
          // サーバーが整えた値を採り入れるのも、書き換えた列だけにする
          //（応答は PATCH を投げた時点の行なので、他の列を上書きすると
          //  同時進行の別セルの編集を巻き戻してしまう）。
          const serverData = (json.data.data as Record<string, unknown>) ?? {};
          setRecords((rs) =>
            rs.map((r) => {
              if (r.id !== rowId) return r;
              const data = { ...r.data };
              if (key in serverData) data[key] = serverData[key];
              else delete data[key]; // サーバー側で空として落とされた
              return { ...r, data };
            }),
          );
          setError(null);
          // 計算列やリンクのラベルは書き込みの応答に含まれないので取り直す。
          if (committedField?.type === "relation" || affectsComputed(key)) {
            scheduleComputedRefresh();
          }
        } else {
          rollbackCell();
          setError(json.error ?? "保存に失敗しました");
        }
      } catch {
        rollbackCell();
        setError("通信エラーが発生しました");
      } finally {
        bump(-1);
      }
    },
    [fields, bump, setDraftCell, affectsComputed, scheduleComputedRefresh],
  );

  /** 下書きに 1 つでも中身があるか（「行を追加」を押せる条件）。 */
  const draftFilled = useMemo(
    () => Object.values(draft).some((v) => !isEmptyCell(v)),
    [draft],
  );

  /**
   * 下書き行を「1 行のレコード」として保存する。行が増えるのはここだけ。
   * 送信中は creatingRef で入口を閉じ、二重送信で 2 行できないようにする。
   */
  const createDraftRecord = useCallback(async () => {
    if (creatingRef.current) return;
    const data = draftRef.current;
    if (!Object.values(data).some((v) => !isEmptyCell(v))) {
      setError("新しい行に何か入力してから「行を追加」を押してください");
      return;
    }
    creatingRef.current = true;
    setCreating(true);
    bump(1);
    try {
      const res = await fetch(`/api/collections/${collection.id}/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setRecords((rs) => [
          {
            id: json.data.id as string,
            data: (json.data.data as Record<string, unknown>) ?? {},
            computed: {},
          },
          ...rs,
        ]);
        draftRef.current = {};
        setDraft({});
        setError(null);
        // 追加直後の行は計算列が空（サーバーは応答に計算値を含めない）。
        // リンクのラベルも同様なので、あとから取り直して埋める。
        if (hasComputedColumn || fields.some((f) => f.type === "relation")) {
          scheduleComputedRefresh();
        }
      } else {
        // 必須項目の未入力など。下書きは残して、続きを入力できるようにする。
        setError(json.error ?? "行を保存できませんでした");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      creatingRef.current = false;
      setCreating(false);
      bump(-1);
    }
  }, [
    collection.id,
    bump,
    fields,
    hasComputedColumn,
    scheduleComputedRefresh,
  ]);

  /** 下書き行の入力を捨てる。 */
  const clearDraft = useCallback(() => {
    editingRef.current = null;
    setEditing(null);
    draftRef.current = {};
    setDraft({});
    setError(null);
  }, []);

  /** Delete a row (with confirm) — optimistic removal, restore on failure. */
  const deleteRecord = useCallback(
    async (id: string) => {
      if (!confirm("この行を削除しますか？")) return;
      const snapshot = records;
      setRecords((rs) => rs.filter((r) => r.id !== id));
      bump(1);
      try {
        const res = await fetch(`/api/records/${id}`, { method: "DELETE" });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          setRecords(snapshot);
          setError(json.error ?? "削除に失敗しました");
        }
      } catch {
        setRecords(snapshot);
        setError("通信エラーが発生しました");
      } finally {
        bump(-1);
      }
    },
    [records, bump],
  );

  const deleteField = useCallback(
    async (field: GridField) => {
      setMenuField(null);
      if (!confirm(`項目「${field.name}」を削除しますか？`)) return;
      bump(1);
      try {
        const res = await fetch(
          `/api/collections/${collection.id}/fields/${field.id}`,
          { method: "DELETE" },
        );
        const json = await res.json();
        if (res.ok && json.ok) {
          await refetchFields();
        } else {
          setError(json.error ?? "項目の削除に失敗しました");
        }
      } catch {
        setError("通信エラーが発生しました");
      } finally {
        bump(-1);
      }
    },
    [collection.id, refetchFields, bump],
  );

  const columns = useMemo(
    () => [...fields].sort((a, b) => a.position - b.position),
    [fields],
  );

  /** Cycle a column's sort: none/other -> asc -> desc -> none. */
  const toggleSort = useCallback((key: string) => {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: "asc" };
      if (s.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }, []);

  /**
   * Saved records after search + sort. Derived (never mutates `records`) so
   * edits/adds/deletes flow through while the current filter/order stays applied.
   * The trailing draft row is rendered separately and is intentionally excluded.
   */
  const visibleRecords = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = records;
    if (q) {
      rows = rows.filter((rec) =>
        columns.some((f) =>
          cellDisplayText(
            f,
            rec.data,
            rec.computed,
            relationLabels[f.key],
            lookupLabels[f.key],
          )
            .toLowerCase()
            .includes(q),
        ),
      );
    }
    if (sort) {
      const field = columns.find((f) => f.key === sort.key);
      if (field) {
        rows = [...rows].sort((ra, rb) =>
          compareCells(
            cellSortValue(
              field,
              ra.data,
              ra.computed,
              relationLabels[field.key],
              lookupLabels[field.key],
            ),
            cellSortValue(
              field,
              rb.data,
              rb.computed,
              relationLabels[field.key],
              lookupLabels[field.key],
            ),
            sort.dir,
          ),
        );
      }
    }
    return rows;
  }, [records, columns, query, sort, relationLabels, lookupLabels]);

  /** 編集できるセルを画面の並び順に並べたもの（Tab 移動用）。計算列は飛ばす。 */
  const editableCells = useMemo(() => {
    const cells: Array<{ rowId: string; key: string }> = [];
    const editableColumns = columns.filter((f) => !isComputedField(f.type));
    for (const rec of visibleRecords) {
      for (const f of editableColumns) cells.push({ rowId: rec.id, key: f.key });
    }
    for (const f of editableColumns) {
      cells.push({ rowId: DRAFT_ID, key: f.key });
    }
    return cells;
  }, [visibleRecords, columns]);

  /**
   * Tab / Shift+Tab：今のセルを確定して、隣のセルの編集を開く。
   * フッターに「Enter で確定」と書いてある表計算の作法に Tab も合わせる
   * （以前は input が消えるだけで、フォーカスが <body> に落ちていた）。
   */
  const moveEdit = useCallback(
    (delta: 1 | -1) => {
      const current = editingRef.current;
      void commitEdit({ focusBack: true });
      if (!current) return;
      const index = editableCells.findIndex(
        (c) => c.rowId === current.rowId && c.key === current.key,
      );
      const next = index < 0 ? undefined : editableCells[index + delta];
      if (!next) return; // 端では元のセルへフォーカスを戻す（focusBack）
      focusBackRef.current = null;
      const data =
        next.rowId === DRAFT_ID
          ? draftRef.current
          : (recordsRef.current.find((r) => r.id === next.rowId)?.data ?? {});
      startEdit(next.rowId, next.key, data[next.key]);
    },
    [commitEdit, editableCells, startEdit],
  );

  /**
   * エディタを閉じたあと、元のセル（ボタン）へフォーカスを戻す。
   * 入力欄が消えた瞬間にフォーカスが <body> へ落ちると、キーボードでは表の
   * 先頭からたどり直しになっていた。
   */
  useEffect(() => {
    if (editing) return;
    const target = focusBackRef.current;
    if (!target) return;
    focusBackRef.current = null;
    const nodes = gridRef.current?.querySelectorAll<HTMLElement>(
      "[data-cell-key]",
    );
    nodes?.forEach((node) => {
      if (
        node.dataset.cellRow === target.rowId &&
        node.dataset.cellKey === target.key
      ) {
        node.focus();
      }
    });
  }, [editing]);

  const isEditing = (rowId: string, key: string) =>
    editing?.rowId === rowId && editing.key === key;

  function renderCell(
    rowId: string,
    field: GridField,
    data: Record<string, unknown>,
    computed: Record<string, unknown>,
  ) {
    const relLabels = relationLabels[field.key];
    // Use the shared predicate — a hardcoded pair silently left new computed
    // types (formula / vlookup) reading from `data`, where they never exist.
    const isComputed = isComputedField(field.type);

    if (isEditing(rowId, field.key)) {
      return (
        <CellEditor
          field={field}
          value={editValue}
          relationLabels={relLabels}
          onChange={setDraftValue}
          onCommit={commitEdit}
          onCancel={cancelEdit}
          onMove={moveEdit}
        />
      );
    }

    // Computed columns are read-only: render a non-interactive cell.
    if (isComputed) {
      // ルックアップだけは、保存値ではなく選択肢のラベルを見せる（データは生の
      // ままなので、差し替えるのはこの表示用の値だけ）。
      const shown =
        field.type === "lookup" || field.type === "vlookup"
          ? labelLookupValue(computed[field.key], lookupLabels[field.key])
          : computed[field.key];
      // 計算列は編集できないが、キーボードでも読めるようにフォーカスは受ける
      // （以前はただの <div> で、Tab では計算列だけ丸ごと飛ばされていた）。
      return (
        <div
          tabIndex={0}
          aria-readonly="true"
          title={`${field.name}（自動計算のため編集できません）`}
          className="flex h-full min-h-[38px] w-full items-center px-2.5 py-1 text-left text-sm text-ink-muted focus:bg-khaki-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-khaki-500/30"
        >
          <CellView field={field} value={shown} />
          <span className="sr-only">（自動計算・編集不可）</span>
        </div>
      );
    }

    return (
      <button
        type="button"
        data-cell-row={rowId}
        data-cell-key={field.key}
        onClick={() => startEdit(rowId, field.key, data[field.key])}
        className="flex h-full min-h-[38px] w-full items-center px-2.5 py-1 text-left text-sm text-ink hover:bg-khaki-50/60 focus:bg-khaki-50 focus:outline-none"
      >
        <CellView field={field} value={data[field.key]} relationLabels={relLabels} />
      </button>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="card animate-fade-in p-10 text-center">
        <p className="text-sm text-ink-muted">
          まだ項目（列）がありません。最初の項目を追加してください。
        </p>
        <div className="mt-4">
          <Button onClick={() => setFieldModal({ mode: "add" })}>
            + 項目を追加
          </Button>
        </div>
        {fieldModal && (
          <FieldEditor
            collectionId={collection.id}
            field={fieldModal.mode === "edit" ? fieldModal.field : undefined}
            collectionFields={fields}
            workspaceCollections={workspaceCollections}
            onClose={() => setFieldModal(null)}
            onSaved={handleFieldSaved}
          />
        )}
      </div>
    );
  }

  const loadedCount = records.length;
  const filtering = query.trim() !== "" || sort !== null;

  return (
    <div ref={gridRef} className="animate-fade-in space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-ink-faint">
            <SearchIcon />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="検索…"
            aria-label="行を検索"
            className="h-9 w-full rounded-md border border-ink-rule bg-paper-raised pl-8 pr-2 text-sm text-ink placeholder:text-ink-faint focus:border-khaki-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-khaki-500/30"
          />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* 読み込み済みの件数を明示する。以前は「100 件」とだけ出ていて、
              10,000 行のシートでも 100 件しかないように見えていた（P1-9）。 */}
          <span className="text-sm text-ink-muted">
            {filtering
              ? `${visibleRecords.length} / ${loadedCount} 件`
              : `${loadedCount} 件`}
            {hasMore && (
              <span className="text-ink-faint">（読み込み済み・続きあり）</span>
            )}
          </span>
          {/* aria-live は「中身が変わったとき」に読み上げられる。常に同じ文字を
              置いて opacity で見せ消ししていたので、何も読み上げられなかった。 */}
          <span className="min-w-[3.5rem] text-xs text-ink-faint" aria-live="polite">
            {busy > 0 ? "保存中…" : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFieldModal({ mode: "add" })}
          >
            + 項目を追加
          </Button>
        </div>
      </div>

      {/* 検索・並び替えが「読み込み済みのぶんだけ」であることを、操作している
          その場で断る（黙って一部だけを対象にしない）。 */}
      {hasMore && filtering && (
        <p className="rounded border border-ink-line bg-paper-sunken px-3 py-2 text-xs text-ink-muted">
          検索と並び替えの対象は、読み込み済みの {loadedCount}{" "}
          件だけです。全体を対象にするには、表の下の「さらに {PAGE_SIZE}{" "}
          件読み込む」で残りの行を読み込んでください。
        </p>
      )}

      {/* 保存の失敗は role="alert" で必ず読み上げる。表の上に置くと 80 行目を
          編集しているときは画面外なので、画面下端に固定して出す（P1-15）。 */}
      {error && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-40 flex w-[min(32rem,92vw)] -translate-x-1/2 items-start gap-2 rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger shadow-raised"
        >
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 rounded px-1 font-medium text-danger/80 hover:text-danger"
            aria-label="エラー表示を閉じる"
          >
            ×
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-ink-line">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-paper-sunken">
              <th
                scope="col"
                className="w-10 border-b border-r border-ink-rule px-2 py-2 text-2xs font-medium text-ink-muted"
              >
                #
              </th>
              {columns.map((field) => (
                <th
                  key={field.id}
                  scope="col"
                  // 見出しは並び替えの操作子でもあるので、今の並び順を伝える。
                  aria-sort={
                    sort?.key === field.key
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className="min-w-[160px] border-b border-r border-ink-rule px-2 py-1.5 text-left align-middle"
                  title={FIELD_TYPE_META[field.type].label}
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => toggleSort(field.key)}
                      title="クリックで並び替え"
                      className="min-w-0 flex-1 rounded py-1 text-left transition-colors duration-fast hover:bg-paper-raised focus:outline-none focus:ring-2 focus:ring-inset focus:ring-khaki-500/30 active:bg-ink-line"
                    >
                      {/* The field's data type used to be printed under every
                          column name. It is reference information, not something
                          you read while scanning rows, so it moved to the header
                          tooltip and the field menu — one less line of text in
                          every column, on every table. */}
                      <div className="flex items-center gap-1 truncate text-sm font-semibold text-ink">
                        <span className="truncate">{field.name}</span>
                        {field.required && (
                          <span className="text-danger" title="必須">
                            *
                          </span>
                        )}
                        {sort?.key === field.key && (
                          <span
                            className="shrink-0 text-xs text-khaki-700"
                            aria-hidden="true"
                          >
                            {sort.dir === "asc" ? "▲" : "▼"}
                          </span>
                        )}
                      </div>
                    </button>
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setMenuField((m) => (m === field.id ? null : field.id))
                        }
                        className="rounded p-1 text-ink-faint hover:bg-paper-raised hover:text-ink-soft"
                        aria-label={`${field.name} の操作`}
                      >
                        <DotsIcon />
                      </button>
                      {menuField === field.id && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setMenuField(null)}
                            aria-hidden="true"
                          />
                          <div className="absolute right-0 z-20 mt-1 w-40 animate-fade-in rounded-md border border-ink-line bg-paper-raised p-1 shadow-raised">
                            <button
                              type="button"
                              onClick={() => {
                                setMenuField(null);
                                setFieldModal({ mode: "edit", field });
                              }}
                              className="block w-full rounded px-3 py-1.5 text-left text-sm text-ink-soft hover:bg-paper-sunken"
                            >
                              項目を編集
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteField(field)}
                              className="block w-full rounded px-3 py-1.5 text-left text-sm text-danger hover:bg-danger-soft"
                            >
                              項目を削除
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </th>
              ))}
              {/* Record-page affordance; header intentionally blank. */}
              <th
                scope="col"
                className="w-14 border-b border-r border-ink-line px-2 py-1.5"
                aria-label="レコードを開く"
              />
              <th scope="col" className="w-10 border-b border-ink-line px-1 py-1.5">
                <button
                  type="button"
                  onClick={() => setFieldModal({ mode: "add" })}
                  className="flex h-6 w-6 items-center justify-center rounded text-ink-faint hover:bg-paper-raised hover:text-khaki-600"
                  aria-label="項目を追加"
                >
                  <PlusIcon />
                </button>
              </th>
            </tr>
          </thead>

          <tbody>
            {query.trim() !== "" && visibleRecords.length === 0 && (
              <tr className="border-b border-ink-line/70 bg-paper">
                <td
                  colSpan={columns.length + 3}
                  className="px-3 py-8 text-center text-sm text-ink-muted"
                >
                  {hasMore
                    ? `読み込み済みの ${loadedCount} 件には該当する行がありません（未読み込みの行は対象外です）`
                    : "該当する行がありません"}
                </td>
              </tr>
            )}
            {visibleRecords.map((rec, i) => (
              <tr
                key={rec.id}
                /* No zebra striping. With vertical rules already separating the
                   columns, alternating row fills only added visual noise — the
                   grid read as a pattern before it read as data. */
                className="group border-b border-ink-line bg-paper-raised transition-colors duration-fast hover:bg-khaki-50/70"
              >
                <td className="relative border-r border-ink-line px-2 text-center align-middle text-2xs text-ink-faint">
                  <span className="group-hover:invisible">{i + 1}</span>
                  {/* invisible だとタブ順から外れ、キーボードでは行を消せなかった。
                      見え方は今までどおり（ホバーで出る）まま、フォーカスできる
                      ようにして、フォーカス時は行番号に重ねて見せる（P1-15）。 */}
                  <button
                    type="button"
                    onClick={() => deleteRecord(rec.id)}
                    className="absolute inset-0 mx-auto flex items-center justify-center text-ink-faint opacity-0 transition-opacity hover:text-danger focus:bg-paper-raised focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-khaki-500/40 group-hover:opacity-100"
                    aria-label={`${i + 1} 行目を削除`}
                  >
                    <TrashIcon />
                  </button>
                </td>
                {columns.map((field) => (
                  <td
                    key={field.id}
                    className="border-r border-ink-line/70 p-0 align-middle"
                  >
                    {renderCell(rec.id, field, rec.data, rec.computed)}
                  </td>
                ))}
                {/* Open this row as a Salesforce-style record page. */}
                <td className="border-r border-ink-line/70 px-2 text-center align-middle">
                  <Link
                    href={`/r/${collection.id}/${rec.id}`}
                    className="text-2xs font-medium text-ink-faint hover:text-khaki-700 hover:underline"
                  >
                    開く
                  </Link>
                </td>
                <td className="bg-transparent" />
              </tr>
            ))}

            {/* 最下段の新規入力行。ここに入力しても行はまだ作られない
                （表の下の「行を追加」で 1 行としてまとめて保存する）。 */}
            <tr className="border-b border-ink-line bg-khaki-50/40">
              <td
                className="border-r border-ink-line px-2 text-center align-middle text-khaki-600"
                title="新規入力行（「行を追加」で保存）"
              >
                <PlusIcon />
                <span className="sr-only">新規入力行</span>
              </td>
              {columns.map((field) => (
                <td
                  key={field.id}
                  className="border-r border-ink-line/70 p-0 align-middle"
                >
                  {renderCell(DRAFT_ID, field, draft, EMPTY_COMPUTED)}
                </td>
              ))}
              {/* 下書き行にはまだ id が無いので、開く先も無い。かわりに、
                  この行がまだ保存されていないことをその場で見せる。 */}
              <td className="border-r border-ink-line/70 px-2 text-center align-middle">
                {draftFilled && (
                  <span className="text-2xs font-medium text-khaki-700">
                    未保存
                  </span>
                )}
              </td>
              <td className="bg-transparent" />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={createDraftRecord}
          disabled={!draftFilled || creating}
        >
          {creating ? "追加中…" : "行を追加"}
        </Button>
        {draftFilled && !creating && (
          <Button variant="ghost" size="sm" onClick={clearDraft}>
            入力を取消
          </Button>
        )}
        {hasMore && (
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "読み込み中…" : `さらに ${PAGE_SIZE} 件読み込む`}
          </Button>
        )}
      </div>

      <p className="text-xs text-ink-faint">
        セルをクリックして編集、Enter で確定、Tab で次のセル、Esc で取消。
        最下行（＋の行）に入力してから「行を追加」を押すと、1 行としてまとめて保存されます。
        {hasMore &&
          `　いまは新しい順に ${loadedCount} 件だけ読み込んでいます。`}
      </p>

      {fieldModal && (
        <FieldEditor
          collectionId={collection.id}
          field={fieldModal.mode === "edit" ? fieldModal.field : undefined}
          collectionFields={fields}
          workspaceCollections={workspaceCollections}
          onClose={() => setFieldModal(null)}
          onSaved={handleFieldSaved}
        />
      )}
    </div>
  );
}

/* --------------------------------- icons ---------------------------------- */

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.4-3.4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}
