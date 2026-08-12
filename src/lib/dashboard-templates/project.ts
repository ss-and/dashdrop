/**
 * Category: プロジェクト・受託 (project) — dashboard templates.
 * Populated to match the shape in ./support.ts (the reference implementation).
 */
import type { DashboardTemplate } from "../widgets";

const PROJECT_TYPE = [
  { label: "システム開発", value: "development" },
  { label: "保守運用", value: "maintenance" },
  { label: "コンサルティング", value: "consulting" },
  { label: "デザイン制作", value: "design" },
  { label: "SES・常駐", value: "ses" },
];
const PROJECT_STATE = [
  { label: "提案中", value: "proposal", color: "neutral" },
  { label: "進行中", value: "in_progress", color: "info" },
  { label: "検収待ち", value: "review", color: "warning" },
  { label: "完了", value: "done", color: "success" },
  { label: "中止", value: "cancelled", color: "danger" },
];
const HEALTH = [
  { label: "順調", value: "green", color: "success" },
  { label: "注意", value: "yellow", color: "warning" },
  { label: "危険", value: "red", color: "danger" },
];
const TASK_TYPE = [
  { label: "要件定義", value: "requirements" },
  { label: "設計", value: "design" },
  { label: "実装", value: "implementation" },
  { label: "テスト", value: "test" },
  { label: "打合せ", value: "meeting" },
  { label: "その他", value: "other" },
];

export const projectTemplates: DashboardTemplate[] = [
  {
    key: "project-profitability",
    category: "project",
    name: "プロジェクト採算ダッシュボード",
    description:
      "受託・制作会社向けに、案件ごとの契約額と原価・粗利率を並べて赤字案件を早期に発見。",
    icon: "dashboard",
    color: "khaki",
    collections: [
      {
        name: "プロジェクト",
        slug: "engagements",
        icon: "dashboard",
        color: "khaki",
        sampleRows: 90,
        fields: [
          { key: "project_name", name: "案件名", type: "text", required: true },
          { key: "client", name: "取引先", type: "text" },
          { key: "project_type", name: "案件種別", type: "select", required: true, options: PROJECT_TYPE, sample: { weights: [5, 4, 3, 3, 3] } },
          { key: "state", name: "状態", type: "select", required: true, options: PROJECT_STATE, sample: { weights: [2, 5, 3, 5, 1] } },
          { key: "health", name: "健全度", type: "select", options: HEALTH, sample: { weights: [6, 3, 1] } },
          { key: "contract_amount", name: "契約額", type: "currency", required: true, sample: { min: 600000, max: 32000000 } },
          { key: "cost_amount", name: "発生原価", type: "currency", sample: { min: 300000, max: 26000000 } },
          { key: "margin_rate", name: "粗利率(%)", type: "number", sample: { min: -8, max: 52 } },
          { key: "started_at", name: "開始日", type: "date", required: true, sample: { daysBack: 240, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "契約額合計", collection: "engagements", span: 1, measure: { kind: "sum", field: "contract_amount" }, unit: "currency" },
      { id: "k2", type: "kpi", title: "発生原価合計", collection: "engagements", span: 1, measure: { kind: "sum", field: "cost_amount" }, unit: "currency" },
      { id: "k3", type: "kpi", title: "平均粗利率", collection: "engagements", span: 1, measure: { kind: "avg", field: "margin_rate" }, unit: "percent" },
      { id: "k4", type: "kpi", title: "赤字案件の割合", collection: "engagements", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "margin_rate", op: "lt", value: 10 }] },
      {
        id: "s1", type: "bar", title: "契約額と原価の推移", collection: "engagements", span: 2,
        dateField: "started_at", bucket: "month", rangeCount: 8,
        measures: [
          { label: "契約額", measure: { kind: "sum", field: "contract_amount" }, color: "khaki" },
          { label: "発生原価", measure: { kind: "sum", field: "cost_amount" }, color: "warning" },
        ],
      },
      { id: "b1", type: "donut", title: "案件種別の内訳", collection: "engagements", span: 1, groupBy: "project_type", measure: { kind: "sum", field: "contract_amount" }, limit: 5 },
      { id: "b2", type: "hbar", title: "状態別の案件数", collection: "engagements", span: 1, groupBy: "state", measure: { kind: "count" }, limit: 5 },
      { id: "t1", type: "table", title: "粗利率の低い案件", collection: "engagements", span: 4, columns: ["project_name", "client", "project_type", "state", "health", "contract_amount", "cost_amount", "margin_rate"], sort: { field: "margin_rate", dir: "asc" }, limit: 8 },
    ],
  },

  {
    key: "project-workload",
    category: "project",
    name: "稼働工数ダッシュボード",
    description:
      "メンバーごとの作業工数と請求対象比率を集計し、稼働の偏りと未請求工数を把握。",
    icon: "check-square",
    color: "info",
    collections: [
      {
        name: "工数記録",
        slug: "timesheets",
        icon: "check-square",
        color: "info",
        sampleRows: 120,
        fields: [
          { key: "member", name: "担当者", type: "text" },
          { key: "project_name", name: "案件名", type: "text", required: true },
          { key: "task_type", name: "作業種別", type: "select", required: true, options: TASK_TYPE, sample: { weights: [2, 3, 6, 3, 3, 1] } },
          { key: "hours", name: "工数(時間)", type: "number", required: true, sample: { min: 1, max: 9 } },
          { key: "is_billable", name: "請求対象", type: "checkbox", sample: { min: 0.72 } },
          { key: "unit_price", name: "時間単価", type: "currency", sample: { min: 4000, max: 14000 } },
          { key: "worked_at", name: "作業日", type: "date", required: true, sample: { daysBack: 60, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "総工数(時間)", collection: "timesheets", span: 1, measure: { kind: "sum", field: "hours" } },
      { id: "k2", type: "kpi", title: "今週の工数", collection: "timesheets", span: 1, measure: { kind: "sum", field: "hours" }, delta: { dateField: "worked_at", period: "week" } },
      { id: "k3", type: "kpi", title: "請求対象比率", collection: "timesheets", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "is_billable", op: "truthy" }] },
      { id: "k4", type: "kpi", title: "平均時間単価", collection: "timesheets", span: 1, measure: { kind: "avg", field: "unit_price" }, unit: "currency" },
      {
        id: "s1", type: "area", title: "請求対象・対象外の工数推移", collection: "timesheets", span: 2,
        dateField: "worked_at", bucket: "week", rangeCount: 10, stacked: true,
        measures: [
          { label: "請求対象", measure: { kind: "sum", field: "hours" }, filters: [{ field: "is_billable", op: "truthy" }], color: "success" },
          { label: "対象外", measure: { kind: "sum", field: "hours" }, filters: [{ field: "is_billable", op: "falsy" }], color: "neutral" },
        ],
      },
      { id: "b1", type: "hbar", title: "担当者別の工数", collection: "timesheets", span: 1, groupBy: "member", measure: { kind: "sum", field: "hours" }, limit: 8 },
      { id: "b2", type: "donut", title: "作業種別の内訳", collection: "timesheets", span: 1, groupBy: "task_type", measure: { kind: "sum", field: "hours" }, limit: 6 },
      { id: "t1", type: "table", title: "直近の工数記録", collection: "timesheets", span: 4, columns: ["worked_at", "member", "project_name", "task_type", "hours", "is_billable", "unit_price"], sort: { field: "worked_at", dir: "desc" }, limit: 8 },
    ],
  },
];
