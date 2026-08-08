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
import { useEffect, useRef } from "react";
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
  position: number;
}

/* ------------------------------ read display ------------------------------ */

export function CellView({
  field,
  value,
}: {
  field: GridField;
  value: unknown;
}) {
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
    return value ? (
      <span className="text-success" aria-label="true">
        ✓
      </span>
    ) : null;
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
  onCommit: () => void;
  onCancel: () => void;
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

/** Enter commits, Escape cancels — the spreadsheet keyboard contract. */
function keyHandler(onCommit: () => void, onCancel: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
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
  inputType,
}: CellEditorProps & { inputType: string }) {
  return (
    <Input
      autoFocus
      type={inputType}
      className={EDITOR_INPUT}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={keyHandler(onCommit, onCancel)}
      onBlur={onCommit}
    />
  );
}

function NumberEditor({ value, onChange, onCommit, onCancel }: CellEditorProps) {
  return (
    <Input
      autoFocus
      type="text"
      inputMode="decimal"
      className={cn(EDITOR_INPUT, "text-right tabular-nums")}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={keyHandler(onCommit, onCancel)}
      onBlur={onCommit}
    />
  );
}

function LongTextEditor({
  value,
  onChange,
  onCommit,
  onCancel,
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
          onCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCommit}
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
          // Checkboxes commit instantly on toggle.
          queueMicrotask(onCommit);
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
}: CellEditorProps) {
  return (
    <Select
      autoFocus
      className={cn(EDITOR_INPUT, "pr-7")}
      value={value == null ? "" : String(value)}
      onChange={(e) => {
        onChange(e.target.value || null);
        queueMicrotask(onCommit);
      }}
      onKeyDown={keyHandler(onCommit, onCancel)}
      onBlur={onCommit}
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
          onCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
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
