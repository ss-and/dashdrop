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
import "server-only";
import { db } from "./db";
import { ApiError } from "./errors";
import { computeWidget, type AggCollection } from "./aggregate";
import {
  resolveCollectionRecords,
  type EngineCollection,
} from "./relations";
import { createNotification, sendWorkspaceSlack, emailConfigured } from "./notify";
import { displayValue, type FieldType } from "./field-types";
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

/** 集計対象フィールドの型を決めるのに要る最小限。Prismaの生成型に依存させない。 */
export interface MetricField {
  key: string;
  type: string;
}

/**
 * メトリクスの評価結果に、通知の文面を組み立てるための材料を添えたもの。
 *
 * シート名とフィールド定義は元々コレクションを読んだ時点で手元にあるのに、
 * 数値だけ返して捨てていた。そのため通知が「どのシートの話か」を言えず、
 * 金額フィールドでも「¥」を付けられなかった。
 */
export interface MetricContext {
  value: number | null;
  /** 対象シート（コレクション）の名前。見つからないときは空文字。 */
  collectionName: string;
  fields: MetricField[];
}

/**
 * Compute the current numeric value of an alert metric over a collection.
 * Resolves relation rollups/lookups first so metrics can target computed fields.
 *
 * 値だけが要る呼び出し元のために `computeMetricValue` を残してあるので、
 * こちらのシグネチャを変えても既存のAPIは壊れない。
 */
