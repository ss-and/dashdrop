import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import type { WidgetSpec, WidgetData } from "@/lib/widgets";
import { KpiTile } from "./widgets/KpiTile";
import { SeriesChart } from "./widgets/SeriesChart";
import { BreakdownChart } from "./widgets/BreakdownChart";
import { DataTable } from "./widgets/DataTable";
import { PivotTable } from "./widgets/PivotTable";
import { ScatterPlot } from "./widgets/ScatterPlot";

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
    case "combo":
      return <SeriesChart data={data} />;
    case "donut":
    case "hbar":
    case "treemap":
    case "funnel":
      return <BreakdownChart data={data} />;
    case "table":
      return <DataTable data={data} />;
    case "pivot":
    case "heatmap":
      return <PivotTable data={data} />;
    case "scatter":
      return <ScatterPlot data={data} />;
    default:
      return (
        <div className="flex h-24 items-center justify-center text-sm text-ink-faint">
          データなし
        </div>
      );
  }
}

type Block =
  | { kind: "kpis"; items: ComputedWidget[]; span: number }
  | { kind: "widget"; item: ComputedWidget; span: number };

/**
 * Groups a run of consecutive KPI widgets into a single block.
 *
 * Rendered individually, four KPIs became four separately bordered rounded
 * rectangles with gaps between them — the numbers ended up competing with their
 * own containers. Every dashboard product worth copying (Salesforce, Shopify,
 * Workday) bands the KPI row into one surface divided by rules instead.
 */
function toBlocks(computed: ComputedWidget[]): Block[] {
  const blocks: Block[] = [];
  for (const item of computed) {
    const span = Math.min(4, Math.max(1, item.widget.span ?? 1));
    const last = blocks[blocks.length - 1];
    if (item.data.type === "kpi") {
      if (last?.kind === "kpis" && last.span + span <= 4) {
        last.items.push(item);
        last.span += span;
        continue;
      }
      blocks.push({ kind: "kpis", items: [item], span });
      continue;
    }
    blocks.push({ kind: "widget", item, span });
  }
  return blocks;
}

/** Column count for the KPI strip — a static map, so Tailwind keeps the classes. */
const KPI_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
};

export function DashboardGrid({ computed }: { computed: ComputedWidget[] }) {
  const blocks = toBlocks(computed);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {blocks.map((block) => {
        if (block.kind === "kpis") {
          return (
            <section
              key={block.items[0].widget.id}
              className={`grid gap-px overflow-hidden rounded-md border border-ink-line bg-ink-line ${
                KPI_COLS[Math.min(4, block.items.length)]
              } ${SPAN_CLASS[block.span]}`}
            >
              {block.items.map(({ widget, data }) => (
                <div
                  key={widget.id}
                  className="flex flex-col gap-2.5 bg-paper-raised px-5 py-4"
                >
                  <p className="text-sm font-medium text-ink-muted">
                    {widget.title}
                  </p>
                  <div className="flex-1">
                    <WidgetBody data={data} />
                  </div>
                </div>
              ))}
            </section>
          );
        }

        const { widget, data } = block.item;
        return (
          <Card key={widget.id} className={`flex flex-col ${SPAN_CLASS[block.span]}`}>
            <CardHeader>
              <CardTitle>{widget.title}</CardTitle>
            </CardHeader>
            <CardBody className="flex-1">
              <WidgetBody data={data} />
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
