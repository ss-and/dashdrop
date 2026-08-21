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
    /*
     * 見た目を決める指定は、データ元を替えても引き継ぐ。
     *
     * `newWidget` は種類ごとの既定を作り直すので、そのまま差し替えると
     * 「100%積み上げ」で作った棒がただの棒に戻り、バブルの大きさが消える。
     * 利用者はデータ元を替えただけのつもりなので、勝手に図が変わると混乱する。
     * 参照している列は替わった先には無いかもしれないので、列そのものではなく
     * **表示の指定**だけを引き継ぐ。
     */
    const keep: Partial<WidgetSpec> = {};
    if ("stackMode" in widget && widget.stackMode) {
      (keep as { stackMode?: unknown }).stackMode = widget.stackMode;
      (keep as { stacked?: unknown }).stacked = true;
    }
    // Preserve identity, span, and the user's title.
    onChange({
      ...rebuilt,
      ...keep,
      id: widget.id,
      span: widget.span,
      title: widget.title,
    } as WidgetSpec);
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
        widget.type === "area" ||
        widget.type === "combo") && (
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
                      ...widget.measures.slice(1),
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
                      ...widget.measures.slice(1),
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
                        ...widget.measures.slice(1),
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
          <div>
            <Label htmlFor={`${idp}-split`}>区分で分ける（色）</Label>
            <Select
              id={`${idp}-split`}
              className="h-9"
              value={widget.splitBy ?? ""}
              onChange={(e) =>
                onChange({ ...widget, splitBy: e.target.value || undefined })
              }
            >
              <option value="">分けない（合計だけ）</option>
              {groups.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
            {widget.splitBy && (
              <p className="mt-1 text-2xs text-ink-muted">
                上位5つを積み上げ、残りは「その他」にまとめます
              </p>
            )}
          </div>
          {/*
            100% 表示は積み上がっているときだけ出す。1本しかない棒を
            100% に伸ばしても、常に全部が1色になるだけで意味がない。
          */}
          {(widget.stacked || widget.splitBy) && widget.type !== "combo" && (
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={widget.stackMode === "percent"}
                onChange={(e) =>
                  onChange({
                    ...widget,
                    stacked: true,
                    stackMode: e.target.checked ? "percent" : undefined,
                  })
                }
                className="h-4 w-4 rounded border-ink-rule"
              />
              100%表示にする（実数ではなく構成比の推移）
            </label>
          )}
        </>
      )}

      {widget.type === "boxplot" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={`${idp}-bfield`}>ばらつきを見る数値</Label>
            <Select
              id={`${idp}-bfield`}
              className="h-9"
              value={widget.field}
              onChange={(e) => onChange({ ...widget, field: e.target.value })}
            >
              {nums.length === 0 && <option value="">数値項目なし</option>}
              {nums.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${idp}-bgroup`}>並べる区分</Label>
            <Select
              id={`${idp}-bgroup`}
              className="h-9"
              value={widget.groupBy ?? ""}
              onChange={(e) =>
                onChange({ ...widget, groupBy: e.target.value || undefined })
              }
            >
              <option value="">分けない（全体で1本）</option>
              {groups.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}

      {widget.type === "radar" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={`${idp}-raxis`}>軸にする区分</Label>
            <Select
              id={`${idp}-raxis`}
              className="h-9"
              value={widget.groupBy}
              onChange={(e) => onChange({ ...widget, groupBy: e.target.value })}
            >
              {groups.length === 0 && <option value="">項目なし</option>}
              {groups.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-2xs text-ink-muted">
              値の種類が3つ以上ないと多角形になりません
            </p>
          </div>
          <div>
            <Label htmlFor={`${idp}-rsplit`}>重ねる区分</Label>
            <Select
              id={`${idp}-rsplit`}
              className="h-9"
              value={widget.splitBy ?? ""}
              onChange={(e) =>
                onChange({ ...widget, splitBy: e.target.value || undefined })
              }
            >
              <option value="">重ねない（1枚）</option>
              {groups
                .filter((f) => f.key !== widget.groupBy)
                .map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${idp}-ragg`}>集計</Label>
            <Select
              id={`${idp}-ragg`}
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
              <Label htmlFor={`${idp}-rfield`}>対象項目</Label>
              <Select
                id={`${idp}-rfield`}
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
      )}

      {widget.type === "sankey" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={`${idp}-sfrom`}>出発（左）</Label>
            <Select
              id={`${idp}-sfrom`}
              className="h-9"
              value={widget.fromField}
              onChange={(e) => onChange({ ...widget, fromField: e.target.value })}
            >
              {groups.length === 0 && <option value="">項目なし</option>}
              {groups.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${idp}-sto`}>到着（右）</Label>
            <Select
              id={`${idp}-sto`}
              className="h-9"
              value={widget.toField}
              onChange={(e) => onChange({ ...widget, toField: e.target.value })}
            >
              {groups.length === 0 && <option value="">項目なし</option>}
              {groups.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-2">
            <Label htmlFor={`${idp}-sagg`}>帯の太さ</Label>
            <Select
              id={`${idp}-sagg`}
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
        </div>
      )}

      {widget.type === "japanmap" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={`${idp}-jfield`}>都道府県の項目</Label>
            <Select
              id={`${idp}-jfield`}
              className="h-9"
              value={widget.field}
              onChange={(e) => onChange({ ...widget, field: e.target.value })}
            >
              {fields.length === 0 && <option value="">項目なし</option>}
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-2xs text-ink-muted">
              「東京都」「東京」のほか、住所の先頭からも読み取ります
            </p>
          </div>
          <div>
            <Label htmlFor={`${idp}-jagg`}>集計</Label>
            <Select
              id={`${idp}-jagg`}
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
              <Label htmlFor={`${idp}-jmfield`}>対象項目</Label>
              <Select
                id={`${idp}-jmfield`}
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
      )}

      {widget.type === "gauge" && (
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
            <Label htmlFor={`${idp}-target`}>目標値</Label>
            <Input
              id={`${idp}-target`}
              type="number"
              className="h-9"
              value={String(widget.target)}
              onChange={(e) =>
                onChange({
                  ...widget,
                  // 空欄や文字が入ったときに NaN を仕様へ入れない。
                  target: Number.isFinite(Number(e.target.value))
                    ? Number(e.target.value)
                    : 0,
                })
              }
            />
          </div>
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
          <label className="col-span-2 flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={widget.lowerIsBetter ?? false}
              onChange={(e) =>
                onChange({ ...widget, lowerIsBetter: e.target.checked })
              }
              className="h-4 w-4 rounded border-ink-rule"
            />
            小さいほど良い（コスト・リードタイムなど）
          </label>
        </div>
      )}

      {widget.type === "waterfall" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={`${idp}-group`}>分解する軸</Label>
            <Select
              id={`${idp}-group`}
              className="h-9"
              value={widget.groupBy}
              onChange={(e) => onChange({ ...widget, groupBy: e.target.value })}
            >
              {groups.length === 0 && <option value="">項目なし</option>}
              {groups.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
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
            <Label htmlFor={`${idp}-order`}>並び順</Label>
            <Select
              id={`${idp}-order`}
              className="h-9"
              value={widget.order ?? "value"}
              onChange={(e) =>
                onChange({
                  ...widget,
                  order: e.target.value as "value" | "label",
                })
              }
            >
              <option value="value">大きい順（押し上げた順に読む）</option>
              <option value="label">項目の順（売上→原価→利益など）</option>
            </Select>
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={widget.showTotal}
              onChange={(e) =>
                onChange({ ...widget, showTotal: e.target.checked })
              }
              className="h-4 w-4 rounded border-ink-rule"
            />
            最後に合計の段を置く
          </label>
        </div>
      )}

      {widget.type === "funnel" && (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={(widget.order ?? "label") === "label"}
            onChange={(e) =>
              onChange({ ...widget, order: e.target.checked ? "label" : "value" })
            }
            className="h-4 w-4 accent-khaki-500"
          />
          段階の順に並べる（外すと多い順）
        </label>
      )}

      {widget.type === "histogram" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={`${idp}-hfield`}>対象項目</Label>
            <Select
              id={`${idp}-hfield`}
              className="h-9"
              value={widget.field}
              onChange={(e) => onChange({ ...widget, field: e.target.value })}
            >
              {nums.length === 0 && <option value="">数値項目なし</option>}
              {nums.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${idp}-hbins`}>区間の数</Label>
            <Input
              id={`${idp}-hbins`}
              type="number"
              min={3}
              max={30}
              className="h-9"
              value={widget.bins}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (!Number.isFinite(n)) return;
                onChange({ ...widget, bins: Math.min(30, Math.max(3, n)) });
              }}
            />
          </div>
        </div>
      )}

      {widget.type === "scatter" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${idp}-sx`}>横軸</Label>
              <Select
                id={`${idp}-sx`}
                className="h-9"
                value={widget.xField}
                onChange={(e) => onChange({ ...widget, xField: e.target.value })}
              >
                {nums.length === 0 && <option value="">数値項目なし</option>}
                {nums.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${idp}-sy`}>縦軸</Label>
              <Select
                id={`${idp}-sy`}
                className="h-9"
                value={widget.yField}
                onChange={(e) => onChange({ ...widget, yField: e.target.value })}
              >
                {nums.length === 0 && <option value="">数値項目なし</option>}
                {nums.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${idp}-scolor`}>色分け</Label>
              <Select
                id={`${idp}-scolor`}
                className="h-9"
                value={widget.colorBy ?? ""}
                onChange={(e) =>
                  onChange({ ...widget, colorBy: e.target.value || undefined })
                }
              >
                <option value="">分けない</option>
                {groups.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${idp}-ssize`}>点の大きさ</Label>
              <Select
                id={`${idp}-ssize`}
                className="h-9"
                value={widget.sizeField ?? ""}
                onChange={(e) =>
                  onChange({ ...widget, sizeField: e.target.value || undefined })
                }
              >
                <option value="">一定（ふつうの散布図）</option>
                {nums.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${idp}-slabel`}>点の名前</Label>
              <Select
                id={`${idp}-slabel`}
                className="h-9"
                value={widget.labelField ?? ""}
                onChange={(e) =>
                  onChange({ ...widget, labelField: e.target.value || undefined })
                }
              >
                <option value="">なし</option>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </>
      )}

      {(widget.type === "donut" ||
        widget.type === "hbar" ||
        widget.type === "treemap" ||
        widget.type === "funnel") && (
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

      {(widget.type === "pivot" || widget.type === "heatmap") && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${idp}-prow`}>行（縦）</Label>
              <Select
                id={`${idp}-prow`}
                className="h-9"
                value={widget.rowField}
                onChange={(e) =>
                  onChange({ ...widget, rowField: e.target.value })
                }
              >
                {groups.length === 0 && (
                  <option value="">分類できる項目なし</option>
                )}
                {groups.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${idp}-pcol`}>列（横）</Label>
              <Select
                id={`${idp}-pcol`}
                className="h-9"
                value={widget.colField}
                onChange={(e) =>
                  onChange({ ...widget, colField: e.target.value })
                }
              >
                {groups.length === 0 && (
                  <option value="">分類できる項目なし</option>
                )}
                {groups.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {/* Same field on both axes is valid but useless — warn, never block. */}
          {widget.rowField !== "" && widget.rowField === widget.colField && (
            <p className="text-2xs text-ink-muted">
              行と列に同じ項目が選ばれています
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${idp}-pagg`}>集計</Label>
              <Select
                id={`${idp}-pagg`}
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
                <Label htmlFor={`${idp}-pfield`}>対象項目</Label>
                <Select
                  id={`${idp}-pfield`}
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
              <Label htmlFor={`${idp}-punit`}>単位</Label>
              <Select
                id={`${idp}-punit`}
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`${idp}-prlimit`}>行の上限</Label>
              <Input
                id={`${idp}-prlimit`}
                type="number"
                min={2}
                max={50}
                className="h-9"
                value={widget.rowLimit}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (!Number.isFinite(n)) return;
                  onChange({ ...widget, rowLimit: Math.min(50, Math.max(2, n)) });
                }}
              />
            </div>
            <div>
              <Label htmlFor={`${idp}-pclimit`}>列の上限</Label>
              <Input
                id={`${idp}-pclimit`}
                type="number"
                min={2}
                max={20}
                className="h-9"
                value={widget.colLimit}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (!Number.isFinite(n)) return;
                  onChange({ ...widget, colLimit: Math.min(20, Math.max(2, n)) });
                }}
              />
            </div>
          </div>
          <p className="text-2xs text-ink-muted">
            上限を超えた分は「その他」にまとめられます
          </p>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={widget.showTotals}
              onChange={(e) =>
                onChange({ ...widget, showTotals: e.target.checked })
              }
              className="h-4 w-4 accent-khaki-500"
            />
            合計を表示
          </label>
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
