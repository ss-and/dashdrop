"use client";

import { Select, Input, Label } from "@/components/ui/Input";
import {
  numericFields,
  groupableFields,
  dateFields,
  newWidget,
  type BuilderField,
} from "@/lib/widget-builder";
import type { WidgetSpec, Measure, Unit } from "@/lib/widgets";
import type { BuilderCollection } from "@/components/dashboard/DashboardBuilder";

/**
 * Inline per-widget configuration. Controls depend on `widget.type`; every edit
 * produces a spec that still matches the Zod schema in `@/lib/widgets`. Fields
 * offered come from the widget's bound sheet, filtered by the builder helpers.
 */

const MEASURE_KINDS: { value: Measure["kind"]; label: string }[] = [
  { value: "count", label: "件数" },
  { value: "sum", label: "合計" },
  { value: "avg", label: "平均" },
  { value: "min", label: "最小" },
  { value: "max", label: "最大" },
];

const UNITS: { value: Unit; label: string }[] = [
  { value: "number", label: "数値" },
  { value: "currency", label: "通貨（¥）" },
  { value: "percent", label: "パーセント" },
  { value: "days", label: "日数" },
];

const BUCKETS: { value: "day" | "week" | "month"; label: string }[] = [
  { value: "day", label: "日" },
  { value: "week", label: "週" },
  { value: "month", label: "月" },
];

/** Build a valid Measure from a kind + a field key (falling back to count). */
function buildMeasure(kind: Measure["kind"], field: string | undefined): Measure {
  if (kind === "count") return { kind: "count" };
  if (!field) return { kind: "count" };
  return { kind, field };
}

function fieldOf(m: Measure): string | undefined {
  return m.kind === "count" ? undefined : m.field;
}

interface Props {
  widget: WidgetSpec;
  /** Sheets currently in play (selected data sources). */
  sheets: BuilderCollection[];
  onChange: (next: WidgetSpec) => void;
}

