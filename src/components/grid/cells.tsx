"use client";

/**
 * Per-field-type cell renderers for the spreadsheet grid.
 *
 * - CellView   : read-only display of a stored value (uses displayValue; select
 *                and multiselect render coloured Badges).
 * - CellEditor : a controlled inline editor keyed on FieldType. It never fetches
 *                — the DataGrid owns persistence; editors just surface a draft
 *                value and signal commit / cancel.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { Badge, toneFromColor } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import {
  displayValue,
  type FieldType,
  type SelectOption,
} from "@/lib/field-types";

/** The minimal field shape the grid needs on the client. */
export interface GridField {
  id: string;
  key: string;
  name: string;
  type: FieldType;
  required: boolean;
  options: SelectOption[] | null;
  /** relation/lookup/rollup config (see src/lib/relations.ts). */
  config: Record<string, unknown> | null;
  position: number;
}

/** Shape of a relation field's config, as read on the client. */
interface RelationFieldConfig {
  targetCollectionId?: string;
  displayFieldKey?: string;
  multiple?: boolean;
}

/* ------------------------------ read display ------------------------------ */

export function CellView({
  field,
  value,
  relationLabels,
}: {
  field: GridField;
  value: unknown;
  /** For relation cells: map of linked record id -> human label. */
  relationLabels?: Record<string, string>;
}) {
  // Links to records in another spreadsheet: one khaki chip per linked id.
  if (field.type === "relation") {
    const ids = Array.isArray(value) ? (value as string[]) : [];
    if (ids.length === 0) return <span className="text-ink-faint">—</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {ids.map((id) => (
          <Badge key={id} tone="khaki">
            {relationLabels?.[id] ?? id}
          </Badge>
        ))}
      </span>
    );
  }

  // Read-only pulled value from linked records. `value` is record.computed[key].
  if (field.type === "lookup") {
    const text = displayValue("lookup", value);
    return text ? (
      <span className="truncate">{text}</span>
    ) : (
      <span className="text-ink-faint">—</span>
    );
  }

  // Read-only aggregate across linked records. `value` is record.computed[key].
  if (field.type === "rollup") {
    const text = displayValue("rollup", value);
    return text ? (
      <span className="truncate tabular-nums">{text}</span>
    ) : (
      <span className="text-ink-faint">—</span>
    );
  }

  // Formula / sheet-join columns. Both are computed on read, so `value` is
  // record.computed[key]; a null means "not calculable" or "no match".
  if (field.type === "formula" || field.type === "vlookup") {
    const text = displayValue(field.type, value);
    const numeric = typeof value === "number";
    return text ? (
      <span className={numeric ? "truncate tabular-nums" : "truncate"}>
        {text}
      </span>
    ) : (
      <span className="text-ink-faint">—</span>
    );
  }

  if (field.type === "select") {
    if (value === null || value === undefined || value === "") return null;
    const opt = field.options?.find((o) => o.value === value);
    return (
      <Badge tone={toneFromColor(opt?.color)}>{opt?.label ?? String(value)}</Badge>
    );
  }

  if (field.type === "multiselect") {
    const arr = Array.isArray(value) ? value : [];
    if (arr.length === 0) return null;
    return (
      <span className="flex flex-wrap gap-1">
        {arr.map((v) => {
          const opt = field.options?.find((o) => o.value === v);
          return (
            <Badge key={String(v)} tone={toneFromColor(opt?.color)}>
              {opt?.label ?? String(v)}
            </Badge>
          );
        })}
      </span>
    );
  }

  if (field.type === "checkbox") {
    // A bare ✓ with aria-label="true" announced "true" to a screen reader, and
    // the false case announced nothing at all. Both states now read properly.
    return value ? (
      <span className="text-success" role="img" aria-label="はい">
        ✓
      </span>
    ) : (
      <span className="text-ink-faint" role="img" aria-label="いいえ">
        —
      </span>
    );
  }

  // Only turn a URL cell into a link when it is a safe http(s) URL. A value
  // stored as plain text before the field was switched to "url" could contain
  // a `javascript:`/`data:` scheme, which React won't block — so we render such
  // values as inert text instead of an anchor.
  if (field.type === "url" && value) {
    const s = String(value);
    if (/^https?:\/\//i.test(s)) {
      return (
        <a
          href={s}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="truncate text-khaki-700 underline decoration-khaki-300 underline-offset-2 hover:text-khaki-800"
        >
          {s}
        </a>
      );
    }
    return <span className="truncate">{s}</span>;
  }

  if (field.type === "email" && value) {
    const s = String(value);
    // Guard against scheme injection when a text field is retyped as email.
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      return (
        <a
          href={`mailto:${s}`}
          onClick={(e) => e.stopPropagation()}
          className="truncate text-khaki-700 hover:text-khaki-800"
        >
          {s}
        </a>
      );
    }
    return <span className="truncate">{s}</span>;
  }

  const text = displayValue(field.type, value);
  const numeric = field.type === "number" || field.type === "currency";
  return (
    <span className={cn("truncate", numeric && "tabular-nums")}>{text}</span>
  );
}

