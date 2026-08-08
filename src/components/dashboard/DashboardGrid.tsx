import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import type { WidgetSpec, WidgetData } from "@/lib/widgets";
import { KpiTile } from "./widgets/KpiTile";
import { SeriesChart } from "./widgets/SeriesChart";
import { BreakdownChart } from "./widgets/BreakdownChart";
import { DataTable } from "./widgets/DataTable";

/**
 * Renders a computed dashboard layout on a 4-column responsive grid. Each
 * widget lives in a Card titled by its spec, and the body is dispatched by the
 * computed data's `type`. Span classes are a STATIC map so Tailwind keeps them.
 */

export interface ComputedWidget {
  widget: WidgetSpec;
  data: WidgetData;
}

// Static span -> class map (never interpolate — Tailwind must see the literals).
const SPAN_CLASS: Record<number, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
};

function WidgetBody({ data }: { data: WidgetData }) {
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
    default:
      return (
        <div className="flex h-24 items-center justify-center text-sm text-ink-faint">
          データなし
        </div>
      );
  }
}

export function DashboardGrid({ computed }: { computed: ComputedWidget[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {computed.map(({ widget, data }) => {
        const span = Math.min(4, Math.max(1, widget.span ?? 1));
        // KPI tiles are simple figures — no bordered header, tighter body.
        const isKpi = data.type === "kpi";
        return (
          <Card
            key={widget.id}
            className={`flex flex-col ${SPAN_CLASS[span]}`}
          >
            {isKpi ? (
              <CardBody className="flex flex-1 flex-col gap-2">
                <p className="text-sm font-medium text-ink-soft">
                  {widget.title}
                </p>
                <div className="flex-1">
                  <WidgetBody data={data} />
                </div>
              </CardBody>
            ) : (
              <>
                <CardHeader>
                  <CardTitle>{widget.title}</CardTitle>
                </CardHeader>
                <CardBody className="flex-1">
                  <WidgetBody data={data} />
                </CardBody>
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
