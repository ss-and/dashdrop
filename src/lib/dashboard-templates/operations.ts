/**
 * Category: 業務・オペレーション (operations) — dashboard templates.
 * Populated to match the shape in ./support.ts (the reference implementation).
 */
import type { DashboardTemplate } from "../widgets";

const INV_CATEGORY = [
  { label: "原材料", value: "material" },
  { label: "部品", value: "parts" },
  { label: "完成品", value: "finished" },
  { label: "消耗品", value: "consumable" },
  { label: "梱包資材", value: "packaging" },
];
const PO_STATE = [
  { label: "発注", value: "ordered", color: "info" },
  { label: "入荷待ち", value: "awaiting", color: "warning" },
  { label: "入荷済", value: "received", color: "success" },
];
const PROCESS = [
  { label: "設計", value: "design" },
  { label: "調達", value: "procurement" },
  { label: "施工", value: "construction" },
  { label: "検査", value: "inspection" },
  { label: "引渡", value: "handover" },
];
const TASK_STATE = [
  { label: "未着手", value: "not_started", color: "neutral" },
  { label: "進行中", value: "in_progress", color: "warning" },
  { label: "完了", value: "done", color: "success" },
];

export const operationsTemplates: DashboardTemplate[] = [
  {
    key: "operations-inventory",
    category: "operations",
    name: "在庫管理ダッシュボード",
    description: "品目ごとの在庫数・適正在庫・評価額を追跡し、欠品リスクを可視化。",
    icon: "table",
    color: "khaki",
    collections: [
      {
        name: "在庫品目",
        slug: "inventory",
        icon: "table",
        color: "khaki",
        sampleRows: 120,
        fields: [
          { key: "name", name: "品名", type: "text", required: true },
          { key: "category", name: "カテゴリ", type: "select", required: true, options: INV_CATEGORY },
          { key: "stock", name: "在庫数", type: "number", required: true, sample: { min: 0, max: 400 } },
          { key: "optimal", name: "適正在庫", type: "number", sample: { min: 50, max: 200 } },
          { key: "unit_price", name: "単価", type: "currency", sample: { min: 100, max: 50000 } },
          { key: "restocked_at", name: "入荷日", type: "date", sample: { daysBack: 60, trend: "down" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "品目数", collection: "inventory", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "在庫評価額", collection: "inventory", span: 1, measure: { kind: "sum", field: "unit_price" }, unit: "currency" },
      { id: "k3", type: "kpi", title: "欠品リスク数", collection: "inventory", span: 1, measure: { kind: "count" }, filters: [{ field: "stock", op: "lt", value: 30 }] },
      { id: "k4", type: "kpi", title: "平均在庫数", collection: "inventory", span: 1, measure: { kind: "avg", field: "stock" } },
      { id: "b1", type: "hbar", title: "カテゴリ別の在庫数", collection: "inventory", span: 2, groupBy: "category", measure: { kind: "sum", field: "stock" }, limit: 5 },
      { id: "b2", type: "donut", title: "カテゴリ別の品目数", collection: "inventory", span: 2, groupBy: "category", measure: { kind: "count" }, limit: 5 },
      { id: "t1", type: "table", title: "発注推奨(在庫少)", collection: "inventory", span: 4, columns: ["name", "category", "stock", "optimal", "unit_price", "restocked_at"], sort: { field: "stock", dir: "asc" }, limit: 8 },
    ],
  },

  {
    key: "operations-orders",
    category: "operations",
    name: "受発注管理ダッシュボード",
    description: "仕入先への発注を状態・金額別に追跡し、入荷待ちと発注額の推移を把握。",
    icon: "download",
    color: "info",
    collections: [
      {
        name: "発注",
        slug: "purchase-orders",
        icon: "download",
        color: "info",
        sampleRows: 150,
        fields: [
          { key: "supplier", name: "仕入先", type: "text", required: true },
          { key: "item", name: "品目", type: "text", required: true },
          { key: "qty", name: "数量", type: "number", sample: { min: 1, max: 500 } },
          { key: "amount", name: "金額", type: "currency", required: true, sample: { min: 10000, max: 2000000 } },
          { key: "state", name: "状態", type: "select", required: true, options: PO_STATE, sample: { weights: [3, 3, 6] } },
          { key: "ordered_at", name: "発注日", type: "date", required: true, sample: { daysBack: 90, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "発注総額", collection: "purchase-orders", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency" },
      { id: "k2", type: "kpi", title: "今月の発注", collection: "purchase-orders", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency", delta: { dateField: "ordered_at", period: "month" } },
      { id: "k3", type: "kpi", title: "入荷待ち件数", collection: "purchase-orders", span: 1, measure: { kind: "count" }, filters: [{ field: "state", op: "eq", value: "awaiting" }] },
      { id: "k4", type: "kpi", title: "発注件数", collection: "purchase-orders", span: 1, measure: { kind: "count" } },
      {
        id: "s1", type: "area", title: "発注額の推移", collection: "purchase-orders", span: 2,
        dateField: "ordered_at", bucket: "week", rangeCount: 10,
        measures: [{ label: "発注額", measure: { kind: "sum", field: "amount" }, color: "khaki" }],
      },
      { id: "b1", type: "donut", title: "状態別の内訳", collection: "purchase-orders", span: 1, groupBy: "state", measure: { kind: "count" }, limit: 3 },
      { id: "b2", type: "hbar", title: "仕入先別の金額", collection: "purchase-orders", span: 1, groupBy: "supplier", measure: { kind: "sum", field: "amount" }, limit: 6 },
      { id: "t1", type: "table", title: "直近の発注", collection: "purchase-orders", span: 4, columns: ["supplier", "item", "qty", "amount", "state", "ordered_at"], sort: { field: "ordered_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "operations-progress",
    category: "operations",
    name: "現場・作業進捗ダッシュボード",
    description: "案件ごとの工程・進捗率・状態を追跡し、担当別の作業状況を可視化。",
    icon: "check-square",
    color: "success",
    collections: [
      {
        name: "作業",
        slug: "tasks",
        icon: "check-square",
        color: "success",
        sampleRows: 130,
        fields: [
          { key: "project", name: "案件", type: "text", required: true },
          { key: "owner", name: "担当", type: "text" },
          { key: "process", name: "工程", type: "select", required: true, options: PROCESS },
          { key: "progress", name: "進捗率(%)", type: "number", sample: { min: 0, max: 100, trend: "up" } },
          { key: "due_at", name: "期限", type: "date", sample: { daysBack: 45, trend: "up" } },
          { key: "state", name: "状態", type: "select", required: true, options: TASK_STATE, sample: { weights: [2, 4, 4] } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "作業数", collection: "tasks", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "完了率", collection: "tasks", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "state", op: "eq", value: "done" }] },
      { id: "k3", type: "kpi", title: "進行中", collection: "tasks", span: 1, measure: { kind: "count" }, filters: [{ field: "state", op: "eq", value: "in_progress" }] },
      { id: "k4", type: "kpi", title: "平均進捗率", collection: "tasks", span: 1, measure: { kind: "avg", field: "progress" } },
      { id: "b1", type: "donut", title: "工程別の内訳", collection: "tasks", span: 2, groupBy: "process", measure: { kind: "count" }, limit: 5 },
      { id: "b2", type: "hbar", title: "担当別の作業数", collection: "tasks", span: 2, groupBy: "owner", measure: { kind: "count" }, limit: 6 },
      { id: "t1", type: "table", title: "作業一覧", collection: "tasks", span: 4, columns: ["project", "owner", "process", "progress", "state", "due_at"], sort: { field: "due_at", dir: "asc" }, limit: 8 },
    ],
  },
];
