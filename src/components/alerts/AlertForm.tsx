"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Input";
import { FIELD_TYPE_META, type FieldType } from "@/lib/field-types";
import { OPERATOR_OPTIONS } from "@/lib/alert-format";

export interface FormField {
  key: string;
  name: string;
  type: string;
}
export interface FormCollection {
  id: string;
  name: string;
  fields: FormField[];
}

type MeasureKind = "count" | "sum" | "avg";
type FilterOp = "eq" | "neq" | "gt" | "lt";

const FILTER_OPS: { value: FilterOp; label: string }[] = [
  { value: "eq", label: "＝" },
  { value: "neq", label: "≠" },
  { value: "gt", label: "＞" },
  { value: "lt", label: "＜" },
];

function isNumeric(type: string): boolean {
  return FIELD_TYPE_META[type as FieldType]?.numeric ?? false;
}

/**
 * Create-alert form. Builds a metric (measure + optional filter) over one
 * spreadsheet, lets the user preview the current value, then saves a rule.
 */
export function AlertForm({ collections }: { collections: FormCollection[] }) {
  const router = useRouter();

  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
  const [name, setName] = useState("");
  const [measureKind, setMeasureKind] = useState<MeasureKind>("count");
  const [measureField, setMeasureField] = useState("");
  const [filterOn, setFilterOn] = useState(false);
  const [filterField, setFilterField] = useState("");
  const [filterOp, setFilterOp] = useState<FilterOp>("eq");
  const [filterValue, setFilterValue] = useState("");
  const [operator, setOperator] = useState("gt");
  const [threshold, setThreshold] = useState("");
  const [channel, setChannel] = useState<"inapp" | "slack">("inapp");

  const [preview, setPreview] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const collection = useMemo(
    () => collections.find((c) => c.id === collectionId),
    [collections, collectionId],
  );
  const fields = collection?.fields ?? [];
  const numericFields = fields.filter((f) => isNumeric(f.type));

  function buildMetric() {
    const measure =
      measureKind === "count"
        ? { kind: "count" as const }
        : { kind: measureKind, field: measureField };

    const filters =
      filterOn && filterField
        ? [
            {
              field: filterField,
              op: filterOp,
              value:
                filterField && isNumeric(getFieldType(filterField))
                  ? Number(filterValue)
                  : filterValue,
            },
          ]
        : undefined;

    return { measure, filters };
  }

  function getFieldType(key: string): string {
    return fields.find((f) => f.key === key)?.type ?? "text";
  }

  function validateBeforeSubmit(): string | null {
    if (!collectionId) return "スプレッドシートを選択してください。";
    if (!name.trim()) return "アラート名を入力してください。";
    if (measureKind !== "count" && !measureField)
      return "集計する列を選択してください。";
    if (threshold.trim() === "" || Number.isNaN(Number(threshold)))
      return "しきい値を数値で入力してください。";
    return null;
  }

  async function runPreview() {
    setError(null);
    setPreview(null);
    if (measureKind !== "count" && !measureField) {
      setError("集計する列を選択してください。");
      return;
    }
    setPreviewing(true);
    try {
      const res = await fetch("/api/alerts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId, metric: buildMetric() }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "取得に失敗しました");
      setPreview(typeof json.data.value === "number" ? json.data.value : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "現在値の取得に失敗しました");
    } finally {
      setPreviewing(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const invalid = validateBeforeSubmit();
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          collectionId,
          metric: buildMetric(),
          operator,
          threshold: Number(threshold),
          channel,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "作成に失敗しました");
      // Reset the volatile bits, keep the chosen sheet for quick repeat setup.
      setName("");
      setThreshold("");
      setPreview(null);
      setFilterOn(false);
      setFilterField("");
      setFilterValue("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  if (collections.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        アラートを作るには、まずスプレッドシートを追加してください。
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="alert-name">名前</Label>
        <Input
          id="alert-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 未対応の問い合わせが増えたら"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="alert-collection">スプレッドシート</Label>
          <Select
            id="alert-collection"
            value={collectionId}
            onChange={(e) => {
              setCollectionId(e.target.value);
              setMeasureField("");
              setFilterField("");
              setPreview(null);
            }}
          >
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="alert-measure">指標</Label>
          <div className="flex gap-2">
            <Select
              id="alert-measure"
              value={measureKind}
              onChange={(e) => {
                setMeasureKind(e.target.value as MeasureKind);
                setPreview(null);
              }}
              className="flex-1"
            >
              <option value="count">件数</option>
              <option value="sum">合計</option>
              <option value="avg">平均</option>
            </Select>
            {measureKind !== "count" && (
              <Select
                aria-label="集計する列"
                value={measureField}
                onChange={(e) => {
                  setMeasureField(e.target.value);
                  setPreview(null);
                }}
                className="flex-1"
              >
                <option value="">列を選択</option>
                {numericFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          {measureKind !== "count" && numericFields.length === 0 && (
            <p className="mt-1 text-2xs text-ink-faint">
              このシートには数値の列がありません。
            </p>
          )}
        </div>
      </div>

      {/* Optional filter */}
      <div className="rounded-md border border-ink-line bg-paper-sunken/40 p-3">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={filterOn}
            onChange={(e) => {
              setFilterOn(e.target.checked);
              setPreview(null);
            }}
            className="h-4 w-4 accent-khaki-500"
          />
          絞り込み（特定の条件だけを数える）
        </label>
        {filterOn && (
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
            <Select
              aria-label="絞り込む列"
              value={filterField}
              onChange={(e) => {
                setFilterField(e.target.value);
                setPreview(null);
              }}
            >
              <option value="">列を選択</option>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="演算子"
              value={filterOp}
              onChange={(e) => {
                setFilterOp(e.target.value as FilterOp);
                setPreview(null);
              }}
              className="w-20"
            >
              {FILTER_OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Input
              aria-label="値"
              value={filterValue}
              onChange={(e) => {
                setFilterValue(e.target.value);
                setPreview(null);
              }}
              placeholder="値"
            />
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="alert-operator">演算子</Label>
          <Select
            id="alert-operator"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
          >
            {OPERATOR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="alert-threshold">しきい値</Label>
          <Input
            id="alert-threshold"
            type="number"
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="例: 10"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="alert-channel">通知先</Label>
        <Select
          id="alert-channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as "inapp" | "slack")}
        >
          <option value="inapp">アプリ内（ベルに通知）</option>
          <option value="slack">Slack</option>
        </Select>
      </div>

      {/* Preview */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-ink-line bg-paper-sunken/40 px-3 py-2.5">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={runPreview}
          disabled={previewing}
        >
          {previewing ? "確認中…" : "現在値を確認"}
        </Button>
        {preview !== null ? (
          <span className="text-sm text-ink">
            現在値:{" "}
            <span className="font-semibold tabular-nums text-khaki-700">
              {new Intl.NumberFormat("ja-JP").format(preview)}
            </span>
          </span>
        ) : (
          <span className="text-xs text-ink-muted">
            保存する前に、いまの値を確認できます。
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? "作成中…" : "アラートを作成"}
        </Button>
      </div>
    </form>
  );
}
