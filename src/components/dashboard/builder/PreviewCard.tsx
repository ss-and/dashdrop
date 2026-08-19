"use client";

import type { WidgetSpec, WidgetData } from "@/lib/widgets";
import { KpiTile } from "@/components/dashboard/widgets/KpiTile";
import { SeriesChart } from "@/components/dashboard/widgets/SeriesChart";
import { BreakdownChart } from "@/components/dashboard/widgets/BreakdownChart";
import { DataTable } from "@/components/dashboard/widgets/DataTable";
import { PivotTable } from "@/components/dashboard/widgets/PivotTable";

/**
 * Live preview area for one builder widget. Mirrors DashboardGrid's dispatch
 * on the computed data's `type`, but adds builder-only empty states:
 *  - `data === undefined` → not fetched yet ("プレビューを準備中…")
 *  - `data === null`      → widget not fully/validly configured
 *  - sheet not selected   → "データ元を選択"
 */

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-28 items-center justify-center rounded-md border border-dashed border-ink-line bg-paper-sunken px-3 text-center text-xs text-ink-muted">
      {children}
    </div>
  );
}

function Body({ data }: { data: WidgetData }) {
  switch (data.type) {
    case "kpi":
      return <KpiTile data={data} />;
    case "line":
    case "area":
    case "bar":
      return <SeriesChart data={data} />;
    case "donut":
    case "hbar":
      return <BreakdownChart data={data} />;
    case "table":
      return <DataTable data={data} />;
    case "pivot":
      return <PivotTable data={data} />;
    default:
      return <Note>データなし</Note>;
  }
}

export function PreviewCard({
  widget,
  data,
  sheetSelected,
}: {
  widget: WidgetSpec;
  data: WidgetData | null | undefined;
  sheetSelected: boolean;
}) {
  if (!sheetSelected) {
    return <Note>このウィジェットのデータ元が選択されていません。上の「データ元」で選ぶか、下の設定で変更してください。</Note>;
  }
  if (data === undefined) {
    return <Note>プレビューを準備中…</Note>;
  }
  if (data === null) {
    return <Note>設定を完成させてください</Note>;
  }
  // KPI tiles carry their own label in the grid; here the card header already
  // shows the title, so render the figure directly.
  if (widget.type === "kpi") {
    return (
      <div className="min-h-[6rem]">
        <Body data={data} />
      </div>
    );
  }
  return <Body data={data} />;
}
