/**
 * Category: マーケティング (marketing)
 *
 * Shape mirrors ./support.ts (the reference implementation): each template is a
 * set of collections (fields + light sample hints) plus a widget layout on a
 * 4-column grid (widget `span` sums to 4 per visual row).
 */
import type { DashboardTemplate } from "../widgets";

const LEAD_CHANNEL = [
  { label: "広告", value: "ads" },
  { label: "SEO", value: "seo" },
  { label: "イベント", value: "event" },
  { label: "紹介", value: "referral" },
  { label: "SNS", value: "sns" },
];
const LEAD_STATUS = [
  { label: "新規", value: "new", color: "info" },
  { label: "育成", value: "nurturing", color: "warning" },
  { label: "MQL", value: "mql", color: "khaki" },
  { label: "SQL", value: "sql", color: "success" },
  { label: "失注", value: "lost", color: "danger" },
];
const CAMPAIGN_CHANNEL = [
  { label: "検索広告", value: "search_ads" },
  { label: "SNS広告", value: "sns_ads" },
  { label: "メール", value: "email" },
  { label: "イベント", value: "event" },
  { label: "ディスプレイ", value: "display" },
];
const WEB_SOURCE = [
  { label: "検索", value: "search" },
  { label: "直接", value: "direct" },
  { label: "SNS", value: "sns" },
  { label: "広告", value: "ads" },
];
const MEDIA = [
  { label: "X", value: "x" },
  { label: "Instagram", value: "instagram" },
  { label: "LinkedIn", value: "linkedin" },
  { label: "ブログ", value: "blog" },
];

