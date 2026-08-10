"use client";

/**
 * Add / edit a Field. Small centred modal: name, type, required, and — for
 * select / multiselect — an editable option list (label / value / colour).
 * Persists via POST (new) or PATCH (existing) to the fields endpoints.
 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Input";
import { cn, toFieldKey } from "@/lib/utils";
import {
  FIELD_TYPE_META,
  FIELD_TYPES,
  type FieldType,
  type SelectOption,
} from "@/lib/field-types";
import type { GridField } from "./cells";
import type { WorkspaceCollection } from "./DataGrid";

const ROLLUP_OPS: Array<{ value: string; label: string }> = [
  { value: "sum", label: "合計" },
  { value: "count", label: "件数" },
  { value: "avg", label: "平均" },
  { value: "min", label: "最小" },
  { value: "max", label: "最大" },
];

const OPTION_TONES = ["khaki", "success", "warning", "danger", "info"] as const;

const TONE_SWATCH: Record<string, string> = {
  khaki: "bg-khaki-300",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

interface OptionRow extends SelectOption {
  color: string;
}

export function FieldEditor({
  collectionId,
  field,
  collectionFields,
  workspaceCollections,
  onClose,
  onSaved,
}: {
  collectionId: string;
  field?: GridField;
  /** This collection's current fields — used to list relation fields for
   *  lookup/rollup "via" selectors. */
  collectionFields: GridField[];
  /** Other spreadsheets in the workspace — used to pick relation targets. */
  workspaceCollections: WorkspaceCollection[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(field);
  const cfg = (field?.config ?? {}) as Record<string, unknown>;
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<FieldType>(field?.type ?? "text");
  const [required, setRequired] = useState(field?.required ?? false);
  const [options, setOptions] = useState<OptionRow[]>(
    (field?.options ?? []).map((o) => ({
      label: o.label,
      value: o.value,
      color: o.color ?? "khaki",
    })),
  );

  // relation / lookup / rollup config.
  const [targetCollectionId, setTargetCollectionId] = useState<string>(
    String(cfg.targetCollectionId ?? ""),
  );
  const [displayFieldKey, setDisplayFieldKey] = useState<string>(
    String(cfg.displayFieldKey ?? ""),
  );
  const [multiple, setMultiple] = useState<boolean>(cfg.multiple === true);
  const [via, setVia] = useState<string>(String(cfg.via ?? ""));
  const [targetKey, setTargetKey] = useState<string>(String(cfg.target ?? ""));
  const [op, setOp] = useState<string>(String(cfg.op ?? "sum"));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optioned = FIELD_TYPE_META[type].optioned;

  // Spreadsheets we can link to (never the current one).
  const linkableCollections = workspaceCollections.filter(
    (c) => c.id !== collectionId,
  );
  // Relation fields on THIS collection — the "via" for lookup/rollup.
  const relationFields = collectionFields.filter((f) => f.type === "relation");

  // Fields of the currently chosen relation target (for the display column).
  const relationTarget = workspaceCollections.find(
    (c) => c.id === targetCollectionId,
  );
  const displayFieldOptions = (relationTarget?.fields ?? []).filter(
    (f) => f.type !== "lookup" && f.type !== "rollup",
  );

  // For lookup/rollup: resolve the target collection via the chosen relation.
  const selectedVia = relationFields.find((f) => f.key === via);
  const viaCfg = (selectedVia?.config ?? {}) as { targetCollectionId?: string };
  const viaTarget = workspaceCollections.find(
    (c) => c.id === viaCfg.targetCollectionId,
  );
  const viaTargetFieldOptions = (viaTarget?.fields ?? []).filter(
    (f) => f.type !== "lookup" && f.type !== "rollup",
  );

  function addOption() {
    setOptions((o) => [...o, { label: "", value: "", color: "khaki" }]);
  }
  function updateOption(i: number, patch: Partial<OptionRow>) {
    setOptions((o) => o.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function removeOption(i: number) {
    setOptions((o) => o.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (!name.trim()) {
      setError("項目名を入力してください");
      return;
    }
    setSaving(true);
    setError(null);

    // Normalise option values (fall back to a machine key from the label).
    const cleanOptions: SelectOption[] | undefined = optioned
      ? options
          .filter((o) => o.label.trim())
          .map((o) => ({
            label: o.label.trim(),
            value: o.value.trim() || toFieldKey(o.label),
            color: o.color,
          }))
      : undefined;

    // Config for cross-spreadsheet types. The server validates and returns a
    // clear Japanese error when something is missing/invalid.
    let config: Record<string, unknown> | undefined;
    if (type === "relation") {
      config = {
        targetCollectionId,
        displayFieldKey: displayFieldKey || undefined,
        multiple,
      };
    } else if (type === "lookup") {
      config = { via, target: targetKey };
    } else if (type === "rollup") {
      config = { via, target: targetKey, op };
    }

    const body = {
      name: name.trim(),
      type,
      required,
      ...(cleanOptions ? { options: cleanOptions } : {}),
      ...(config ? { config } : {}),
    };

    const url = editing
      ? `/api/collections/${collectionId}/fields/${field!.id}`
      : `/api/collections/${collectionId}/fields`;

    try {
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "保存に失敗しました");
        setSaving(false);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("通信エラーが発生しました");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md animate-fade-in rounded-md border border-ink-line bg-paper-raised shadow-raised">
        <div className="border-b border-ink-line px-5 py-4">
          <h3 className="text-base font-semibold text-ink">
            {editing ? "項目を編集" : "項目を追加"}
          </h3>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <Label htmlFor="field-name">項目名</Label>
            <Input
              id="field-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：顧客名"
            />
          </div>

          <div>
            <Label htmlFor="field-type">種類</Label>
            <Select
              id="field-type"
              value={type}
              onChange={(e) => setType(e.target.value as FieldType)}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_META[t].label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-ink-faint">
              {FIELD_TYPE_META[type].description}
            </p>
          </div>

          {type === "relation" && (
            <div className="space-y-3 rounded-sm border border-ink-line bg-paper-sunken/40 p-3">
              <div>
                <Label htmlFor="rel-target">リンク先スプレッドシート</Label>
                <Select
                  id="rel-target"
                  value={targetCollectionId}
                  onChange={(e) => {
                    setTargetCollectionId(e.target.value);
                    setDisplayFieldKey("");
                  }}
                >
                  <option value="">選択してください</option>
                  {linkableCollections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                {linkableCollections.length === 0 && (
                  <p className="mt-1 text-xs text-warning">
                    リンクできる他のスプレッドシートがまだありません。
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="rel-display">表示する列</Label>
                <Select
                  id="rel-display"
                  value={displayFieldKey}
                  onChange={(e) => setDisplayFieldKey(e.target.value)}
                  disabled={!targetCollectionId}
                >
                  <option value="">自動（先頭のテキスト列）</option>
                  {displayFieldOptions.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-khaki-500"
                  checked={multiple}
                  onChange={(e) => setMultiple(e.target.checked)}
                />
                複数リンクを許可
              </label>
            </div>
          )}

          {(type === "lookup" || type === "rollup") && (
            <div className="space-y-3 rounded-sm border border-ink-line bg-paper-sunken/40 p-3">
              <div>
                <Label htmlFor="lr-via">
                  {type === "lookup" ? "参照するリンク列" : "リンク列"}
                </Label>
                <Select
                  id="lr-via"
                  value={via}
                  onChange={(e) => {
                    setVia(e.target.value);
                    setTargetKey("");
                  }}
                >
                  <option value="">選択してください</option>
                  {relationFields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </Select>
                {relationFields.length === 0 && (
                  <p className="mt-1 text-xs text-warning">
                    先に「リンク（他シート参照）」の列を作成してください。
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="lr-target">
                  {type === "lookup" ? "取得する項目" : "集計する項目"}
                </Label>
                <Select
                  id="lr-target"
                  value={targetKey}
                  onChange={(e) => setTargetKey(e.target.value)}
                  disabled={!via}
                >
                  <option value="">選択してください</option>
                  {viaTargetFieldOptions.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>
              {type === "rollup" && (
                <div>
                  <Label htmlFor="lr-op">集計方法</Label>
                  <Select
                    id="lr-op"
                    value={op}
                    onChange={(e) => setOp(e.target.value)}
                  >
                    {ROLLUP_OPS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              className="h-4 w-4 accent-khaki-500"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />
            必須項目にする
          </label>

          {optioned && (
            <div className="space-y-2">
              <Label>選択肢</Label>
              <div className="space-y-2">
                {options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <ColorPicker
                      value={o.color}
                      onChange={(color) => updateOption(i, { color })}
                    />
                    <Input
                      className="flex-1"
                      value={o.label}
                      onChange={(e) => updateOption(i, { label: e.target.value })}
                      placeholder="表示名"
                    />
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      className="shrink-0 rounded p-1.5 text-ink-faint hover:bg-paper-sunken hover:text-danger"
                      aria-label="選択肢を削除"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={addOption}>
                + 選択肢を追加
              </Button>
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-line px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {OPTION_TONES.map((tone) => (
        <button
          key={tone}
          type="button"
          onClick={() => onChange(tone)}
          aria-label={tone}
          className={cn(
            "h-5 w-5 rounded-sm border transition-transform",
            TONE_SWATCH[tone],
            value === tone
              ? "border-ink scale-110"
              : "border-transparent opacity-60 hover:opacity-100",
          )}
        />
      ))}
    </div>
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
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
