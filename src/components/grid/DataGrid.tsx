"use client";

/**
 * Spreadsheet-style editable grid — the primary way users work with a
 * Collection's rows. No external grid library: a plain <table> plus React
 * state, with inline per-type cell editors, optimistic writes, error rollback,
 * a subtle saving indicator, and column-header actions (add / edit / delete a
 * field). Persistence goes through the records + fields API routes.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  FIELD_TYPE_META,
  type SelectOption,
} from "@/lib/field-types";
import { CellView, CellEditor, type GridField } from "./cells";
import { FieldEditor } from "./FieldEditor";

interface GridRecord {
  id: string;
  data: Record<string, unknown>;
}

interface RawField {
  id: string;
  key: string;
  name: string;
  // Prisma stores field.type as a plain string; narrowed to FieldType below.
  type: string;
  required: boolean;
  options: unknown;
  position: number;
}

interface RawRecord {
  id: string;
  data: unknown;
}

const DRAFT_ID = "__draft__";

function toGridField(f: RawField): GridField {
  return {
    id: f.id,
    key: f.key,
    name: f.name,
    type: f.type as GridField["type"],
    required: f.required,
    options: (f.options as SelectOption[] | null) ?? null,
    position: f.position,
  };
}

export function DataGrid({
  collection,
  fields: initialFields,
  initialRecords,
}: {
  collection: { id: string; template: string };
  fields: RawField[];
  initialRecords: RawRecord[];
}) {
  const [fields, setFields] = useState<GridField[]>(() =>
    initialFields.map(toGridField),
  );
  const [records, setRecords] = useState<GridRecord[]>(() =>
    initialRecords.map((r) => ({
      id: r.id,
      data: (r.data as Record<string, unknown>) ?? {},
    })),
  );
  const [draft, setDraft] = useState<Record<string, unknown>>({});

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

  /** Commit the active editor: PATCH an existing row or POST the draft row. */
  const commitEdit = useCallback(async () => {
    if (!editing) return;
    const { rowId, key } = editing;
    const value = editValueRef.current;
    setEditing(null);

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
            { id: json.data.id, data: json.data.data ?? {} },
            ...rs,
          ]);
          setDraft({}); // reset the trailing new-row for the next entry
          setError(null);
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
  }, [editing, draft, records, collection.id, bump]);

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

  const isEditing = (rowId: string, key: string) =>
    editing?.rowId === rowId && editing.key === key;

  function renderCell(rowId: string, field: GridField, value: unknown) {
    if (isEditing(rowId, field.key)) {
      return (
        <CellEditor
          field={field}
          value={editValue}
          onChange={setDraftValue}
          onCommit={commitEdit}
          onCancel={cancelEdit}
        />
      );
    }
    return (
      <button
        type="button"
        onClick={() => startEdit(rowId, field.key, value)}
        className="flex h-full min-h-[34px] w-full items-center px-2 py-1 text-left text-sm text-ink hover:bg-khaki-50/60 focus:bg-khaki-50 focus:outline-none"
      >
        <CellView field={field} value={value} />
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
            onClose={() => setFieldModal(null)}
            onSaved={refetchFields}
          />
        )}
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">{records.length} 件</p>
        <div className="flex items-center gap-3">
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

      <div className="overflow-x-auto rounded-md border border-ink-line shadow-card">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-paper-sunken">
              <th className="w-10 border-b border-r border-ink-line px-2 py-2 text-2xs font-medium text-ink-faint">
                #
              </th>
              {columns.map((field) => (
                <th
                  key={field.id}
                  className="min-w-[160px] border-b border-r border-ink-line px-2 py-1.5 text-left align-top"
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 truncate font-semibold text-ink">
                        {field.name}
                        {field.required && (
                          <span className="text-danger" title="必須">
                            *
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-2xs uppercase tracking-wide text-ink-faint">
                        {FIELD_TYPE_META[field.type].label}
                      </div>
                    </div>
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
            {records.map((rec, i) => (
              <tr
                key={rec.id}
                className="group border-b border-ink-line/70 odd:bg-paper-raised even:bg-paper"
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
                    {renderCell(rec.id, field, rec.data[field.key])}
                  </td>
                ))}
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
                  {renderCell(DRAFT_ID, field, draft[field.key])}
                </td>
              ))}
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
          onClose={() => setFieldModal(null)}
          onSaved={refetchFields}
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
