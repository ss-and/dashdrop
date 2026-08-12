/**
 * Category: 建設・工事 (construction) — dashboard templates.
 * Populated to match the shape in ./support.ts (the reference implementation).
 */
import type { DashboardTemplate } from "../widgets";

const WORK_TYPE = [
  { label: "新築", value: "new_build" },
  { label: "リフォーム", value: "renovation" },
  { label: "外構", value: "exterior" },
  { label: "設備工事", value: "facility" },
  { label: "メンテナンス", value: "maintenance" },
];
const PROJECT_PHASE = [
  { label: "見積", value: "estimate", color: "neutral" },
  { label: "契約", value: "contract", color: "info" },
  { label: "着工", value: "started", color: "warning" },
  { label: "施工中", value: "in_progress", color: "khaki" },
  { label: "完工", value: "completed", color: "success" },
];
const SITE = [
  { label: "A現場", value: "site_a" },
  { label: "B現場", value: "site_b" },
  { label: "C現場", value: "site_c" },
  { label: "D現場", value: "site_d" },
  { label: "E現場", value: "site_e" },
];
const INCIDENT_TYPE = [
  { label: "ヒヤリハット", value: "near_miss", color: "warning" },
  { label: "軽微な負傷", value: "minor", color: "danger" },
  { label: "物損", value: "property", color: "info" },
  { label: "設備トラブル", value: "equipment", color: "neutral" },
];
const SEVERITY = [
  { label: "低", value: "low", color: "success" },
  { label: "中", value: "mid", color: "warning" },
  { label: "高", value: "high", color: "danger" },
];
const FOREMAN = ["大工原", "土屋", "菅野", "川口", "服部", "堀内"];

