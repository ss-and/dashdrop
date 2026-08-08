/**
 * Category: 経理・財務 (finance)
 *
 * Shape mirrors ./support.ts (the reference implementation): each template is a
 * set of collections (fields + light sample hints) plus a widget layout on a
 * 4-column grid (widget `span` sums to 4 per visual row).
 */
import type { DashboardTemplate } from "../widgets";

const TXN_TYPE = [
  { label: "入金", value: "income", color: "success" },
  { label: "出金", value: "expense", color: "danger" },
];
const CASH_ITEM = [
  { label: "売上", value: "sales" },
  { label: "仕入", value: "purchase" },
  { label: "給与", value: "payroll" },
  { label: "家賃", value: "rent" },
  { label: "経費", value: "expense" },
  { label: "その他", value: "other" },
];
const ACCOUNT = [
  { label: "普通預金", value: "ordinary" },
  { label: "当座預金", value: "current" },
  { label: "現金", value: "cash" },
  { label: "法人カード", value: "card" },
];
const DEPT = [
  { label: "営業部", value: "sales" },
  { label: "開発部", value: "dev" },
  { label: "管理部", value: "admin" },
  { label: "マーケティング部", value: "marketing" },
  { label: "人事部", value: "hr" },
];
const BUDGET_ITEM = [
  { label: "人件費", value: "labor" },
  { label: "外注費", value: "outsourcing" },
  { label: "広告宣伝費", value: "advertising" },
  { label: "地代家賃", value: "rent" },
  { label: "消耗品費", value: "supplies" },
  { label: "その他", value: "other" },
];
const EXPENSE_ITEM = [
  { label: "人件費", value: "labor" },
  { label: "家賃", value: "rent" },
  { label: "広告", value: "advertising" },
  { label: "交通", value: "transport" },
  { label: "備品", value: "supplies" },
  { label: "その他", value: "other" },
];
const PAY_METHOD = [
  { label: "現金", value: "cash" },
  { label: "銀行振込", value: "transfer" },
  { label: "クレジット", value: "credit" },
  { label: "請求書払い", value: "invoice" },
];