/* -------------------------------- editors --------------------------------- */

export interface CellEditorProps {
  field: GridField;
  value: unknown;
  onChange: (value: unknown) => void;
  /**
   * 編集値を確定する。
   *
   * `focusBack` はキーボードで閉じたときだけ true にする。入力欄が消えると
   * フォーカスが <body> に落ちるので、グリッド側で元のセルへ戻してもらう。
   * blur（クリックで他所へ移った）ときは、ユーザーが選んだ移動先を奪わない
   * よう付けない。
   */
  onCommit: (opts?: { focusBack?: boolean }) => void;
  onCancel: () => void;
  /** Tab / Shift+Tab：確定して隣のセルの編集へ移る。 */
  onMove?: (delta: 1 | -1) => void;
  /** For relation cells: map of linked record id -> human label (initial chips). */
  relationLabels?: Record<string, string>;
}

export function CellEditor(props: CellEditorProps) {
  const { field } = props;
  switch (field.type) {
    case "longtext":
      return <LongTextEditor {...props} />;
    case "number":
    case "currency":
      return <NumberEditor {...props} />;
    case "date":
      return <SimpleInputEditor {...props} inputType="date" />;
    case "checkbox":
      return <CheckboxEditor {...props} />;
    case "select":
      return <SelectEditor {...props} />;
    case "multiselect":
      return <MultiSelectEditor {...props} />;
    case "relation":
      return <RelationEditor {...props} />;
    case "email":
      return <SimpleInputEditor {...props} inputType="email" />;
    case "phone":
      return <SimpleInputEditor {...props} inputType="tel" />;
    case "url":
      return <SimpleInputEditor {...props} inputType="url" />;
    default:
      return <SimpleInputEditor {...props} inputType="text" />;
  }
}

/**
 * Enter で確定、Esc で取消、Tab で確定して隣のセルへ — 表計算の作法。
 * Tab は既定の動作（フォーカスがどこかへ飛ぶ）を止めて、グリッドに次の
 * セルを開いてもらう。onMove が無ければ確定だけして元のセルへ戻す。
 */
function keyHandler(
  onCommit: (opts?: { focusBack?: boolean }) => void,
  onCancel: () => void,
  onMove?: (delta: 1 | -1) => void,
) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit({ focusBack: true });
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (onMove) onMove(e.shiftKey ? -1 : 1);
      else onCommit({ focusBack: true });
    }
  };
}

const EDITOR_INPUT =
  "h-full w-full rounded-none border-0 bg-paper-raised px-2 py-1 text-sm text-ink " +
  "focus:ring-2 focus:ring-inset focus:ring-khaki-500/40 focus:outline-none";

function SimpleInputEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  onMove,
  inputType,
}: CellEditorProps & { inputType: string }) {
  return (
    <Input
      autoFocus
      type={inputType}
      className={EDITOR_INPUT}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={keyHandler(onCommit, onCancel, onMove)}
      onBlur={() => onCommit()}
    />
  );
}

function NumberEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  onMove,
}: CellEditorProps) {
  return (
    <Input
      autoFocus
      type="text"
      inputMode="decimal"
      className={cn(EDITOR_INPUT, "text-right tabular-nums")}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={keyHandler(onCommit, onCancel, onMove)}
      onBlur={() => onCommit()}
    />
  );
}

function LongTextEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  onMove,
}: CellEditorProps) {
  return (
    <Textarea
      autoFocus
      rows={3}
      className={cn(EDITOR_INPUT, "min-h-[72px] resize-none py-1.5")}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // Enter+Cmd/Ctrl commits; plain Enter inserts newlines.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onCommit({ focusBack: true });
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Tab") {
          e.preventDefault();
          if (onMove) onMove(e.shiftKey ? -1 : 1);
          else onCommit({ focusBack: true });
        }
      }}
      onBlur={() => onCommit()}
    />
  );
}

function CheckboxEditor({ value, onChange, onCommit }: CellEditorProps) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <input
        autoFocus
        type="checkbox"
        className="h-4 w-4 accent-khaki-500"
        checked={Boolean(value)}
        onChange={(e) => {
          onChange(e.target.checked);
          // Checkboxes commit instantly on toggle. チェックを付けた直後に
          // 入力欄が消えるので、フォーカスはセルへ戻す。
          queueMicrotask(() => onCommit({ focusBack: true }));
        }}
      />
    </div>
  );
}

function SelectEditor({
  field,
  value,
  onChange,
  onCommit,
  onCancel,
  onMove,
}: CellEditorProps) {
  return (
    <Select
      autoFocus
      className={cn(EDITOR_INPUT, "pr-7")}
      value={value == null ? "" : String(value)}
      onChange={(e) => {
        onChange(e.target.value || null);
        queueMicrotask(() => onCommit({ focusBack: true }));
      }}
      onKeyDown={keyHandler(onCommit, onCancel, onMove)}
      onBlur={() => onCommit()}
    >
      <option value="">—</option>
      {field.options?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

function MultiSelectEditor({
  field,
  value,
  onChange,
  onCommit,
  onCancel,
  onMove,
}: CellEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const selected: string[] = Array.isArray(value) ? (value as string[]) : [];

  // Focus the container on mount so a click-away triggers commit via blur.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  function toggle(v: string) {
    const next = selected.includes(v)
      ? selected.filter((x) => x !== v)
      : [...selected, v];
    onChange(next);
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="flex h-full min-h-[32px] flex-wrap items-center gap-1 bg-paper-raised px-1.5 py-1 outline-none ring-2 ring-inset ring-khaki-500/40"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit({ focusBack: true });
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Tab") {
          e.preventDefault();
          if (onMove) onMove(e.shiftKey ? -1 : 1);
          else onCommit({ focusBack: true });
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onCommit();
      }}
    >
      {field.options?.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={cn(
              "rounded-sm border px-2 py-0.5 text-xs font-medium transition-colors",
              on
                ? "border-khaki-400 bg-khaki-100 text-khaki-800"
                : "border-ink-line bg-paper text-ink-muted hover:bg-paper-sunken",
            )}
          >
            {o.label}
          </button>
        );
      })}
      {(!field.options || field.options.length === 0) && (
        <span className="text-xs text-ink-faint">選択肢がありません</span>
      )}
    </div>
  );
}

/* ------------------------------ relation picker --------------------------- */

interface LinkOption {
  id: string;
  label: string;
}

/**
 * Modal link picker for a relation cell. Fetches candidate records from the
 * target spreadsheet (with server-side search), lets the user pick one
 * (single) or many (multiple), shows the current selection as removable chips,
 * and commits the chosen id array through the grid's normal record-PATCH path.
 */
