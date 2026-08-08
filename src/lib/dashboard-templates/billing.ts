/**
 * Category: 請求・支払 (billing) — dashboard templates.
 * Populated to match the shape in ./support.ts (the reference implementation).
 */
import type { DashboardTemplate } from "../widgets";

const INVOICE_STATUS = [
  { label: "未送付", value: "draft", color: "neutral" },
  { label: "送付済", value: "sent", color: "info" },
  { label: "入金済", value: "paid", color: "success" },
  { label: "延滞", value: "overdue", color: "danger" },
];
const PAY_METHOD = [
  { label: "銀行振込", value: "bank" },
  { label: "クレジットカード", value: "card" },
  { label: "現金", value: "cash" },
];
const PLAN = [
  { label: "ライト", value: "light" },
  { label: "スタンダード", value: "standard" },
  { label: "プロ", value: "pro" },
  { label: "エンタープライズ", value: "enterprise" },
];
const CONTRACT_STATUS = [
  { label: "有効", value: "active", color: "success" },
  { label: "解約", value: "churned", color: "danger" },
];
const EXPENSE_ITEM = [
  { label: "交通費", value: "transport" },
  { label: "接待", value: "entertainment" },
  { label: "備品", value: "supplies" },
  { label: "その他", value: "other" },
];
const EXPENSE_STATE = [
  { label: "申請中", value: "pending", color: "warning" },
  { label: "承認", value: "approved", color: "success" },
  { label: "却下", value: "rejected", color: "danger" },
];