export const financeTemplates: DashboardTemplate[] = [
  {
    key: "finance-cashflow",
    category: "finance",
    name: "キャッシュフロー管理ダッシュボード",
    description:
      "入金・出金を科目と口座で追跡し、収支の推移とお金の流れを一目で把握。",
    icon: "table",
    color: "success",
    collections: [
      {
        name: "取引",
        slug: "cash-transactions",
        icon: "table",
        color: "success",
        sampleRows: 160,
        fields: [
          { key: "type", name: "種別", type: "select", required: true, options: TXN_TYPE, sample: { weights: [4, 6] } },
          { key: "item", name: "科目", type: "select", options: CASH_ITEM },
          { key: "amount", name: "金額", type: "currency", required: true, sample: { min: 20000, max: 800000 } },
          { key: "date", name: "日付", type: "date", sample: { daysBack: 60, trend: "up" } },
          { key: "account", name: "口座", type: "select", options: ACCOUNT, sample: { weights: [5, 2, 2, 2] } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "今月の収支", collection: "cash-transactions", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency", delta: { dateField: "date", period: "month" }, icon: "table" },
      { id: "k2", type: "kpi", title: "入金合計", collection: "cash-transactions", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency", filters: [{ field: "type", op: "eq", value: "income" }] },
      { id: "k3", type: "kpi", title: "出金合計", collection: "cash-transactions", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency", filters: [{ field: "type", op: "eq", value: "expense" }] },
      { id: "k4", type: "kpi", title: "平均取引額", collection: "cash-transactions", span: 1, measure: { kind: "avg", field: "amount" }, unit: "currency" },
      {
        id: "s1", type: "area", title: "入金・出金の推移", collection: "cash-transactions", span: 2,
        dateField: "date", bucket: "week", rangeCount: 9,
        measures: [
          { label: "入金", measure: { kind: "sum", field: "amount" }, filters: [{ field: "type", op: "eq", value: "income" }], color: "success" },
          { label: "出金", measure: { kind: "sum", field: "amount" }, filters: [{ field: "type", op: "eq", value: "expense" }], color: "danger" },
        ],
      },
      { id: "b1", type: "donut", title: "科目別の内訳", collection: "cash-transactions", span: 2, groupBy: "item", measure: { kind: "sum", field: "amount" }, limit: 6 },
      { id: "b2", type: "hbar", title: "口座別の残高", collection: "cash-transactions", span: 2, groupBy: "account", measure: { kind: "sum", field: "amount" }, limit: 4 },
      { id: "t1", type: "table", title: "直近の取引", collection: "cash-transactions", span: 2, columns: ["date", "type", "item", "amount", "account"], sort: { field: "date", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "finance-budget",
    category: "finance",
    name: "予実管理ダッシュボード",
    description:
      "部門・科目ごとの予算と実績を比較し、達成率と差異をひと目で確認。",
    icon: "table",
    color: "warning",
    collections: [
      {
        name: "予実",
        slug: "budget-actuals",
        icon: "table",
        color: "warning",
        sampleRows: 120,
        fields: [
          { key: "department", name: "部門", type: "select", required: true, options: DEPT },
          { key: "item", name: "科目", type: "select", options: BUDGET_ITEM },
          { key: "budget", name: "予算", type: "currency", required: true, sample: { min: 300000, max: 2000000 } },
          { key: "actual", name: "実績", type: "currency", required: true, sample: { min: 200000, max: 2200000 } },
          { key: "achieved", name: "目標達成", type: "checkbox", sample: { min: 0.62 } },
          { key: "month", name: "月", type: "date", sample: { daysBack: 120, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "予算合計", collection: "budget-actuals", span: 1, measure: { kind: "sum", field: "budget" }, unit: "currency", icon: "table" },
      { id: "k2", type: "kpi", title: "実績合計", collection: "budget-actuals", span: 1, measure: { kind: "sum", field: "actual" }, unit: "currency" },
      { id: "k3", type: "kpi", title: "達成率", collection: "budget-actuals", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "achieved", op: "truthy" }] },
      { id: "k4", type: "kpi", title: "今月の実績", collection: "budget-actuals", span: 1, measure: { kind: "sum", field: "actual" }, unit: "currency", delta: { dateField: "month", period: "month" } },
      {
        id: "s1", type: "bar", title: "月次の予算と実績", collection: "budget-actuals", span: 2,
        dateField: "month", bucket: "month", rangeCount: 6,
        measures: [
          { label: "予算", measure: { kind: "sum", field: "budget" }, color: "khaki" },
          { label: "実績", measure: { kind: "sum", field: "actual" }, color: "success" },
        ],
      },
      { id: "b1", type: "donut", title: "科目別の実績", collection: "budget-actuals", span: 2, groupBy: "item", measure: { kind: "sum", field: "actual" }, limit: 6 },
      { id: "b2", type: "hbar", title: "部門別の実績", collection: "budget-actuals", span: 2, groupBy: "department", measure: { kind: "sum", field: "actual" }, limit: 5 },
      { id: "t1", type: "table", title: "予実明細", collection: "budget-actuals", span: 2, columns: ["month", "department", "item", "budget", "actual"], sort: { field: "month", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "finance-expense",
    category: "finance",
    name: "経費分析ダッシュボード",
    description:
      "部門・科目・支払方法の切り口で経費を分解し、コストの内訳と推移を可視化。",
    icon: "table",
    color: "warning",
    collections: [
      {
        name: "経費",
        slug: "expenses",
        icon: "table",
        color: "warning",
        sampleRows: 150,
        fields: [
          { key: "department", name: "部門", type: "select", required: true, options: DEPT },
          { key: "item", name: "科目", type: "select", required: true, options: EXPENSE_ITEM, sample: { weights: [4, 3, 3, 2, 2, 1] } },
          { key: "amount", name: "金額", type: "currency", required: true, sample: { min: 3000, max: 300000 } },
          { key: "date", name: "日付", type: "date", sample: { daysBack: 60, trend: "up" } },
          { key: "method", name: "支払方法", type: "select", options: PAY_METHOD, sample: { weights: [2, 4, 3, 2] } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "今月の経費", collection: "expenses", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency", delta: { dateField: "date", period: "month" }, icon: "table" },
      { id: "k2", type: "kpi", title: "経費合計", collection: "expenses", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency" },
      { id: "k3", type: "kpi", title: "平均経費", collection: "expenses", span: 1, measure: { kind: "avg", field: "amount" }, unit: "currency" },
      { id: "k4", type: "kpi", title: "経費件数", collection: "expenses", span: 1, measure: { kind: "count" } },
      {
        id: "s1", type: "area", title: "経費の推移", collection: "expenses", span: 2,
        dateField: "date", bucket: "week", rangeCount: 9,
        measures: [{ label: "経費", measure: { kind: "sum", field: "amount" }, color: "warning" }],
      },
      { id: "b1", type: "donut", title: "科目別の内訳", collection: "expenses", span: 2, groupBy: "item", measure: { kind: "sum", field: "amount" }, limit: 6 },
      { id: "b2", type: "hbar", title: "部門別の経費", collection: "expenses", span: 2, groupBy: "department", measure: { kind: "sum", field: "amount" }, limit: 5 },
      { id: "t1", type: "table", title: "直近の経費", collection: "expenses", span: 2, columns: ["date", "department", "item", "amount", "method"], sort: { field: "date", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "finance-pl",
    category: "finance",
    name: "損益(P/L)サマリーダッシュボード",
    description:
      "売上・原価・販管費・営業利益を月次で集計し、収益性の推移を一枚で把握。",
    icon: "table",
    color: "success",
    collections: [
      {
        name: "月次損益",
        slug: "pl-monthly",
        icon: "table",
        color: "success",
        sampleRows: 90,
        fields: [
          { key: "month", name: "月", type: "date", sample: { daysBack: 120, trend: "up" } },
          { key: "revenue", name: "売上", type: "currency", required: true, sample: { min: 2000000, max: 6000000 } },
          { key: "cogs", name: "売上原価", type: "currency", required: true, sample: { min: 800000, max: 3000000 } },
          { key: "sga", name: "販管費", type: "currency", required: true, sample: { min: 500000, max: 1800000 } },
          { key: "operating_profit", name: "営業利益", type: "currency", required: true, sample: { min: 100000, max: 1500000 } },
          { key: "gross_margin", name: "粗利率", type: "number", sample: { min: 32, max: 58 } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "売上合計", collection: "pl-monthly", span: 1, measure: { kind: "sum", field: "revenue" }, unit: "currency", icon: "table" },
      { id: "k2", type: "kpi", title: "営業利益", collection: "pl-monthly", span: 1, measure: { kind: "sum", field: "operating_profit" }, unit: "currency" },
      { id: "k3", type: "kpi", title: "粗利率", collection: "pl-monthly", span: 1, measure: { kind: "avg", field: "gross_margin" }, unit: "percent", target: 45 },
      { id: "k4", type: "kpi", title: "販管費合計", collection: "pl-monthly", span: 1, measure: { kind: "sum", field: "sga" }, unit: "currency" },
      {
        id: "s1", type: "area", title: "売上と営業利益の推移", collection: "pl-monthly", span: 2,
        dateField: "month", bucket: "month", rangeCount: 6,
        measures: [
          { label: "売上", measure: { kind: "sum", field: "revenue" }, color: "khaki" },
          { label: "営業利益", measure: { kind: "sum", field: "operating_profit" }, color: "success" },
        ],
      },
      {
        id: "s2", type: "bar", title: "月次の営業利益", collection: "pl-monthly", span: 2,
        dateField: "month", bucket: "month", rangeCount: 6,
        measures: [{ label: "営業利益", measure: { kind: "sum", field: "operating_profit" }, color: "info" }],
      },
      { id: "t1", type: "table", title: "月次損益明細", collection: "pl-monthly", span: 4, columns: ["month", "revenue", "cogs", "sga", "operating_profit"], sort: { field: "month", dir: "desc" }, limit: 8 },
    ],
  },
];