export function WidgetConfig({ widget, sheets, onChange }: Props) {
  const sheet = sheets.find((s) => s.slug === widget.collection);
  const fields: BuilderField[] = sheet?.fields ?? [];
  const nums = numericFields(fields);
  const groups = groupableFields(fields);
  const dates = dateFields(fields);

  const idp = `cfg-${widget.id}`;

  /** Changing the bound sheet re-derives defaults so the spec stays valid. */
  function onSheetChange(slug: string) {
    const next = sheets.find((s) => s.slug === slug);
    const rebuilt = newWidget(widget.type, slug, next?.fields ?? []);
    // Preserve identity, span, and the user's title.
    onChange({ ...rebuilt, id: widget.id, span: widget.span, title: widget.title });
  }

  return (
    <div className="space-y-3 border-t border-ink-line pt-3">
      {/* Data source (only meaningful when >1 sheet is in play) */}
      {sheets.length > 1 && (
        <div>
          <Label htmlFor={`${idp}-sheet`}>データ元</Label>
          <Select
            id={`${idp}-sheet`}
            className="h-9"
            value={widget.collection}
            onChange={(e) => onSheetChange(e.target.value)}
          >
            {sheets.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* Title (all types) */}
      <div>
        <Label htmlFor={`${idp}-title`}>タイトル</Label>
        <Input
          id={`${idp}-title`}
          className="h-9"
          value={widget.title}
          onChange={(e) => onChange({ ...widget, title: e.target.value })}
        />
      </div>

      {widget.type === "kpi" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={`${idp}-agg`}>集計</Label>
            <Select
              id={`${idp}-agg`}
              className="h-9"
              value={widget.measure.kind}
              onChange={(e) =>
                onChange({
                  ...widget,
                  measure: buildMeasure(
                    e.target.value as Measure["kind"],
                    fieldOf(widget.measure) ?? nums[0]?.key,
                  ),
                })
              }
            >
              {MEASURE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </div>
          {widget.measure.kind !== "count" && (
            <div>
              <Label htmlFor={`${idp}-field`}>対象項目</Label>
              <Select
                id={`${idp}-field`}
                className="h-9"
                value={fieldOf(widget.measure) ?? ""}
                onChange={(e) =>
                  onChange({
                    ...widget,
                    measure: buildMeasure(widget.measure.kind, e.target.value),
                  })
                }
              >
                {nums.length === 0 && <option value="">数値項目なし</option>}
                {nums.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor={`${idp}-unit`}>単位</Label>
            <Select
              id={`${idp}-unit`}
              className="h-9"
              value={widget.unit ?? "number"}
              onChange={(e) =>
                onChange({ ...widget, unit: e.target.value as Unit })
              }
            >
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}

      {(widget.type === "bar" ||
        widget.type === "line" ||
        widget.type === "area") && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${idp}-date`}>日付項目</Label>
              <Select
                id={`${idp}-date`}
                className="h-9"
                value={widget.dateField ?? ""}
                onChange={(e) =>
                  onChange({
                    ...widget,
                    dateField: e.target.value || undefined,
                  })
                }
              >
                <option value="">作成日時</option>
                {dates.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${idp}-bucket`}>期間</Label>
              <Select
                id={`${idp}-bucket`}
                className="h-9"
                value={widget.bucket}
                onChange={(e) =>
                  onChange({
                    ...widget,
                    bucket: e.target.value as "day" | "week" | "month",
                  })
                }
              >
                {BUCKETS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${idp}-range`}>表示数</Label>
              <Input
                id={`${idp}-range`}
                type="number"
                min={2}
                max={60}
                className="h-9"
                value={widget.rangeCount}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (!Number.isFinite(n)) return;
                  onChange({
                    ...widget,
                    rangeCount: Math.min(60, Math.max(2, n)),
                  });
                }}
              />
            </div>
            <div>
              <Label htmlFor={`${idp}-magg`}>集計</Label>
              <Select
                id={`${idp}-magg`}
                className="h-9"
                value={widget.measures[0].measure.kind}
                onChange={(e) => {
                  const kind = e.target.value as Measure["kind"];
                  const m0 = widget.measures[0];
                  onChange({
                    ...widget,
                    measures: [
                      {
                        ...m0,
                        measure: buildMeasure(
                          kind,
                          fieldOf(m0.measure) ?? nums[0]?.key,
                        ),
                      },
                    ],
                  });
                }}
              >
                {MEASURE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${idp}-mlabel`}>系列ラベル</Label>
              <Input
                id={`${idp}-mlabel`}
                className="h-9"
                value={widget.measures[0].label}
                onChange={(e) =>
                  onChange({
                    ...widget,
                    measures: [
                      { ...widget.measures[0], label: e.target.value },
                    ],
                  })
                }
              />
            </div>
            {widget.measures[0].measure.kind !== "count" && (
              <div>
                <Label htmlFor={`${idp}-mfield`}>対象項目</Label>
                <Select
                  id={`${idp}-mfield`}
                  className="h-9"
                  value={fieldOf(widget.measures[0].measure) ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...widget,
                      measures: [
                        {
                          ...widget.measures[0],
                          measure: buildMeasure(
                            widget.measures[0].measure.kind,
                            e.target.value,
                          ),
                        },
                      ],
                    })
                  }
                >
                  {nums.length === 0 && <option value="">数値項目なし</option>}
                  {nums.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        </>
      )}

      {(widget.type === "donut" || widget.type === "hbar") && (
        <>
          <div>
            <Label htmlFor={`${idp}-group`}>分類項目</Label>
            <Select
              id={`${idp}-group`}
              className="h-9"
              value={widget.groupBy}
              onChange={(e) => onChange({ ...widget, groupBy: e.target.value })}
            >
              {groups.length === 0 && <option value="">分類できる項目なし</option>}
              {groups.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${idp}-bagg`}>集計</Label>
              <Select
                id={`${idp}-bagg`}
                className="h-9"
                value={widget.measure.kind}
                onChange={(e) =>
                  onChange({
                    ...widget,
                    measure: buildMeasure(
                      e.target.value as Measure["kind"],
                      fieldOf(widget.measure) ?? nums[0]?.key,
                    ),
                  })
                }
              >
                {MEASURE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </div>
            {widget.measure.kind !== "count" && (
              <div>
                <Label htmlFor={`${idp}-bfield`}>対象項目</Label>
                <Select
                  id={`${idp}-bfield`}
                  className="h-9"
                  value={fieldOf(widget.measure) ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...widget,
                      measure: buildMeasure(widget.measure.kind, e.target.value),
                    })
                  }
                >
                  {nums.length === 0 && <option value="">数値項目なし</option>}
                  {nums.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          <div>
            <Label htmlFor={`${idp}-limit`}>上位（件）</Label>
            <Input
              id={`${idp}-limit`}
              type="number"
              min={2}
              max={12}
              className="h-9"
              value={widget.limit}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (!Number.isFinite(n)) return;
                onChange({ ...widget, limit: Math.min(12, Math.max(2, n)) });
              }}
            />
          </div>
        </>
      )}

      {widget.type === "table" && (
        <>
          <div>
            <Label>列（1〜8）</Label>
            <div className="flex flex-wrap gap-1.5">
              {fields.map((f) => {
                const active = widget.columns.includes(f.key);
                const isLast = active && widget.columns.length <= 1;
                return (
                  <button
                    key={f.key}
                    type="button"
                    disabled={isLast || (!active && widget.columns.length >= 8)}
                    onClick={() => {
                      const cols = active
                        ? widget.columns.filter((c) => c !== f.key)
                        : [...widget.columns, f.key];
                      onChange({ ...widget, columns: cols });
                    }}
                    className={
                      "rounded border px-2 py-1 text-xs transition-colors disabled:opacity-40 " +
                      (active
                        ? "border-khaki-300 bg-khaki-50 text-khaki-700"
                        : "border-ink-line bg-paper-raised text-ink-soft hover:bg-paper-sunken")
                    }
                  >
                    {f.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label htmlFor={`${idp}-tlimit`}>表示行数</Label>
            <Input
              id={`${idp}-tlimit`}
              type="number"
              min={1}
              max={50}
              className="h-9"
              value={widget.limit}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (!Number.isFinite(n)) return;
                onChange({ ...widget, limit: Math.min(50, Math.max(1, n)) });
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
