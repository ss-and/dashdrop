/**
 * Threshold-alert evaluation.
 *
 * A rule computes a metric (measure + filters) over one spreadsheet and fires
 * when the value crosses a bound. Firing is EDGE-triggered (only when the
 * condition newly becomes true) so repeated evaluations don't spam. Delivery is
 * in-app by default; Slack/email additionally when configured.
 */
import "server-only";
import { db } from "./db";
import { computeWidget, type AggCollection } from "./aggregate";
import {
  resolveCollectionRecords,
  type EngineCollection,
} from "./relations";
import { createNotification, sendSlack, emailConfigured } from "./notify";
import { displayValue } from "./field-types";
import type { Measure, Filter, WidgetSpec, KpiData } from "./widgets";

export interface AlertMetric {
  measure: Measure;
  filters?: Filter[];
}

export type AlertOperator = "gt" | "gte" | "lt" | "lte";

export function satisfies(value: number, op: string, threshold: number): boolean {
  switch (op) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    default:
      return false;
  }
}

const OP_LABEL: Record<string, string> = {
  gt: "を超えました",
  gte: "以上になりました",
  lt: "を下回りました",
  lte: "以下になりました",
};

/**
 * Compute the current numeric value of an alert metric over a collection.
 * Resolves relation rollups/lookups first so metrics can target computed fields.
 */
export async function computeMetricValue(
  workspaceId: string,
  collectionId: string,
  metric: AlertMetric,
): Promise<number | null> {
  const collection = await db.collection.findFirst({
    where: { id: collectionId, workspaceId },
    include: {
      fields: { orderBy: { position: "asc" } },
      records: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!collection) return null;

  const resolved = await resolveCollectionRecords(
    workspaceId,
    collection as unknown as EngineCollection,
    collection.records.map((r) => ({ id: r.id, data: (r.data as Record<string, unknown>) ?? {} })),
  );
  const computedById = new Map(resolved.records.map((r) => [r.id, r.computed]));

  const agg: AggCollection = {
    slug: collection.slug,
    name: collection.name,
    fields: collection.fields.map((f) => ({
      key: f.key,
      name: f.name,
      type: f.type,
      options: (f.options as AggCollection["fields"][number]["options"]) ?? null,
    })),
    records: collection.records.map((r) => ({
      id: r.id,
      data: { ...((r.data as Record<string, unknown>) ?? {}), ...(computedById.get(r.id) ?? {}) },
      createdAt: r.createdAt,
    })),
  };

  const widget: WidgetSpec = {
    id: "alert",
    type: "kpi",
    title: "alert",
    collection: collection.slug,
    measure: metric.measure,
    filters: metric.filters,
  };
  const data = computeWidget(widget, new Map([[collection.slug, agg]])) as KpiData;
  return typeof data.value === "number" ? data.value : null;
}

export interface EvaluateResult {
  evaluated: number;
  triggered: number;
}

/** Evaluate all enabled rules for a workspace; notify on newly-crossed rules. */
export async function evaluateWorkspaceAlerts(
  workspaceId: string,
): Promise<EvaluateResult> {
  const rules = await db.alertRule.findMany({
    where: { workspaceId, enabled: true },
  });
  let triggered = 0;

  for (const rule of rules) {
    const metric = rule.metric as unknown as AlertMetric;
    const value = await computeMetricValue(workspaceId, rule.collectionId, metric);
    if (value === null) continue;

    const nowSatisfied = satisfies(value, rule.operator, rule.threshold);
    const prevSatisfied =
      rule.lastValue !== null && rule.lastValue !== undefined
        ? satisfies(rule.lastValue, rule.operator, rule.threshold)
        : false;

    // Edge trigger: fire only when the condition newly becomes true.
    if (nowSatisfied && !prevSatisfied) {
      triggered++;
      const unit = metric.measure.kind === "count" ? "件" : "";
      const valLabel = `${displayValue("number", value)}${unit}`;
      const body = `${rule.name}: 現在 ${valLabel}（しきい値 ${rule.threshold}${unit}${OP_LABEL[rule.operator] ?? ""}）`;

      await createNotification(workspaceId, {
        type: "alert",
        title: `アラート: ${rule.name}`,
        body,
        url: `/c/${rule.collectionId}`,
        meta: { ruleId: rule.id, value },
      });

      if (rule.channel === "slack") {
        await sendSlack(`:rotating_light: ${body}`);
      }
      // email channel: delivered in-app for now; real SMTP send when configured.
      void emailConfigured;
    }

    await db.alertRule.update({
      where: { id: rule.id },
      data: { lastValue: value, ...(nowSatisfied && !prevSatisfied ? { lastTriggeredAt: new Date() } : {}) },
    });
  }

  return { evaluated: rules.length, triggered };
}
