"use client";

/**
 * Spreadsheet-style editable grid — the primary way users work with a
 * Collection's rows. No external grid library: a plain <table> plus React
 * state, with inline per-type cell editors, optimistic writes, error rollback,
 * a subtle saving indicator, and column-header actions (add / edit / delete a
 * field). Persistence goes through the records + fields API routes.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  FIELD_TYPE_META,
  displayValue,
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
 * Visible text for a cell — mirrors CellView's display logic (relation labels,
 * select/multiselect option labels, computed lookup/rollup) so that search
 * matches exactly what the user sees on screen.
 */
function cellDisplayText(
  field: GridField,
  data: Record<string, unknown>,
  computed: Record<string, unknown>,
  relLabels: Record<string, string> | undefined,
): string {
  switch (field.type) {
    case "relation": {
      const ids = Array.isArray(data[field.key])
        ? (data[field.key] as string[])
        : [];
      return ids.map((id) => relLabels?.[id] ?? id).join(" ");
    }
    case "lookup":
      return displayValue("lookup", computed[field.key]);
    case "rollup":
      return displayValue("rollup", computed[field.key]);
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
  if (field.type === "date") {
    const raw = data[field.key];
    if (raw === null || raw === undefined || raw === "") return null;
    const t = Date.parse(String(raw));
    return Number.isNaN(t) ? String(raw) : t;
  }
  const text = cellDisplayText(field, data, computed, relLabels);
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
  workspaceCollections,
}: {
  collection: { id: string; template: string };
  fields: RawField[];
  initialRecords: RawRecord[];
  relationLabels: Record<string, Record<string, string>>;
  workspaceCollections: WorkspaceCollection[];
}) {
  const [fields, setFields] = useState<GridField[]>(() =>
    initialFields.map(toGridField),
  );
  const [records, setRecords] = useState<GridRecord[]>(() =>
    initialRecords.map((r) => ({
      id: r.id,
      data: (r.data as Record<string, unknown>) ?? {},
      computed: (r.computed as Record<string, unknown>) ?? {},
    })),
  );
  const [relationLabels, setRelationLabels] = useState<
    Record<string, Record<string, string>>
  >(initialRelationLabels ?? {});
  const [draft, setDraft] = useState<Record<string, unknown>>({});

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

  const setDraftValue = useCallback((v: unknown) => {
    editValueRef.current = v;
    setEditValue(v);
  }, []);

  const startEdit = useCallback(
    (rowId: string, key: string, current: unknown) => {
      setError(null);
      editValueRef.current = current ?? null;
      setEditValue(current ?? null);
      setEditing({ rowId, key });
    },
    [],
  );

  const cancelEdit = useCallback(() => setEditing(null), []);

  /** Refresh field metadata from the server (after add / edit / delete). */
  const refetchFields = useCallback(async () => {
    const res = await fetch(`/api/collections/${collection.id}`);
    const json = await res.json();
    if (res.ok && json.ok) {
      setFields((json.data.fields as RawField[]).map(toGridField));
    }
  }, [collection.id]);

  /**
   * Re-fetch records + relation labels. Needed after a relation changes (or a
   * relation/lookup/rollup field is added/edited) so lookup/rollup values
   * recompute and new link labels appear.
   */
  const refreshRecords = useCallback(async () => {
    const res = await fetch(`/api/collections/${collection.id}/records`);
    const json = await res.json();
    if (res.ok && json.ok) {
      setRecords(
        (json.data.records as RawRecord[]).map((r) => ({
          id: r.id,
          data: (r.data as Record<string, unknown>) ?? {},
          computed: (r.computed as Record<string, unknown>) ?? {},
        })),
      );
      setRelationLabels(
        (json.data.relationLabels as Record<
          string,
          Record<string, string>
        >) ?? {},
      );
    }
  }, [collection.id]);

  /** After a field is added/edited: refresh both schema and computed values. */
  const handleFieldSaved = useCallback(async () => {
    await refetchFields();
    await refreshRecords();
  }, [refetchFields, refreshRecords]);

  /** Commit the active editor: PATCH an existing row or POST the draft row. */
  const commitEdit = useCallback(async () => {
    if (!editing) return;
    const { rowId, key } = editing;
    const value = editValueRef.current;
    setEditing(null);

    const committedField = fields.find((f) => f.key === key);
    const isRelation = committedField?.type === "relation";

    if (rowId === DRAFT_ID) {
      const nextData = { ...draft, [key]: value };
      setDraft(nextData);
      bump(1);
      try {
        const res = await fetch(`/api/collections/${collection.id}/records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: nextData }),
        });
        const json = await res.json();
        if (res.ok && json.ok) {
          setRecords((rs) => [
            { id: json.data.id, data: json.data.data ?? {}, computed: {} },
            ...rs,
          ]);
          setDraft({}); // reset the trailing new-row for the next entry
          setError(null);
          // A new relation link needs a refresh to compute labels/rollups.
          if (isRelation) await refreshRecords();
        } else {
          // Likely a missing required field — keep the draft so the user can
          // finish filling it in. Surface the reason subtly.
          setError(json.error ?? "行を保存できませんでした");
        }
      } catch {
        setError("通信エラーが発生しました");
      } finally {
        bump(-1);
      }
      return;
    }

    // Existing record: optimistic PATCH with rollback on failure.
    const prev = records.find((r) => r.id === rowId);
    if (!prev) return;
    if (prev.data[key] === value) return; // no-op
    const prevData = prev.data;
    setRecords((rs) =>
      rs.map((r) => (r.id === rowId ? { ...r, data: { ...r.data, [key]: value } } : r)),
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
        // Adopt the server's canonical row (coerced values).
        setRecords((rs) =>
          rs.map((r) => (r.id === rowId ? { ...r, data: json.data.data ?? {} } : r)),
        );
        setError(null);
        // Relation changed -> recompute dependent lookup/rollup + labels.
        if (isRelation) await refreshRecords();
      } else {
        setRecords((rs) =>
          rs.map((r) => (r.id === rowId ? { ...r, data: prevData } : r)),
        );
        setError(json.error ?? "保存に失敗しました");
      }
    } catch {
      setRecords((rs) =>
        rs.map((r) => (r.id === rowId ? { ...r, data: prevData } : r)),
      );
      setError("通信エラーが発生しました");
    } finally {
      bump(-1);
    }
  }, [editing, draft, records, collection.id, bump, fields, refreshRecords]);

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
          cellDisplayText(f, rec.data, rec.computed, relationLabels[f.key])
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
            cellSortValue(field, ra.data, ra.computed, relationLabels[field.key]),
            cellSortValue(field, rb.data, rb.computed, relationLabels[field.key]),
            sort.dir,
          ),
        );
      }
    }
    return rows;
  }, [records, columns, query, sort, relationLabels]);

  const isEditing = (rowId: string, key: string) =>
    editing?.rowId === rowId && editing.key === key;

  function renderCell(
    rowId: string,
    field: GridField,
    data: Record<string, unknown>,
    computed: Record<string, unknown>,
  ) {
    const relLabels = relationLabels[field.key];
    const isComputed = field.type === "lookup" || field.type === "rollup";

    if (isEditing(rowId, field.key)) {
      return (
        <CellEditor
          field={field}
          value={editValue}
          relationLabels={relLabels}
          onChange={setDraftValue}
          onCommit={commitEdit}
          onCancel={cancelEdit}
        />
      );
    }

    // Lookup / rollup are read-only: render a non-interactive cell.
    if (isComputed) {
      return (
        <div className="flex h-full min-h-[38px] w-full items-center px-2.5 py-1 text-left text-sm text-ink-muted">
          <CellView field={field} value={computed[field.key]} />
        </div>
      );
    }

    return (
      <button
        type="button"
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

  return (
    <div className="animate-fade-in space-y-3">
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
          <span className="text-sm text-ink-muted">
            {visibleRecords.length} 件
          </span>
          <span
            className={cn(
              "text-xs text-ink-faint transition-opacity",
              busy > 0 ? "opacity-100" : "opacity-0",
            )}
            aria-live="polite"
          >
            保存中…
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

      {error && (
        <div className="rounded border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-ink-line">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-paper-sunken">
              <th className="w-10 border-b border-r border-ink-rule px-2 py-2 text-2xs font-medium text-ink-muted">
                #
              </th>
              {columns.map((field) => (
                <th
                  key={field.id}
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
                className="w-14 border-b border-r border-ink-line px-2 py-1.5"
                aria-label="レコードを開く"
              />
              <th className="w-10 border-b border-ink-line px-1 py-1.5">
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
                  該当する行がありません
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
                  <button
                    type="button"
                    onClick={() => deleteRecord(rec.id)}
                    className="invisible absolute inset-0 mx-auto flex items-center justify-center text-ink-faint hover:text-danger group-hover:visible"
                    aria-label="行を削除"
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

            {/* Trailing always-present "new row". */}
            <tr className="border-b border-ink-line bg-khaki-50/40">
              <td className="border-r border-ink-line px-2 text-center align-middle text-khaki-600">
                <PlusIcon />
              </td>
              {columns.map((field) => (
                <td
                  key={field.id}
                  className="border-r border-ink-line/70 p-0 align-middle"
                >
                  {renderCell(DRAFT_ID, field, draft, EMPTY_COMPUTED)}
                </td>
              ))}
              {/* Draft row has no record id yet — nothing to open. */}
              <td className="border-r border-ink-line/70" />
              <td className="bg-transparent" />
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-faint">
        セルをクリックして編集、Enter で確定、Esc で取消。最下行に入力すると行が追加されます。
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
