/**
 * Category: 経営・エグゼクティブ (executive) — dashboard templates.
 * Populated to match the shape in ./support.ts (the reference implementation).
 */
import type { DashboardTemplate } from "../widgets";

const KPI_CATEGORY = [
  { label: "財務", value: "finance", color: "success" },
  { label: "顧客", value: "customer", color: "info" },
  { label: "業務", value: "operations", color: "khaki" },
];
const DEPARTMENT = [
  { label: "営業", value: "sales", color: "info" },
  { label: "サポート", value: "support", color: "khaki" },
  { label: "経理", value: "finance", color: "success" },
  { label: "人事", value: "hr", color: "warning" },
];
const REVIEW_TYPE = [
  { label: "実績", value: "result" },
  { label: "課題", value: "issue" },
  { label: "施策", value: "action" },
];
const CUSTOMER_STATUS = [
  { label: "有効", value: "active", color: "success" },
  { label: "休眠", value: "dormant", color: "neutral" },
  { label: "解約", value: "churned", color: "danger" },
];
const CHANNEL = [
  { label: "紹介", value: "referral" },
  { label: "広告", value: "ad" },
  { label: "問い合わせ", value: "inbound" },
  { label: "アウトバウンド", value: "outbound" },
  { label: "イベント", value: "event" },
];

