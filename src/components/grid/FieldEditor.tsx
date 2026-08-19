"use client";

/**
 * Add / edit a Field. Small centred modal: name, type, required, and — for
 * select / multiselect — an editable option list (label / value / colour).
 * Persists via POST (new) or PATCH (existing) to the fields endpoints.
 *
 * 表示上はダイアログなので、実装もダイアログにする（role / aria-modal / 見出しの
 * 紐付け・フォーカスの出入り・Escape）。詳しくは下の FOCUSABLE_SELECTOR と
 * useEffect のコメントを参照。
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Input";
import { cn, toFieldKey } from "@/lib/utils";
import {
  FIELD_TYPE_META,
  FIELD_TYPES,
  isComputedField,
  type FieldType,
  type SelectOption,
} from "@/lib/field-types";
import {
  VLOOKUP_AGGREGATES,
  VLOOKUP_AGGREGATE_LABELS,
  type VlookupAggregate,
} from "@/lib/vlookup";
import { validateFormula, FORMULA_FUNCTIONS } from "@/lib/formula";
import type { GridField } from "./cells";
import type { WorkspaceCollection } from "./DataGrid";

const ROLLUP_OPS: Array<{ value: string; label: string }> = [
  { value: "sum", label: "合計" },
  { value: "count", label: "件数" },
  { value: "avg", label: "平均" },
  { value: "min", label: "最小" },
  { value: "max", label: "最大" },
];

/** Japanese labels for types whose registry label is still English. */
const TYPE_LABEL_JA: Partial<Record<FieldType, string>> = {
  vlookup: "別シートから引く（VLOOKUP）",
  formula: "計算式",
};
const TYPE_DESCRIPTION_JA: Partial<Record<FieldType, string>> = {
  vlookup: "別シートを共通の列で突き合わせて、値を引いてきます（自動計算）",
  formula: "他の項目から計算します（粗利＝売上−原価 など）",
};
function typeLabel(t: FieldType): string {
  return TYPE_LABEL_JA[t] ?? FIELD_TYPE_META[t].label;
}
function typeDescription(t: FieldType): string {
  return TYPE_DESCRIPTION_JA[t] ?? FIELD_TYPE_META[t].description;
}

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

