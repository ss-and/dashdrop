/**
 * Threshold-alert evaluation.
 *
 * A rule computes a metric (measure + filters) over one spreadsheet and fires
 * when the value crosses a bound. Firing is EDGE-triggered (only when the
 * condition newly becomes true) so repeated evaluations don't spam. Delivery is
 * in-app by default; Slack/email additionally when configured.
 *
 * 1ルールの失敗が他のルールを巻き添えにしないよう、評価は `runEachIsolated` で
 * 1件ずつ隔離する（F3 の回帰）。
 */
// `server-only` をこのファイルから直接 import しないのは、隔離ロジック
// （runEachIsolated / describeRuleError）を DB なしで単体テストできるようにするため。
// vitest は "server-only" を解決できず、import した時点でテストから読めなくなる。
// クライアント境界は ./db と ./relations（server-only を import 済み）経由で維持される。
import { db } from "./db";
import { computeWidget, type AggCollection } from "./aggregate";
import {
  resolveCollectionRecords,
  type EngineCollection,
} from "./relations";
import { createNotification, sendWorkspaceSlack, emailConfigured } from "./notify";
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

/** 1件のルール評価が失敗したことを表す。UI/APIへそのまま出せる日本語の理由を持つ。 */
export interface AlertRuleFailure {
  ruleId: string;
  ruleName: string;
  message: string;
}

export interface EvaluateResult {
  evaluated: number;
  triggered: number;
  /** 評価に失敗したルール数。0 でない場合は `errors` に理由が入る。 */
  failed: number;
  errors: AlertRuleFailure[];
}

/** 運用者に見せる理由の長さ上限。Prismaの例外本文はスタック混じりで長くなる。 */
const MAX_REASON_LEN = 200;

/**
 * Prismaのエラーコード（P2025 など）を取り出す。`@prisma/client` の例外クラスに
 * instanceof で依存すると、生成物の有無でテストが動かなくなるため形だけで判定する。
 */
function errorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null;
  const code = (err as { code: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * 失敗理由をAPIレスポンスにそのまま載せられる日本語へ落とす。
 * DBに触れない純粋関数なので、DBフィクスチャなしで単体テストできる。
 */
export function describeRuleError(err: unknown): string {
  // findMany と update の間に行が消えたケース（ルール削除、または同時に走った
  // 評価との競合）。次回以降は対象から外れるので運用者の対処は不要。
  if (errorCode(err) === "P2025") {
    return "ルールが見つかりませんでした（評価中に削除された可能性があります）。";
  }
  const detail =
    err instanceof Error
      ? err.message.trim()
      : typeof err === "string"
        ? err.trim()
        : "";
  if (!detail) return "評価に失敗しました（原因不明のエラー）。";
  const clamped =
    detail.length > MAX_REASON_LEN
      ? `${detail.slice(0, MAX_REASON_LEN - 1)}…`
      : detail;
  return `評価に失敗しました: ${clamped}`;
}

/**
 * 各要素を独立した try/catch で処理する。1件が例外を投げても残りは必ず処理され、
 * 失敗は握りつぶさずに呼び出し元へ返す。
 *
 * あえて直列に回す: Slackのレート制限とDB負荷を避けるため（元の実装と同じ順序）。
 * DBにもネットワークにも触れないので、DBフィクスチャなしで単体テストできる。
 */
export async function runEachIsolated<T extends { id: string; name: string }>(
  items: readonly T[],
  run: (item: T) => Promise<boolean> | boolean,
): Promise<{ triggered: number; failures: AlertRuleFailure[] }> {
  let triggered = 0;
  const failures: AlertRuleFailure[] = [];

  for (const item of items) {
    try {
      if (await run(item)) triggered++;
    } catch (err) {
      console.error(`Alert rule ${item.id} evaluation failed`, err);
      failures.push({
        ruleId: item.id,
        ruleName: item.name,
        message: describeRuleError(err),
      });
    }
  }

  return { triggered, failures };
}

/** 評価に必要な列だけを写した形。Prismaの生成型に依存させないための最小定義。 */
interface AlertRuleRow {
  id: string;
  name: string;
  collectionId: string;
  metric: unknown;
  operator: string;
  threshold: number;
  channel: string;
  lastValue: number | null;
}

/** 1ルールを評価し、通知まで行う。エッジで発火したときだけ true。 */
async function evaluateRule(
  workspaceId: string,
  rule: AlertRuleRow,
): Promise<boolean> {
  const metric = rule.metric as AlertMetric;
  const value = await computeMetricValue(workspaceId, rule.collectionId, metric);
  if (value === null) return false;

  const nowSatisfied = satisfies(value, rule.operator, rule.threshold);
  const prevSatisfied =
    rule.lastValue !== null && rule.lastValue !== undefined
      ? satisfies(rule.lastValue, rule.operator, rule.threshold)
      : false;

  // Edge trigger: fire only when the condition newly becomes true.
  const fired = nowSatisfied && !prevSatisfied;
  if (fired) {
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
      // Goes to the channel this workspace connected in 設定 → 連携.
      await sendWorkspaceSlack(workspaceId, {
        title: `🚨 アラート: ${rule.name}`,
        body,
        url: `/c/${rule.collectionId}`,
        fields: [
          { label: "現在の値", value: valLabel },
          { label: "しきい値", value: `${rule.threshold}${unit}` },
        ],
      });
    }
    // email channel: delivered in-app for now; real SMTP send when configured.
    void emailConfigured;
  }

  await db.alertRule.update({
    where: { id: rule.id },
    data: { lastValue: value, ...(fired ? { lastTriggeredAt: new Date() } : {}) },
  });

  return fired;
}

/** Evaluate all enabled rules for a workspace; notify on newly-crossed rules. */
export async function evaluateWorkspaceAlerts(
  workspaceId: string,
): Promise<EvaluateResult> {
  const rules = await db.alertRule.findMany({
    where: { workspaceId, enabled: true },
  });

  // 壊れたルール（コレクション削除、ウィジェット設定の不正、評価中の行削除）が
  // 1件あっても、以降のルールが丸ごとスキップされないようにする。
  const { triggered, failures } = await runEachIsolated(rules, (rule) =>
    evaluateRule(workspaceId, rule),
  );

  return {
    evaluated: rules.length,
    triggered,
    failed: failures.length,
    errors: failures,
  };
}