export async function computeMetricContext(
  workspaceId: string,
  collectionId: string,
  metric: AlertMetric,
): Promise<MetricContext> {
  const collection = await db.collection.findFirst({
    where: { id: collectionId, workspaceId },
    include: {
      fields: { orderBy: { position: "asc" } },
      records: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!collection) return { value: null, collectionName: "", fields: [] };

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
  return {
    value: typeof data.value === "number" ? data.value : null,
    collectionName: collection.name,
    fields: collection.fields.map((f) => ({ key: f.key, type: f.type })),
  };
}

/** 値だけが要る呼び出し元（アラートのプレビューAPI）向けの薄いラッパ。 */
export async function computeMetricValue(
  workspaceId: string,
  collectionId: string,
  metric: AlertMetric,
): Promise<number | null> {
  const { value } = await computeMetricContext(workspaceId, collectionId, metric);
  return value;
}

/* ------------------------- 通知の文面（Slack / アプリ内） ------------------------- */

/**
 * 通知に出す数値の書式を決める。
 *
 * 金額フィールドの合計を `2,842,300` と裸で出すと、桁を数える羽目になる。
 * 集計対象フィールドの型を見て `¥2,842,300` と出す。currency 以外（date や
 * rollup など）を displayValue にそのまま渡すと桁区切りすら付かないので、
 * 数値として整形できる型に寄せる。
 */
export function metricValueType(
  measure: Measure,
  fields: readonly MetricField[],
): FieldType {
  // count は対象フィールドを持たない。
  if (measure.kind === "count") return "number";
  const type = fields.find((f) => f.key === measure.field)?.type;
  return type === "currency" ? "currency" : "number";
}

/** 単位を名乗ってよいのは件数だけ。sum(金額) に「件」を付けてはいけない。 */
function metricUnit(measure: Measure): string {
  return measure.kind === "count" ? "件" : "";
}

/** 通知に出すシート名の上限。長い名前でルール名が押し出されないようにする。 */
const MAX_SHEET_NAME = 24;

function truncate(value: string, max: number): string {
  const v = (value ?? "").trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

export interface AlertMessageInput {
  ruleName: string;
  collectionName: string;
  collectionId: string;
  measure: Measure;
  fields: readonly MetricField[];
  operator: string;
  threshold: number;
  value: number;
  /** 前回評価時の値。初回の発火では null。 */
  lastValue: number | null;
}

/** Slack とアプリ内通知が共有する、1通ぶんの文面。 */
export interface AlertMessage {
  title: string;
  body: string;
  url: string;
  /** リンクの表示文言。行き先（対象シート）を名乗る。 */
  linkLabel: string;
}

/**
 * 発火した1件を、スマホで数秒で読める文面にする。
 *
 * 方針は「何が・どのシートで・いくつになり・どう動いたか」を重複なく1回ずつ。
 * 以前はルール名を見出しと本文で2回、現在値としきい値を本文とフィールドで
 * 2回ずつ書いていて、量の半分が繰り返しだった。代わりに前回値との差分を
 * 載せる。経営者が知りたいのは「今いくつか」ではなく「どう動いたか」なので。
 *
 * DBにもネットワークにも触れない純粋関数なので、文面そのものを単体テストできる。
 */
export function buildAlertMessage(input: AlertMessageInput): AlertMessage {
  const type = metricValueType(input.measure, input.fields);
  const unit = metricUnit(input.measure);
  const fmt = (n: number): string => {
    const text = displayValue(type, n);
    // 0 は displayValue でも「0」になるが、空文字が返る型に変わっても
    // 値が消えないようにしておく（0件・0円は消えると誤読される）。
    return `${text || String(n)}${unit}`;
  };

  const sheet = truncate(input.collectionName ?? "", MAX_SHEET_NAME);
  const rule = (input.ruleName ?? "").trim();
  // シートを十数枚持つ利用者には、ルール名だけでは「どこの話か」が分からない。
  const heading = [rule, sheet].filter(Boolean).join("｜");

  const current = fmt(input.value);
  const prev = input.lastValue;
  let movement: string;
  if (prev === null || prev === undefined) {
    // 初回の発火。「前回」が無い理由まで書かないと、欠落を不具合と読まれる。
    movement = `現在 ${current}（初回の通知）`;
  } else {
    const diff = input.value - prev;
    // 無限大どうしの差（NaN）や差0のときは、書いても情報が増えない。
    const delta = Number.isFinite(diff) && diff !== 0
      ? `（${diff > 0 ? "+" : "-"}${fmt(Math.abs(diff))}）`
      : "";
    movement = `前回 ${fmt(prev)} → 今回 ${current}${delta}`;
  }

  return {
    // ルール名もシート名も空という異常時は、Slack 側の既定文言に合わせる。
    title: heading ? `🚨 ${heading}` : "DashDrop",
    body: `${movement}\nしきい値 ${fmt(input.threshold)}${OP_LABEL[input.operator] ?? ""}`,
    url: `/c/${input.collectionId}`,
    // 「DashDrop で開く」では行き先が分からない。開くのは対象シートである。
    linkLabel: sheet ? `${sheet}を開く` : "DashDrop で開く",
  };
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
 * 既知のエラーコード → 利用者に見せる日本語。
 *
 * ここに無いものは一律で汎用メッセージに落とす（許可リスト方式）。例外の本文を
 * そのまま出すと、Prisma の既定フォーマットが
 * 「Invalid `prisma.alertRule.update()` invocation in /home/…/src/lib/alerts.ts:245:26」
 * のようにサーバのファイルパスと行番号を、接続失敗時は DB のホスト名とポートを
 * 含めてくるため、ワークスペースの誰でも押せる「今すぐ評価する」から
 * サーバ内部が読めてしまう。原因の特定はサーバログ（console.error）で行う。
 */
const RULE_ERROR_BY_CODE: Record<string, string> = {
  // findMany と update の間に行が消えたケース（ルール削除、または同時に走った
  // 評価との競合）。次回以降は対象から外れるので運用者の対処は不要。
  P2025: "ルールが見つかりませんでした（評価中に削除された可能性があります）。",
  P2002: "同じ内容のルールが既に登録されています。",
  P2003: "参照先のスプレッドシートが見つかりません（削除された可能性があります）。",
  P1001: "データベースに接続できませんでした。しばらくして再度お試しください。",
  P1002: "データベースへの接続がタイムアウトしました。しばらくして再度お試しください。",
  P1008: "処理に時間がかかりすぎたため中断しました。対象の行数を減らしてお試しください。",
};

/** 対象シートや設定が壊れている、というアプリ側の既知エラー。 */
const GENERIC_RULE_ERROR = "評価に失敗しました。ルールの設定と対象シートをご確認ください。";

/**
 * 失敗理由をAPIレスポンスにそのまま載せられる日本語へ落とす。
 *
 * 例外の本文は載せない（上の RULE_ERROR_BY_CODE のコメント参照）。ただし
 * ApiError は元々利用者向けに書かれた日本語なので、それだけは通す。
 * DBに触れない純粋関数なので、DBフィクスチャなしで単体テストできる。
 */
export function describeRuleError(err: unknown): string {
  const mapped = RULE_ERROR_BY_CODE[errorCode(err) ?? ""];
  if (mapped) return mapped;
  // ApiError は「顧客に見せる文言」として書かれているので、そのまま出してよい。
  if (err instanceof ApiError && err.message.trim()) {
    return err.message.trim();
  }
  return GENERIC_RULE_ERROR;
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
  const { value, collectionName, fields } = await computeMetricContext(
    workspaceId,
    rule.collectionId,
    metric,
  );
  if (value === null) return false;

  const nowSatisfied = satisfies(value, rule.operator, rule.threshold);
  const prevSatisfied =
    rule.lastValue !== null && rule.lastValue !== undefined
      ? satisfies(rule.lastValue, rule.operator, rule.threshold)
      : false;

  // Edge trigger: fire only when the condition newly becomes true.
  const fired = nowSatisfied && !prevSatisfied;
  if (fired) {
    // Slack もアプリ内も同じ文面にする（片方だけ読んだ人が別の話に見えないように）。
    const message = buildAlertMessage({
      ruleName: rule.name,
      collectionName,
      collectionId: rule.collectionId,
      measure: metric.measure,
      fields,
      operator: rule.operator,
      threshold: rule.threshold,
      value,
      lastValue: rule.lastValue ?? null,
    });

    await createNotification(workspaceId, {
      type: "alert",
      title: message.title,
      body: message.body,
      url: message.url,
      meta: { ruleId: rule.id, value, previousValue: rule.lastValue ?? null },
    });

    if (rule.channel === "slack") {
      // Goes to the channel this workspace connected in 設定 → 連携.
      // 現在値としきい値は本文に1回ずつ入っているので fields は付けない。
      await sendWorkspaceSlack(workspaceId, {
        title: message.title,
        body: message.body,
        url: message.url,
        linkLabel: message.linkLabel,
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