function RelationEditor({
  field,
  value,
  onChange,
  onCommit,
  onCancel,
  relationLabels,
}: CellEditorProps) {
  const cfg = (field.config ?? {}) as RelationFieldConfig;
  const multiple = cfg.multiple === true;

  const [selected, setSelected] = useState<string[]>(
    Array.isArray(value) ? (value as string[]) : [],
  );
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<LinkOption[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({
    ...(relationLabels ?? {}),
  });
  const [collectionName, setCollectionName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch (debounced) candidate options as the search query changes.
  useEffect(() => {
    if (!cfg.targetCollectionId) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/collections/${cfg.targetCollectionId}/link-options?q=${encodeURIComponent(q)}`,
        );
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json.ok) {
          const opts: LinkOption[] = json.data.options ?? [];
          setOptions(opts);
          setCollectionName(json.data.collectionName ?? "");
          setLabels((m) => {
            const next = { ...m };
            for (const o of opts) next[o.id] = o.label;
            return next;
          });
        } else {
          setError(json.error ?? "リンク候補を取得できませんでした");
        }
      } catch {
        if (!cancelled) setError("通信エラーが発生しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, cfg.targetCollectionId]);

  function commitWith(ids: string[]) {
    onChange(ids);
    // モーダルが閉じるとフォーカスの行き先が無くなるので、セルへ戻す。
    onCommit({ focusBack: true });
  }

  function choose(id: string) {
    if (multiple) {
      setSelected((s) =>
        s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
      );
    } else {
      // Single-select: choosing one replaces and commits immediately.
      commitWith([id]);
    }
  }

  const missingTarget = !cfg.targetCollectionId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col animate-fade-in rounded-md border border-ink-line bg-paper-raised shadow-raised"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      >
        <div className="border-b border-ink-line px-5 py-3">
          <h3 className="text-base font-semibold text-ink">
            リンクを選択{collectionName ? `：${collectionName}` : ""}
          </h3>
          <p className="mt-0.5 text-xs text-ink-faint">
            {multiple
              ? "複数のレコードを選べます。"
              : "1件のレコードを選択します。"}
          </p>
        </div>

        {missingTarget ? (
          <div className="px-5 py-6 text-sm text-ink-muted">
            リンク先が未設定です。列の設定から選んでください。
          </div>
        ) : (
          <>
            <div className="space-y-2 px-5 py-3">
              <Input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="検索…"
              />
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selected.map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-sm border border-khaki-200 bg-khaki-100 px-2 py-0.5 text-xs font-medium text-khaki-800"
                    >
                      {labels[id] ?? id}
                      <button
                        type="button"
                        onClick={() =>
                          setSelected((s) => s.filter((x) => x !== id))
                        }
                        className="text-khaki-600 hover:text-khaki-800"
                        aria-label="リンクを外す"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto border-t border-ink-line">
              {loading && (
                <p className="px-5 py-3 text-sm text-ink-faint">読み込み中…</p>
              )}
              {!loading && options.length === 0 && (
                <p className="px-5 py-3 text-sm text-ink-faint">
                  候補が見つかりません。
                </p>
              )}
              {options.map((o) => {
                const on = selected.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => choose(o.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-5 py-2 text-left text-sm hover:bg-khaki-50",
                      on ? "bg-khaki-50/70 text-ink" : "text-ink-soft",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                        on
                          ? "border-khaki-500 bg-khaki-500 text-white"
                          : "border-ink-line bg-paper",
                        !multiple && "rounded-full",
                      )}
                    >
                      {on && <CheckMark />}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </button>
                );
              })}
            </div>

            {error && (
              <p className="px-5 pt-2 text-sm text-danger">{error}</p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-ink-line px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            キャンセル
          </Button>
          {!missingTarget && (
            <Button size="sm" onClick={() => commitWith(selected)}>
              確定
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CheckMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
