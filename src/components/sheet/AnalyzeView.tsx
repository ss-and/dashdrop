"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonStyles } from "@/components/ui/Button";
import { NavIcon } from "@/components/app/icons";
import { cn } from "@/lib/utils";
import { autoLayout } from "@/lib/widget-builder";
import type { WidgetSpec, WidgetData, Filter } from "@/lib/widgets";
import { DashboardGrid, type ComputedWidget } from "@/components/dashboard/DashboardGrid";
import {
  FilterBar,
  buildFilters,
  emptyFilters,
  type AnalysisFilters,
} from "./FilterBar";
import type { SheetField, SheetRef } from "./types";

/**
 * The 分析 tab: charts for THIS spreadsheet, right next to its data.
 *
 * `autoLayout` builds a starter layout from the sheet's own fields, the filter
 * bar's choices are appended to every widget's `filters`, and the whole thing
 * is priced by /api/dashboards/preview — the same engine that renders a saved
 * dashboard, so what you see here is what you get when you press 「このまま保存」.
 */

/** Slices the engine synthesises rather than reads from the data. */
const NON_DRILLABLE = new Set(["その他", "—"]);

export function AnalyzeView({
  sheet,
  fields,
}: {
  sheet: SheetRef;
  fields: SheetField[];
}) {
  const router = useRouter();

  const [layout, setLayout] = useState<WidgetSpec[]>([]);
  const [built, setBuilt] = useState(false);
  const [filters, setFilters] = useState<AnalysisFilters>(() =>
    emptyFilters(fields),
  );
  const [results, setResults] = useState<Record<string, WidgetData | null>>({});
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const seqRef = useRef(0);

  /* ---------------------------- starter layout --------------------------- */

  // Built on mount (not during render): the widget ids are random, and they
  // must be generated in the browser only.
  useEffect(() => {
    setLayout(
      autoLayout([
        {
          slug: sheet.slug,
          name: sheet.name,
          fields: fields.map((f) => ({
            key: f.key,
            name: f.name,
            type: f.type,
          })),
        },
      ]),
    );
    setBuilt(true);
  }, [sheet.slug, sheet.name, fields]);

  /* ------------------------------- filters ------------------------------- */

  const activeFilters: Filter[] = useMemo(
    () => buildFilters(filters),
    [filters],
  );

  /** Every widget, with the bar's filters appended to its own. */
  const filteredLayout: WidgetSpec[] = useMemo(
    () =>
      layout.map(
        (w) =>
          ({
            ...w,
            filters: [...(w.filters ?? []), ...activeFilters],
          }) as WidgetSpec,
      ),
    [layout, activeFilters],
  );

  /* ------------------------------- preview ------------------------------- */

  useEffect(() => {
    const seq = ++seqRef.current;
    if (filteredLayout.length === 0) {
      setResults({});
      setFetching(false);
      return;
    }
    setFetching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/dashboards/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            collectionSlugs: [sheet.slug],
            layout: filteredLayout,
          }),
        });
        const body = await res.json().catch(() => null);
        if (seq !== seqRef.current) return; // stale response — ignore
        if (!res.ok || !body?.ok) {
          setError(body?.error ?? "分析の更新に失敗しました");
          return;
        }
        setResults(
          (body.data?.results as Record<string, WidgetData | null>) ?? {},
        );
        setError(null);
      } catch {
        if (seq === seqRef.current) {
          // Keep the last good render — only say so.
          setError("通信エラーが発生しました。表示は最後に取得した内容です。");
        }
      } finally {
        if (seq === seqRef.current) setFetching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [filteredLayout, sheet.slug]);

  const computed: ComputedWidget[] = useMemo(
    () =>
      layout
        .map((w) => ({ widget: w, data: results[w.id] }))
        .filter((x): x is ComputedWidget => Boolean(x.data)),
    [layout, results],
  );

  /* ------------------------------ drill-down ----------------------------- */

  /**
   * One clickable row per breakdown widget, built from the slices the engine
   * actually returned. Clicking a slice adds `groupBy = <その値>` to the bar,
   * where it shows up as a removable chip like any other condition.
   */
  const drills = useMemo(() => {
    const byKey = new Map(fields.map((f) => [f.key, f]));
    return layout
      .filter(
        (w): w is Extract<WidgetSpec, { type: "donut" | "hbar" }> =>
          w.type === "donut" || w.type === "hbar",
      )
      .map((w) => {
        const data = results[w.id];
        if (!data || (data.type !== "donut" && data.type !== "hbar")) return null;
        const field = byKey.get(w.groupBy);
        const options = field?.options ?? null;
        const items = data.slices
          .filter((s) => !NON_DRILLABLE.has(s.label))
          .map((s) => ({
            label: s.label,
            // The slice carries the display label; the filter needs the value.
            value: options?.find((o) => o.label === s.label)?.value ?? s.label,
          }));
        if (items.length === 0) return null;
        return {
          widgetId: w.id,
          title: w.title,
          field: w.groupBy,
          fieldName: field?.name ?? w.groupBy,
          items,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
  }, [layout, results, fields]);

  function toggleDrill(field: string, value: string) {
    setFilters((prev) => {
      const eq = { ...prev.eq };
      if (eq[field] === value) delete eq[field];
      else eq[field] = value;
      return { ...prev, eq };
    });
  }

  /* --------------------------------- save -------------------------------- */

  async function save() {
    if (saving || filteredLayout.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${sheet.name} の分析`,
          collectionSlugs: [sheet.slug],
          layout: filteredLayout,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setSaveError(body?.error ?? "保存に失敗しました");
        return;
      }
      router.push("/d/" + body.data.dashboardId);
      router.refresh();
    } catch {
      setSaveError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setSaving(false);
    }
  }

  /* --------------------------------- view -------------------------------- */

  if (built && layout.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-ink-line bg-paper-sunken px-6 py-12 text-center">
        <p className="text-sm font-medium text-ink">
          このシートは項目が少ないため、分析を自動作成できません
        </p>
        <p className="text-xs text-ink-muted">
          項目を追加するか、自分でウィジェットを組み立ててください。
        </p>
        <Link
          href={`/dashboards/build?sheet=${sheet.id}`}
          className={buttonStyles({ variant: "secondary", size: "sm" })}
        >
          <NavIcon name="dashboard" className="h-4 w-4" />
          自分で組む
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="section-title text-sm">このシートの分析</h3>
          {fetching && <span className="text-xs text-ink-faint">更新中…</span>}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboards/build?sheet=${sheet.id}`}
            className={buttonStyles({ variant: "secondary", size: "sm" })}
          >
            <NavIcon name="dashboard" className="h-4 w-4" />
            自分で組む
          </Link>
          <Button size="sm" onClick={save} disabled={saving || layout.length === 0}>
            {saving ? "保存中…" : "このまま保存"}
          </Button>
        </div>
      </div>

      {saveError && (
        <div
          role="alert"
          className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {saveError}
        </div>
      )}

      <FilterBar fields={fields} state={filters} onChange={setFilters} />

      {error && (
        <div
          role="status"
          className="rounded border border-warning/20 bg-warning-soft px-3 py-2 text-sm text-warning"
        >
          {error}
        </div>
      )}

      {computed.length > 0 ? (
        <DashboardGrid computed={computed} />
      ) : (
        <div className="flex min-h-[10rem] items-center justify-center rounded-md border border-ink-line bg-paper-sunken text-sm text-ink-faint">
          {built ? "分析を読み込んでいます…" : "分析を組み立てています…"}
        </div>
      )}

      {/* Drill-down */}
      {drills.length > 0 && (
        <div className="space-y-2.5 rounded-md border border-ink-line bg-paper-raised px-3 py-3">
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
            内訳で絞り込む
          </p>
          {drills.map((d) => (
            <div key={d.widgetId} className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-ink-muted">{d.fieldName}</span>
              {d.items.map((item) => {
                const on = filters.eq[d.field] === item.value;
                return (
                  <button
                    key={`${d.widgetId}:${item.value}`}
                    type="button"
                    onClick={() => toggleDrill(d.field, item.value)}
                    aria-pressed={on}
                    title={`${d.fieldName}が「${item.label}」の行だけを表示`}
                    className={cn(
                      "rounded border px-2 py-0.5 text-xs transition-colors",
                      on
                        ? "border-khaki-600 bg-khaki-500 font-medium text-white"
                        : "border-ink-line bg-paper-raised text-ink-soft hover:bg-khaki-50 hover:text-khaki-800",
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
          <p className="text-2xs text-ink-faint">
            選んだ内訳は上の条件に追加されます。もう一度押すと解除します。
          </p>
        </div>
      )}
    </div>
  );
}