export const executiveTemplates: DashboardTemplate[] = [
  {
    key: "executive-summary",
    category: "executive",
    name: "経営サマリーダッシュボード",
    description: "売上・費用・粗利・新規顧客を月次で追い、経営の全体像を一望。",
    icon: "dashboard",
    color: "khaki",
    collections: [
      {
        name: "月次実績",
        slug: "monthly-results",
        icon: "dashboard",
        color: "khaki",
        sampleRows: 120,
        fields: [
          { key: "period", name: "対象日", type: "date", required: true, sample: { daysBack: 120, trend: "up" } },
          { key: "revenue", name: "売上", type: "currency", required: true, sample: { min: 3000000, max: 12000000 } },
          { key: "cost", name: "費用", type: "currency", required: true, sample: { min: 2000000, max: 8000000 } },
          { key: "gross", name: "粗利", type: "currency", sample: { min: 1000000, max: 5000000 } },
          { key: "new_customers", name: "新規顧客", type: "number", sample: { min: 2, max: 40, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "売上", collection: "monthly-results", span: 1, measure: { kind: "sum", field: "revenue" }, unit: "currency" },
      { id: "k2", type: "kpi", title: "粗利", collection: "monthly-results", span: 1, measure: { kind: "sum", field: "gross" }, unit: "currency" },
      { id: "k3", type: "kpi", title: "費用", collection: "monthly-results", span: 1, measure: { kind: "sum", field: "cost" }, unit: "currency" },
      { id: "k4", type: "kpi", title: "新規顧客", collection: "monthly-results", span: 1, measure: { kind: "sum", field: "new_customers" } },
      {
        id: "s1", type: "area", title: "売上・費用の推移", collection: "monthly-results", span: 2,
        dateField: "period", bucket: "week", rangeCount: 10,
        measures: [
          { label: "売上", measure: { kind: "sum", field: "revenue" }, color: "khaki" },
          { label: "費用", measure: { kind: "sum", field: "cost" }, color: "danger" },
        ],
      },
      {
        id: "s2", type: "bar", title: "月次の粗利", collection: "monthly-results", span: 2,
        dateField: "period", bucket: "month", rangeCount: 6,
        measures: [{ label: "粗利", measure: { kind: "sum", field: "gross" }, color: "success" }],
      },
      { id: "t1", type: "table", title: "月次実績の明細", collection: "monthly-results", span: 4, columns: ["period", "revenue", "cost", "gross", "new_customers"], sort: { field: "period", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "executive-kpi-cockpit",
    category: "executive",
    name: "KPIコックピット",
    description: "財務・顧客・業務の主要指標を実績と目標で並べ、全社KPIを俯瞰。",
    icon: "sparkles",
    color: "info",
    collections: [
      {
        name: "指標",
        slug: "kpis",
        icon: "sparkles",
        color: "info",
        sampleRows: 120,
        fields: [
          { key: "name", name: "指標名", type: "text", required: true },
          { key: "category", name: "カテゴリ", type: "select", required: true, options: KPI_CATEGORY },
          { key: "actual", name: "実績", type: "number", required: true, sample: { min: 40, max: 160, trend: "up" } },
          { key: "target", name: "目標", type: "number", sample: { min: 80, max: 120 } },
          { key: "measured_at", name: "計測日", type: "date", required: true, sample: { daysBack: 90, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "指標数", collection: "kpis", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "平均実績", collection: "kpis", span: 1, measure: { kind: "avg", field: "actual" } },
      { id: "k3", type: "kpi", title: "実績合計", collection: "kpis", span: 1, measure: { kind: "sum", field: "actual" } },
      { id: "k4", type: "kpi", title: "目標合計", collection: "kpis", span: 1, measure: { kind: "sum", field: "target" } },
      {
        id: "s1", type: "line", title: "実績の推移", collection: "kpis", span: 2,
        dateField: "measured_at", bucket: "week", rangeCount: 10,
        measures: [{ label: "平均実績", measure: { kind: "avg", field: "actual" }, color: "info" }],
      },
      { id: "b1", type: "donut", title: "カテゴリ別の内訳", collection: "kpis", span: 1, groupBy: "category", measure: { kind: "count" }, limit: 3 },
      { id: "b2", type: "hbar", title: "指標別の実績", collection: "kpis", span: 1, groupBy: "name", measure: { kind: "sum", field: "actual" }, limit: 6 },
      { id: "t1", type: "table", title: "指標一覧", collection: "kpis", span: 4, columns: ["name", "category", "actual", "target", "measured_at"], sort: { field: "measured_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "executive-weekly-review",
    category: "executive",
    name: "週次経営レビューダッシュボード",
    description: "部門別の実績・課題・施策を週次で集計し、経営会議の論点を整理。",
    icon: "check-square",
    color: "warning",
    collections: [
      {
        name: "レビュー記録",
        slug: "weekly-reviews",
        icon: "check-square",
        color: "warning",
        sampleRows: 150,
        fields: [
          { key: "department", name: "部門", type: "select", required: true, options: DEPARTMENT },
          { key: "type", name: "種別", type: "select", required: true, options: REVIEW_TYPE, sample: { weights: [5, 3, 2] } },
          { key: "count", name: "件数", type: "number", required: true, sample: { min: 1, max: 60, trend: "up" } },
          { key: "recorded_at", name: "記録日", type: "date", required: true, sample: { daysBack: 60, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "総件数", collection: "weekly-reviews", span: 1, measure: { kind: "sum", field: "count" } },
      { id: "k2", type: "kpi", title: "今週の件数", collection: "weekly-reviews", span: 1, measure: { kind: "sum", field: "count" }, delta: { dateField: "recorded_at", period: "week" } },
      { id: "k3", type: "kpi", title: "記録数", collection: "weekly-reviews", span: 1, measure: { kind: "count" } },
      { id: "k4", type: "kpi", title: "平均件数", collection: "weekly-reviews", span: 1, measure: { kind: "avg", field: "count" } },
      { id: "b1", type: "hbar", title: "部門別の件数", collection: "weekly-reviews", span: 2, groupBy: "department", measure: { kind: "sum", field: "count" }, limit: 4 },
      {
        id: "s1", type: "area", title: "件数の推移", collection: "weekly-reviews", span: 2,
        dateField: "recorded_at", bucket: "week", rangeCount: 8,
        measures: [{ label: "件数", measure: { kind: "sum", field: "count" }, color: "khaki" }],
      },
      { id: "t1", type: "table", title: "レビュー記録", collection: "weekly-reviews", span: 4, columns: ["department", "type", "count", "recorded_at"], sort: { field: "recorded_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "executive-customer-growth",
    category: "executive",
    name: "顧客成長ダッシュボード",
    description: "顧客数・MRR・解約をチャネル別に追い、事業の成長トレンドを可視化。",
    icon: "users",
    color: "success",
    collections: [
      {
        name: "顧客",
        slug: "customers",
        icon: "users",
        color: "success",
        sampleRows: 160,
        fields: [
          { key: "company", name: "会社名", type: "text", required: true },
          { key: "mrr", name: "MRR", type: "currency", required: true, sample: { min: 5000, max: 400000 } },
          { key: "status", name: "ステータス", type: "select", required: true, options: CUSTOMER_STATUS, sample: { weights: [7, 2, 1] } },
          { key: "acquired_at", name: "獲得日", type: "date", required: true, sample: { daysBack: 120, trend: "up" } },
          { key: "channel", name: "獲得チャネル", type: "select", options: CHANNEL, sample: { weights: [3, 3, 2, 1, 1] } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "顧客数", collection: "customers", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "MRR", collection: "customers", span: 1, measure: { kind: "sum", field: "mrr" }, unit: "currency", filters: [{ field: "status", op: "eq", value: "active" }] },
      { id: "k3", type: "kpi", title: "解約数", collection: "customers", span: 1, measure: { kind: "count" }, filters: [{ field: "status", op: "eq", value: "churned" }] },
      { id: "k4", type: "kpi", title: "平均MRR", collection: "customers", span: 1, measure: { kind: "avg", field: "mrr" }, unit: "currency" },
      {
        id: "s1", type: "area", title: "顧客獲得の推移", collection: "customers", span: 2,
        dateField: "acquired_at", bucket: "week", rangeCount: 10,
        measures: [{ label: "獲得数", measure: { kind: "count" }, color: "success" }],
      },
      { id: "b1", type: "donut", title: "チャネル別の内訳", collection: "customers", span: 1, groupBy: "channel", measure: { kind: "count" }, limit: 5 },
      { id: "b2", type: "hbar", title: "チャネル別のMRR", collection: "customers", span: 1, groupBy: "channel", measure: { kind: "sum", field: "mrr" }, limit: 5 },
      { id: "t1", type: "table", title: "顧客一覧", collection: "customers", span: 4, columns: ["company", "mrr", "status", "channel", "acquired_at"], sort: { field: "acquired_at", dir: "desc" }, limit: 8 },
    ],
  },
];