export const constructionTemplates: DashboardTemplate[] = [
  {
    key: "construction-projects",
    category: "construction",
    name: "工事案件進捗ダッシュボード",
    description:
      "工務店・建設会社向けに、工事案件の進捗フェーズ・受注金額・粗利を一覧で管理。",
    icon: "check-square",
    color: "khaki",
    collections: [
      {
        name: "工事案件",
        slug: "projects",
        icon: "check-square",
        color: "khaki",
        sampleRows: 100,
        fields: [
          { key: "project_name", name: "工事名", type: "text", required: true },
          { key: "client", name: "施主", type: "text" },
          { key: "work_type", name: "工種", type: "select", required: true, options: WORK_TYPE, sample: { weights: [3, 5, 3, 3, 2] } },
          { key: "phase", name: "進捗", type: "select", required: true, options: PROJECT_PHASE, sample: { weights: [3, 3, 3, 4, 4] } },
          { key: "contract_amount", name: "受注金額", type: "currency", required: true, sample: { min: 900000, max: 42000000 } },
          { key: "cost_amount", name: "実行原価", type: "currency", sample: { min: 600000, max: 33000000 } },
          { key: "gross_margin", name: "粗利率(%)", type: "number", sample: { min: 4, max: 34 } },
          { key: "foreman", name: "現場監督", type: "text", sample: { pool: FOREMAN } },
          { key: "started_at", name: "着工日", type: "date", required: true, sample: { daysBack: 180, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "受注金額合計", collection: "projects", span: 1, measure: { kind: "sum", field: "contract_amount" }, unit: "currency" },
      { id: "k2", type: "kpi", title: "実行原価合計", collection: "projects", span: 1, measure: { kind: "sum", field: "cost_amount" }, unit: "currency" },
      { id: "k3", type: "kpi", title: "平均粗利率", collection: "projects", span: 1, measure: { kind: "avg", field: "gross_margin" }, unit: "percent" },
      { id: "k4", type: "kpi", title: "施工中の案件数", collection: "projects", span: 1, measure: { kind: "count" }, filters: [{ field: "phase", op: "in", value: ["started", "in_progress"] }] },
      {
        id: "s1", type: "bar", title: "月次の受注金額", collection: "projects", span: 2,
        dateField: "started_at", bucket: "month", rangeCount: 6,
        measures: [
          { label: "受注金額", measure: { kind: "sum", field: "contract_amount" }, color: "khaki" },
          { label: "実行原価", measure: { kind: "sum", field: "cost_amount" }, color: "warning" },
        ],
      },
      { id: "b1", type: "donut", title: "進捗フェーズ別の件数", collection: "projects", span: 1, groupBy: "phase", measure: { kind: "count" }, limit: 5 },
      { id: "b2", type: "hbar", title: "工種別の受注金額", collection: "projects", span: 1, groupBy: "work_type", measure: { kind: "sum", field: "contract_amount" }, limit: 5 },
      { id: "b3", type: "hbar", title: "現場監督別の担当件数", collection: "projects", span: 2, groupBy: "foreman", measure: { kind: "count" }, limit: 6 },
      { id: "t1", type: "table", title: "受注金額の大きい案件", collection: "projects", span: 4, columns: ["project_name", "client", "work_type", "phase", "contract_amount", "gross_margin", "foreman", "started_at"], sort: { field: "contract_amount", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "construction-safety",
    category: "construction",
    name: "現場安全管理ダッシュボード",
    description:
      "現場ごとのヒヤリハット・事故報告を重大度別に集計し、安全パトロールの成果を確認。",
    icon: "report",
    color: "danger",
    collections: [
      {
        name: "安全報告",
        slug: "safety-reports",
        icon: "report",
        color: "danger",
        sampleRows: 90,
        fields: [
          { key: "title", name: "報告件名", type: "text", required: true },
          { key: "site", name: "現場", type: "select", required: true, options: SITE },
          { key: "incident_type", name: "区分", type: "select", required: true, options: INCIDENT_TYPE, sample: { weights: [6, 2, 2, 2] } },
          { key: "severity", name: "重大度", type: "select", options: SEVERITY, sample: { weights: [6, 3, 1] } },
          { key: "lost_hours", name: "作業停止時間", type: "number", sample: { min: 0, max: 16 } },
          { key: "is_countermeasured", name: "是正済", type: "checkbox", sample: { min: 0.65 } },
          { key: "reporter", name: "報告者", type: "text", sample: { pool: FOREMAN } },
          { key: "occurred_at", name: "発生日", type: "date", required: true, sample: { daysBack: 120, trend: "down" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "報告件数", collection: "safety-reports", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "是正完了率", collection: "safety-reports", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "is_countermeasured", op: "truthy" }] },
      { id: "k3", type: "kpi", title: "重大度「高」の件数", collection: "safety-reports", span: 1, measure: { kind: "count" }, filters: [{ field: "severity", op: "eq", value: "high" }] },
      { id: "k4", type: "kpi", title: "作業停止時間の合計", collection: "safety-reports", span: 1, measure: { kind: "sum", field: "lost_hours" } },
      {
        id: "s1", type: "line", title: "報告件数の推移", collection: "safety-reports", span: 2,
        dateField: "occurred_at", bucket: "week", rangeCount: 12,
        measures: [
          { label: "全報告", measure: { kind: "count" }, color: "info" },
          { label: "重大度「高」", measure: { kind: "count" }, filters: [{ field: "severity", op: "eq", value: "high" }], color: "danger" },
        ],
      },
      { id: "b1", type: "donut", title: "区分別の内訳", collection: "safety-reports", span: 1, groupBy: "incident_type", measure: { kind: "count" }, limit: 4 },
      { id: "b2", type: "hbar", title: "現場別の報告件数", collection: "safety-reports", span: 1, groupBy: "site", measure: { kind: "count" }, limit: 5 },
      { id: "t1", type: "table", title: "未是正の報告", collection: "safety-reports", span: 4, columns: ["occurred_at", "title", "site", "incident_type", "severity", "lost_hours", "reporter"], sort: { field: "occurred_at", dir: "desc" }, limit: 8, filters: [{ field: "is_countermeasured", op: "falsy" }] },
    ],
  },
];