/**
 * ダイアログ内でフォーカスを受け取れる要素。フォーカストラップの端（先頭・末尾）を
 * 求めるためだけに使う。`tabindex="-1"`（プログラムからのみフォーカスする要素、
 * ダイアログ本体など）はタブ順に含めない。
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** root の中のフォーカス可能な要素を DOM 順（＝タブ順）で返す。 */
function focusableIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true",
  );
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

  // formula (計算式) config
  const [expression, setExpression] = useState<string>(
    () => ((field?.config ?? {}) as { expression?: string }).expression ?? "",
  );

  // Live formula validation against this sheet's other (non-computed) keys.
  const insertableKeys = collectionFields.filter(
    (f) => f.key !== field?.key && !isComputedField(f.type),
  );
  const formulaCheck =
    type === "formula" && expression.trim() !== ""
      ? validateFormula(
          expression,
          collectionFields.filter((f) => f.key !== field?.key).map((f) => f.key),
        )
      : null;

  // vlookup (シート結合) config — target sheet reuses `targetCollectionId`.
  const [localKey, setLocalKey] = useState<string>(String(cfg.localKey ?? ""));
  const [vTargetKey, setVTargetKey] = useState<string>(String(cfg.targetKey ?? ""));
  const [vTargetField, setVTargetField] = useState<string>(
    String(cfg.targetField ?? ""),
  );
  const [aggregate, setAggregate] = useState<VlookupAggregate>(
    (VLOOKUP_AGGREGATES as readonly string[]).includes(String(cfg.aggregate))
      ? (cfg.aggregate as VlookupAggregate)
      : "first",
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // 回帰: 見た目はモーダルなのに、role も aria-modal もフォーカス管理も無く、
  // 閉じる手段は背景のクリックだけだった。そのため支援技術には「ダイアログが
  // 開いた」ことが伝わらず、タブ移動は背後のグリッドへ抜け、キーボードだけでは
  // 閉じられなかった。ここで開いた瞬間に中へフォーカスを移し、閉じたときは
  // 開いたボタンへ戻す（戻さないとフォーカスが body に落ち、利用者は表のどこに
  // いたのか分からなくなる）。
  useEffect(() => {
    // 呼び出し元（「＋項目を追加」ボタンなど）を控えてから中へ移す。入力欄の
    // autoFocus に任せるとこの時点の activeElement が入力欄になってしまうので、
    // フォーカスの初期移動もここで行う。
    const opener = document.activeElement as HTMLElement | null;
    const first = focusableIn(panelRef.current)[0] ?? panelRef.current;
    first?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  // Escape で閉じる／開いている間はタブ順をダイアログ内に閉じ込める。
  const onDialogKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        // 保存中は「キャンセル」ボタンも無効なので、Escape も同じ扱いにする。
        if (saving) return;
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusableIn(panelRef.current);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey ? active === first : active === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    },
    [onClose, saving],
  );

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
  // 表示に使えるのは「値が保存されている列」だけ。自動計算の列（計算式・
  // VLOOKUP など）を表示列に選ぶと、チップのラベルは保存済みデータから引かれる
  // ため常に「（無題）」になってしまう。
  // 回帰: ここが lookup / rollup の決め打ちだったせいで、あとから増えた計算列
  // （formula・vlookup）がすり抜けていた。判定は必ず isComputedField に寄せる。
  const displayFieldOptions = (relationTarget?.fields ?? []).filter(
    (f) => !isComputedField(f.type),
  );

  // For lookup/rollup: resolve the target collection via the chosen relation.
  const selectedVia = relationFields.find((f) => f.key === via);
  const viaCfg = (selectedVia?.config ?? {}) as { targetCollectionId?: string };
  const viaTarget = workspaceCollections.find(
    (c) => c.id === viaCfg.targetCollectionId,
  );
  // ルックアップ／ロールアップが読むのはリンク先の「保存済みの値」だけ。計算列を
  // 指すと解決時に何も見つからず、保存は成功するのに列が永久に空のままになる。
  // 上と同じ理由で、ここも lookup / rollup の決め打ちから isComputedField へ。
  const viaTargetFieldOptions = (viaTarget?.fields ?? []).filter(
    (f) => !isComputedField(f.type),
  );

  // vlookup: key/value columns must hold real data — a computed column can be
  // neither the key nor the pulled value (the server rejects it too).
  const localKeyOptions = collectionFields.filter(
    (f) => !isComputedField(f.type) && f.key !== field?.key,
  );
  const vlookupTargetFieldOptions = (relationTarget?.fields ?? []).filter(
    (f) => !isComputedField(f.type),
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
    } else if (type === "formula") {
      config = { expression };
    } else if (type === "vlookup") {
      config = {
        targetCollectionId,
        localKey,
        targetKey: vTargetKey,
        targetField: vTargetField,
        aggregate,
      };
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
      onKeyDown={onDialogKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-md animate-fade-in rounded-md border border-ink-line bg-paper-raised shadow-raised focus:outline-none"
      >
        <div className="border-b border-ink-line px-5 py-4">
          <h3 id={titleId} className="text-base font-semibold text-ink">
            {editing ? "項目を編集" : "項目を追加"}
          </h3>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <Label htmlFor="field-name">項目名</Label>
            <Input
              id="field-name"
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
                  {typeLabel(t)}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-ink-faint">
              {typeDescription(type)}
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

          {type === "formula" && (
            <div className="space-y-2 rounded-sm border border-ink-line bg-paper-sunken/40 p-3">
              <p className="text-xs text-ink-muted">
                他の項目を <code className="rounded bg-paper px-1">{"{項目キー}"}</code>{" "}
                で参照します。例：
                <code className="ml-1 rounded bg-paper px-1">
                  {"{sales} - {cost}"}
                </code>
              </p>

              <div>
                <Label htmlFor="fe-expression">計算式</Label>
                <textarea
                  id="fe-expression"
                  value={expression}
                  onChange={(e) => setExpression(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  className="input-base py-2 font-mono text-xs"
                  placeholder="{sales} - {cost}"
                />
              </div>

              {/* Live validation: a bad formula should never reach the server. */}
              {expression.trim() !== "" && formulaCheck && !formulaCheck.ok && (
                <p className="text-xs text-danger" role="alert">
                  {formulaCheck.error}
                </p>
              )}
              {expression.trim() !== "" && formulaCheck?.ok && (
                <p className="text-xs text-success">
                  式は正しく解釈できます
                  {formulaCheck.refs.length > 0 &&
                    `（参照: ${formulaCheck.refs.join(", ")}）`}
                </p>
              )}

              {/* Click a field to insert its key — beats memorising them. */}
              {insertableKeys.length > 0 && (
                <div>
                  <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                    項目を挿入
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {insertableKeys.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() =>
                          setExpression((v) => `${v}${v && !v.endsWith(" ") ? " " : ""}{${f.key}}`)
                        }
                        className="rounded border border-ink-line bg-paper-raised px-2 py-1 text-2xs text-ink-soft transition-colors hover:bg-paper-sunken"
                        title={f.key}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer text-khaki-700">
                  使える関数（{FORMULA_FUNCTIONS.length}）
                </summary>
                <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto">
                  {FORMULA_FUNCTIONS.map((fn) => (
                    <li key={fn.name} className="text-ink-muted">
                      <code className="text-ink-soft">
                        {fn.name}({fn.args})
                      </code>{" "}
                      — {fn.description}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          {type === "vlookup" && (
            <div className="space-y-3 rounded-sm border border-ink-line bg-paper-sunken/40 p-3">
              <div>
                <Label htmlFor="vl-target">参照するシート</Label>
                <Select
                  id="vl-target"
                  value={targetCollectionId}
                  onChange={(e) => {
                    setTargetCollectionId(e.target.value);
                    setVTargetKey("");
                    setVTargetField("");
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
                    突き合わせできる他のシートがまだありません。先にもう1つシートを取り込んでください。
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="vl-local-key">このシートのキー項目</Label>
                <Select
                  id="vl-local-key"
                  value={localKey}
                  onChange={(e) => setLocalKey(e.target.value)}
                >
                  <option value="">選択してください</option>
                  {localKeyOptions.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="vl-target-key">参照先のキー項目</Label>
                <Select
                  id="vl-target-key"
                  value={vTargetKey}
                  onChange={(e) => setVTargetKey(e.target.value)}
                  disabled={!targetCollectionId}
                >
                  <option value="">選択してください</option>
                  {vlookupTargetFieldOptions.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="vl-target-field">取得する項目</Label>
                <Select
                  id="vl-target-field"
                  value={vTargetField}
                  onChange={(e) => setVTargetField(e.target.value)}
                  disabled={!targetCollectionId}
                >
                  <option value="">選択してください</option>
                  {vlookupTargetFieldOptions.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="vl-aggregate">複数一致したとき</Label>
                <Select
                  id="vl-aggregate"
                  value={aggregate}
                  onChange={(e) => setAggregate(e.target.value as VlookupAggregate)}
                  disabled={!targetCollectionId}
                >
                  {VLOOKUP_AGGREGATES.map((a) => (
                    <option key={a} value={a}>
                      {VLOOKUP_AGGREGATE_LABELS[a]}
                    </option>
                  ))}
                </Select>
              </div>

              <p className="text-xs text-ink-faint">
                別のシートを、共通する列で突き合わせて値を引きます（ExcelのVLOOKUP）。
              </p>
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