export const billingTemplates: DashboardTemplate[] = [
  {
    key: "billing-invoices",
    category: "billing",
    name: "請求書管理ダッシュボード",
    description: "請求書のステータス・入金状況・延滞を追跡し、未入金額を可視化。",
    icon: "download",
    color: "info",
    collections: [
      {
        name: "請求書",
        slug: "invoices",
        icon: "download",
        color: "info",
        sampleRows: 150,
        fields: [
          { key: "account", name: "取引先", type: "text", required: true },
          { key: "amount", name: "請求額", type: "currency", required: true, sample: { min: 50000, max: 3000000 } },
          { key: "status", name: "ステータス", type: "select", required: true, options: INVOICE_STATUS, sample: { weights: [2, 3, 6, 1] } },
          { key: "issued_at", name: "発行日", type: "date", required: true, sample: { daysBack: 90, trend: "up" } },
          { key: "due_at", name: "支払期限", type: "date", sample: { daysBack: 30, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "今月の請求額", collection: "invoices", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency", delta: { dateField: "issued_at", period: "month" }, icon: "download" },
      { id: "k2", type: "kpi", title: "入金済率", collection: "invoices", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "status", op: "eq", value: "paid" }] },
      { id: "k3", type: "kpi", title: "未入金額", collection: "invoices", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency", filters: [{ field: "status", op: "in", value: ["sent", "overdue"] }] },
      { id: "k4", type: "kpi", title: "延滞件数", collection: "invoices", span: 1, measure: { kind: "count" }, filters: [{ field: "status", op: "eq", value: "overdue" }] },
      {
        id: "s1", type: "area", title: "請求額の推移", collection: "invoices", span: 2,
        dateField: "issued_at", bucket: "week", rangeCount: 10,
        measures: [{ label: "請求額", measure: { kind: "sum", field: "amount" }, color: "khaki" }],
      },
      { id: "b1", type: "donut", title: "ステータス別の内訳", collection: "invoices", span: 1, groupBy: "status", measure: { kind: "count" }, limit: 4 },
      { id: "b2", type: "hbar", title: "取引先別の金額", collection: "invoices", span: 1, groupBy: "account", measure: { kind: "sum", field: "amount" }, limit: 6 },
      { id: "t1", type: "table", title: "未入金一覧", collection: "invoices", span: 4, filters: [{ field: "status", op: "in", value: ["sent", "overdue"] }], columns: ["account", "amount", "status", "issued_at", "due_at"], sort: { field: "due_at", dir: "asc" }, limit: 8 },
    ],
  },

  {
    key: "billing-receivables",
    category: "billing",
    name: "入金・売掛金ダッシュボード",
    description: "入金実績を推移・方法・取引先別に集計し、売掛金の回収状況を把握。",
    icon: "check-square",
    color: "success",
    collections: [
      {
        name: "入金",
        slug: "payments",
        icon: "check-square",
        color: "success",
        sampleRows: 160,
        fields: [
          { key: "account", name: "取引先", type: "text", required: true },
          { key: "amount", name: "入金額", type: "currency", required: true, sample: { min: 50000, max: 3000000 } },
          { key: "paid_at", name: "入金日", type: "date", required: true, sample: { daysBack: 90, trend: "up" } },
          { key: "method", name: "入金方法", type: "select", options: PAY_METHOD, sample: { weights: [6, 3, 1] } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "入金総額", collection: "payments", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency" },
      { id: "k2", type: "kpi", title: "今月の入金", collection: "payments", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency", delta: { dateField: "paid_at", period: "month" } },
      { id: "k3", type: "kpi", title: "入金件数", collection: "payments", span: 1, measure: { kind: "count" } },
      { id: "k4", type: "kpi", title: "平均入金額", collection: "payments", span: 1, measure: { kind: "avg", field: "amount" }, unit: "currency" },
      {
        id: "s1", type: "bar", title: "入金の推移", collection: "payments", span: 2,
        dateField: "paid_at", bucket: "month", rangeCount: 6,
        measures: [{ label: "入金額", measure: { kind: "sum", field: "amount" }, color: "success" }],
      },
      { id: "b1", type: "donut", title: "方法別の内訳", collection: "payments", span: 1, groupBy: "method", measure: { kind: "count" }, limit: 3 },
      { id: "b2", type: "hbar", title: "取引先別の入金額", collection: "payments", span: 1, groupBy: "account", measure: { kind: "sum", field: "amount" }, limit: 6 },
      { id: "t1", type: "table", title: "直近の入金", collection: "payments", span: 4, columns: ["account", "amount", "method", "paid_at"], sort: { field: "paid_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "billing-subscriptions",
    category: "billing",
    name: "サブスク・継続課金ダッシュボード",
    description: "MRR・解約率・ARPUを追跡し、プラン別の継続課金状況を可視化。",
    icon: "sparkles",
    color: "khaki",
    collections: [
      {
        name: "契約",
        slug: "contracts",
        icon: "sparkles",
        color: "khaki",
        sampleRows: 140,
        fields: [
          { key: "customer", name: "顧客", type: "text", required: true },
          { key: "plan", name: "プラン", type: "select", required: true, options: PLAN, sample: { weights: [4, 5, 3, 1] } },
          { key: "mrr", name: "月額", type: "currency", required: true, sample: { min: 5000, max: 300000 } },
          { key: "status", name: "ステータス", type: "select", required: true, options: CONTRACT_STATUS, sample: { weights: [8, 2] } },
          { key: "started_at", name: "開始日", type: "date", required: true, sample: { daysBack: 120, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "MRR", collection: "contracts", span: 1, measure: { kind: "sum", field: "mrr" }, unit: "currency", filters: [{ field: "status", op: "eq", value: "active" }] },
      { id: "k2", type: "kpi", title: "解約率", collection: "contracts", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "status", op: "eq", value: "churned" }] },
      { id: "k3", type: "kpi", title: "契約数", collection: "contracts", span: 1, measure: { kind: "count" }, filters: [{ field: "status", op: "eq", value: "active" }] },
      { id: "k4", type: "kpi", title: "ARPU", collection: "contracts", span: 1, measure: { kind: "avg", field: "mrr" }, unit: "currency" },
      {
        id: "s1", type: "area", title: "MRRの推移", collection: "contracts", span: 2,
        dateField: "started_at", bucket: "month", rangeCount: 6,
        measures: [{ label: "MRR", measure: { kind: "sum", field: "mrr" }, filters: [{ field: "status", op: "eq", value: "active" }], color: "khaki" }],
      },
      { id: "b1", type: "donut", title: "プラン別の内訳", collection: "contracts", span: 2, groupBy: "plan", measure: { kind: "sum", field: "mrr" }, limit: 4 },
      { id: "t1", type: "table", title: "契約一覧", collection: "contracts", span: 4, columns: ["customer", "plan", "mrr", "status", "started_at"], sort: { field: "started_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "billing-expenses",
    category: "billing",
    name: "経費精算ダッシュボード",
    description: "経費申請を科目・申請者別に集計し、承認待ちと月次の支出を把握。",
    icon: "inbox",
    color: "warning",
    collections: [
      {
        name: "経費申請",
        slug: "expenses",
        icon: "inbox",
        color: "warning",
        sampleRows: 150,
        fields: [
          { key: "applicant", name: "申請者", type: "text", required: true },
          { key: "item", name: "科目", type: "select", required: true, options: EXPENSE_ITEM, sample: { weights: [5, 2, 3, 1] } },
          { key: "amount", name: "金額", type: "currency", required: true, sample: { min: 1000, max: 200000 } },
          { key: "state", name: "状態", type: "select", required: true, options: EXPENSE_STATE, sample: { weights: [3, 6, 1] } },
          { key: "applied_at", name: "申請日", type: "date", required: true, sample: { daysBack: 90, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "今月の経費", collection: "expenses", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency", delta: { dateField: "applied_at", period: "month" }, icon: "inbox" },
      { id: "k2", type: "kpi", title: "承認待ち件数", collection: "expenses", span: 1, measure: { kind: "count" }, filters: [{ field: "state", op: "eq", value: "pending" }] },
      { id: "k3", type: "kpi", title: "承認率", collection: "expenses", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "state", op: "eq", value: "approved" }] },
      { id: "k4", type: "kpi", title: "経費総額", collection: "expenses", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency" },
      {
        id: "s1", type: "bar", title: "月次の経費", collection: "expenses", span: 2,
        dateField: "applied_at", bucket: "month", rangeCount: 6,
        measures: [{ label: "経費", measure: { kind: "sum", field: "amount" }, color: "warning" }],
      },
      { id: "b1", type: "donut", title: "科目別の内訳", collection: "expenses", span: 1, groupBy: "item", measure: { kind: "sum", field: "amount" }, limit: 4 },
      { id: "b2", type: "hbar", title: "申請者別の金額", collection: "expenses", span: 1, groupBy: "applicant", measure: { kind: "sum", field: "amount" }, limit: 6 },
      { id: "t1", type: "table", title: "承認待ちの申請", collection: "expenses", span: 4, filters: [{ field: "state", op: "eq", value: "pending" }], columns: ["applicant", "item", "amount", "state", "applied_at"], sort: { field: "applied_at", dir: "desc" }, limit: 8 },
    ],
  },
];