export const marketingTemplates: DashboardTemplate[] = [
  {
    key: "marketing-leads",
    category: "marketing",
    name: "リード獲得ダッシュボード",
    description:
      "チャネル別のリードをステータスとスコアで追跡し、獲得と育成の状況を可視化。",
    icon: "sparkles",
    color: "danger",
    collections: [
      {
        name: "リード",
        slug: "leads",
        icon: "sparkles",
        color: "danger",
        sampleRows: 140,
        fields: [
          { key: "company", name: "会社", type: "text", required: true },
          { key: "channel", name: "チャネル", type: "select", options: LEAD_CHANNEL, sample: { weights: [5, 4, 2, 2, 3] } },
          { key: "status", name: "ステータス", type: "select", required: true, options: LEAD_STATUS, sample: { weights: [5, 4, 3, 2, 3] } },
          { key: "score", name: "スコア", type: "number", sample: { min: 10, max: 95, trend: "up" } },
          { key: "owner", name: "担当", type: "text" },
          { key: "acquired_at", name: "獲得日", type: "date", sample: { daysBack: 60, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "今月のリード", collection: "leads", span: 1, measure: { kind: "count" }, delta: { dateField: "acquired_at", period: "month" }, icon: "sparkles" },
      { id: "k2", type: "kpi", title: "MQL率", collection: "leads", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "status", op: "eq", value: "mql" }] },
      { id: "k3", type: "kpi", title: "SQL数", collection: "leads", span: 1, measure: { kind: "count" }, filters: [{ field: "status", op: "eq", value: "sql" }] },
      { id: "k4", type: "kpi", title: "平均スコア", collection: "leads", span: 1, measure: { kind: "avg", field: "score" } },
      {
        id: "s1", type: "area", title: "リード獲得の推移", collection: "leads", span: 2,
        dateField: "acquired_at", bucket: "day", rangeCount: 30,
        measures: [{ label: "リード", measure: { kind: "count" }, color: "danger" }],
      },
      { id: "b1", type: "donut", title: "チャネル別のリード", collection: "leads", span: 2, groupBy: "channel", measure: { kind: "count" }, limit: 5 },
      { id: "b2", type: "hbar", title: "ステータス別のリード", collection: "leads", span: 2, groupBy: "status", measure: { kind: "count" }, limit: 5 },
      { id: "t1", type: "table", title: "直近のリード", collection: "leads", span: 2, columns: ["company", "channel", "status", "score", "owner"], sort: { field: "acquired_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "marketing-campaign",
    category: "marketing",
    name: "キャンペーン効果ダッシュボード",
    description:
      "施策ごとの予算・コンバージョン・売上貢献を集計し、投資対効果を可視化。",
    icon: "sparkles",
    color: "warning",
    collections: [
      {
        name: "施策",
        slug: "campaigns",
        icon: "sparkles",
        color: "warning",
        sampleRows: 90,
        fields: [
          { key: "name", name: "施策名", type: "text", required: true },
          { key: "channel", name: "チャネル", type: "select", options: CAMPAIGN_CHANNEL },
          { key: "budget", name: "予算", type: "currency", required: true, sample: { min: 100000, max: 1500000 } },
          { key: "conversions", name: "コンバージョン", type: "number", sample: { min: 5, max: 200, trend: "up" } },
          { key: "revenue", name: "売上貢献", type: "currency", required: true, sample: { min: 200000, max: 4000000, trend: "up" } },
          { key: "date", name: "実施日", type: "date", sample: { daysBack: 90, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "総予算", collection: "campaigns", span: 1, measure: { kind: "sum", field: "budget" }, unit: "currency", icon: "sparkles" },
      { id: "k2", type: "kpi", title: "総コンバージョン", collection: "campaigns", span: 1, measure: { kind: "sum", field: "conversions" } },
      { id: "k3", type: "kpi", title: "売上貢献", collection: "campaigns", span: 1, measure: { kind: "sum", field: "revenue" }, unit: "currency" },
      { id: "k4", type: "kpi", title: "施策数", collection: "campaigns", span: 1, measure: { kind: "count" } },
      {
        id: "s1", type: "bar", title: "売上貢献の推移", collection: "campaigns", span: 2,
        dateField: "date", bucket: "week", rangeCount: 8,
        measures: [{ label: "売上貢献", measure: { kind: "sum", field: "revenue" }, color: "success" }],
      },
      { id: "b1", type: "donut", title: "チャネル別の予算", collection: "campaigns", span: 2, groupBy: "channel", measure: { kind: "sum", field: "budget" }, limit: 5 },
      { id: "b2", type: "hbar", title: "施策別のコンバージョン", collection: "campaigns", span: 2, groupBy: "name", measure: { kind: "sum", field: "conversions" }, limit: 8 },
      { id: "t1", type: "table", title: "施策一覧", collection: "campaigns", span: 2, columns: ["name", "channel", "budget", "conversions", "revenue"], sort: { field: "date", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "marketing-web",
    category: "marketing",
    name: "Webサイト分析ダッシュボード",
    description:
      "日次のセッション・新規訪問・コンバージョンを流入元別に集計し、サイトの成果を把握。",
    icon: "sparkles",
    color: "info",
    collections: [
      {
        name: "日次アクセス",
        slug: "web-traffic",
        icon: "sparkles",
        color: "info",
        sampleRows: 120,
        fields: [
          { key: "date", name: "日付", type: "date", sample: { daysBack: 90, trend: "up" } },
          { key: "sessions", name: "セッション", type: "number", sample: { min: 200, max: 2000, trend: "up" } },
          { key: "new_visits", name: "新規訪問", type: "number", sample: { min: 80, max: 900, trend: "up" } },
          { key: "conversions", name: "CV", type: "number", sample: { min: 2, max: 60, trend: "up" } },
          { key: "cvr", name: "CVR(%)", type: "number", sample: { min: 1, max: 6 } },
          { key: "source", name: "流入元", type: "select", options: WEB_SOURCE, sample: { weights: [5, 3, 2, 3] } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "総セッション", collection: "web-traffic", span: 1, measure: { kind: "sum", field: "sessions" }, icon: "sparkles" },
      { id: "k2", type: "kpi", title: "総CV", collection: "web-traffic", span: 1, measure: { kind: "sum", field: "conversions" } },
      { id: "k3", type: "kpi", title: "平均CVR", collection: "web-traffic", span: 1, measure: { kind: "avg", field: "cvr" }, unit: "percent" },
      { id: "k4", type: "kpi", title: "総新規訪問", collection: "web-traffic", span: 1, measure: { kind: "sum", field: "new_visits" } },
      {
        id: "s1", type: "area", title: "セッションの推移", collection: "web-traffic", span: 2,
        dateField: "date", bucket: "day", rangeCount: 30,
        measures: [
          { label: "セッション", measure: { kind: "sum", field: "sessions" }, color: "khaki" },
          { label: "新規訪問", measure: { kind: "sum", field: "new_visits" }, color: "info" },
        ],
      },
      { id: "b1", type: "donut", title: "流入元別のセッション", collection: "web-traffic", span: 2, groupBy: "source", measure: { kind: "sum", field: "sessions" }, limit: 4 },
      { id: "t1", type: "table", title: "直近のアクセス", collection: "web-traffic", span: 4, columns: ["date", "sessions", "new_visits", "conversions", "source"], sort: { field: "date", dir: "desc" }, limit: 10 },
    ],
  },

  {
    key: "marketing-social",
    category: "marketing",
    name: "SNS・コンテンツ分析ダッシュボード",
    description:
      "媒体別の投稿の表示回数とエンゲージメントを集計し、コンテンツの反応を可視化。",
    icon: "sparkles",
    color: "danger",
    collections: [
      {
        name: "投稿",
        slug: "posts",
        icon: "sparkles",
        color: "danger",
        sampleRows: 110,
        fields: [
          { key: "title", name: "タイトル", type: "text", required: true },
          { key: "media", name: "媒体", type: "select", options: MEDIA, sample: { weights: [4, 3, 2, 2] } },
          { key: "impressions", name: "表示", type: "number", sample: { min: 500, max: 20000, trend: "up" } },
          { key: "engagements", name: "エンゲージ", type: "number", sample: { min: 10, max: 1200, trend: "up" } },
          { key: "posted_at", name: "投稿日", type: "date", sample: { daysBack: 60, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "総表示回数", collection: "posts", span: 1, measure: { kind: "sum", field: "impressions" }, icon: "sparkles" },
      { id: "k2", type: "kpi", title: "総エンゲージ", collection: "posts", span: 1, measure: { kind: "sum", field: "engagements" } },
      { id: "k3", type: "kpi", title: "今月の投稿数", collection: "posts", span: 1, measure: { kind: "count" }, delta: { dateField: "posted_at", period: "month" } },
      { id: "k4", type: "kpi", title: "平均エンゲージ", collection: "posts", span: 1, measure: { kind: "avg", field: "engagements" } },
      {
        id: "s1", type: "area", title: "表示回数の推移", collection: "posts", span: 2,
        dateField: "posted_at", bucket: "week", rangeCount: 9,
        measures: [{ label: "表示", measure: { kind: "sum", field: "impressions" }, color: "khaki" }],
      },
      { id: "b1", type: "hbar", title: "媒体別のエンゲージ", collection: "posts", span: 2, groupBy: "media", measure: { kind: "sum", field: "engagements" }, limit: 4 },
      { id: "b2", type: "donut", title: "媒体別の表示", collection: "posts", span: 2, groupBy: "media", measure: { kind: "sum", field: "impressions" }, limit: 4 },
      { id: "t1", type: "table", title: "直近の投稿", collection: "posts", span: 2, columns: ["title", "media", "impressions", "engagements", "posted_at"], sort: { field: "posted_at", dir: "desc" }, limit: 8 },
    ],
  },
];
