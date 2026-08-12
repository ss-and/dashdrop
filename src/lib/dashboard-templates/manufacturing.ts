/**
 * Category: 製造・生産 (manufacturing) — dashboard templates.
 * Populated to match the shape in ./support.ts (the reference implementation).
 */
import type { DashboardTemplate } from "../widgets";

const LINE = [
  { label: "第1ライン", value: "line1" },
  { label: "第2ライン", value: "line2" },
  { label: "第3ライン", value: "line3" },
  { label: "組立ライン", value: "assembly" },
  { label: "検査ライン", value: "inspection" },
];
const SHIFT = [
  { label: "日勤", value: "day", color: "khaki" },
  { label: "夜勤", value: "night", color: "info" },
];
const DEFECT_TYPE = [
  { label: "寸法不良", value: "dimension", color: "warning" },
  { label: "外観キズ", value: "scratch", color: "danger" },
  { label: "組付不良", value: "assembly", color: "info" },
  { label: "材料不良", value: "material", color: "neutral" },
  { label: "その他", value: "other", color: "neutral" },
];
const DEFECT_CAUSE = [
  { label: "設備", value: "equipment" },
  { label: "作業手順", value: "process" },
  { label: "材料", value: "material" },
  { label: "教育不足", value: "training" },
  { label: "設計", value: "design" },
];
const COST_TYPE = [
  { label: "材料費", value: "material", color: "khaki" },
  { label: "労務費", value: "labor", color: "info" },
  { label: "外注費", value: "outsourcing", color: "warning" },
  { label: "経費", value: "overhead", color: "neutral" },
];
const PRODUCT_LINE = [
  { label: "産業機器", value: "industrial" },
  { label: "自動車部品", value: "automotive" },
  { label: "住宅設備", value: "housing" },
  { label: "電子部品", value: "electronics" },
];

export const manufacturingTemplates: DashboardTemplate[] = [
  {
    key: "manufacturing-production",
    category: "manufacturing",
    name: "生産実績・稼働率ダッシュボード",
    description:
      "町工場・製造現場向けに、ライン別の生産数・稼働率・計画達成率を日次で追跡。",
    icon: "check-square",
    color: "khaki",
    collections: [
      {
        name: "生産実績",
        slug: "production",
        icon: "check-square",
        color: "khaki",
        sampleRows: 120,
        fields: [
          { key: "line", name: "ライン", type: "select", required: true, options: LINE, sample: { weights: [5, 4, 3, 3, 2] } },
          { key: "shift", name: "シフト", type: "select", options: SHIFT, sample: { weights: [7, 3] } },
          { key: "planned_qty", name: "計画数", type: "number", required: true, sample: { min: 200, max: 1200 } },
          { key: "actual_qty", name: "生産数", type: "number", required: true, sample: { min: 150, max: 1180 } },
          { key: "operating_rate", name: "稼働率(%)", type: "number", sample: { min: 58, max: 99 } },
          { key: "downtime_min", name: "停止時間(分)", type: "number", sample: { min: 0, max: 180 } },
          { key: "produced_at", name: "生産日", type: "date", required: true, sample: { daysBack: 90, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "生産数合計", collection: "production", span: 1, measure: { kind: "sum", field: "actual_qty" } },
      { id: "k2", type: "kpi", title: "平均稼働率", collection: "production", span: 1, measure: { kind: "avg", field: "operating_rate" }, unit: "percent" },
      { id: "k3", type: "kpi", title: "停止時間合計(分)", collection: "production", span: 1, measure: { kind: "sum", field: "downtime_min" } },
      { id: "k4", type: "kpi", title: "計画未達の割合", collection: "production", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "operating_rate", op: "lt", value: 80 }] },
      {
        id: "s1", type: "bar", title: "計画数と生産数の推移", collection: "production", span: 2,
        dateField: "produced_at", bucket: "week", rangeCount: 12,
        measures: [
          { label: "計画数", measure: { kind: "sum", field: "planned_qty" }, color: "neutral" },
          { label: "生産数", measure: { kind: "sum", field: "actual_qty" }, color: "khaki" },
        ],
      },
      { id: "b1", type: "hbar", title: "ライン別の生産数", collection: "production", span: 1, groupBy: "line", measure: { kind: "sum", field: "actual_qty" }, limit: 5 },
      { id: "b2", type: "donut", title: "シフト別の生産数", collection: "production", span: 1, groupBy: "shift", measure: { kind: "sum", field: "actual_qty" }, limit: 2 },
      { id: "t1", type: "table", title: "直近の生産実績", collection: "production", span: 4, columns: ["produced_at", "line", "shift", "planned_qty", "actual_qty", "operating_rate", "downtime_min"], sort: { field: "produced_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "manufacturing-quality",
    category: "manufacturing",
    name: "品質・不良分析ダッシュボード",
    description:
      "不良発生を種類・原因・ライン別に集計し、不良率の改善状況を品質担当が確認。",
    icon: "report",
    color: "danger",
    collections: [
      {
        name: "不良記録",
        slug: "defects",
        icon: "report",
        color: "danger",
        sampleRows: 110,
        fields: [
          { key: "product", name: "製品名", type: "text", required: true },
          { key: "line", name: "発生ライン", type: "select", required: true, options: LINE },
          { key: "defect_type", name: "不良種類", type: "select", required: true, options: DEFECT_TYPE, sample: { weights: [5, 4, 3, 2, 1] } },
          { key: "cause", name: "原因区分", type: "select", options: DEFECT_CAUSE, sample: { weights: [4, 4, 3, 2, 1] } },
          { key: "defect_qty", name: "不良数", type: "number", required: true, sample: { min: 1, max: 60 } },
          { key: "inspected_qty", name: "検査数", type: "number", sample: { min: 200, max: 1500 } },
          { key: "loss_amount", name: "損失金額", type: "currency", sample: { min: 5000, max: 900000 } },
          { key: "is_resolved", name: "対策完了", type: "checkbox", sample: { min: 0.6 } },
          { key: "found_at", name: "発生日", type: "date", required: true, sample: { daysBack: 90, trend: "down" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "不良数合計", collection: "defects", span: 1, measure: { kind: "sum", field: "defect_qty" } },
      { id: "k2", type: "kpi", title: "損失金額", collection: "defects", span: 1, measure: { kind: "sum", field: "loss_amount" }, unit: "currency" },
      { id: "k3", type: "kpi", title: "対策完了率", collection: "defects", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "is_resolved", op: "truthy" }] },
      { id: "k4", type: "kpi", title: "未対策件数", collection: "defects", span: 1, measure: { kind: "count" }, filters: [{ field: "is_resolved", op: "falsy" }] },
      {
        id: "s1", type: "line", title: "不良数の推移", collection: "defects", span: 2,
        dateField: "found_at", bucket: "week", rangeCount: 12,
        measures: [{ label: "不良数", measure: { kind: "sum", field: "defect_qty" }, color: "danger" }],
      },
      { id: "b1", type: "donut", title: "不良種類別の内訳", collection: "defects", span: 1, groupBy: "defect_type", measure: { kind: "sum", field: "defect_qty" }, limit: 5 },
      { id: "b2", type: "hbar", title: "原因区分別の損失金額", collection: "defects", span: 1, groupBy: "cause", measure: { kind: "sum", field: "loss_amount" }, limit: 5 },
      { id: "t1", type: "table", title: "損失額の大きい不良", collection: "defects", span: 4, columns: ["found_at", "product", "line", "defect_type", "cause", "defect_qty", "loss_amount"], sort: { field: "loss_amount", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "manufacturing-cost",
    category: "manufacturing",
    name: "製造原価ダッシュボード",
    description:
      "製品ラインごとの材料費・労務費・外注費を積み上げ、原価率と粗利を管理する経営者向け。",
    icon: "table",
    color: "warning",
    collections: [
      {
        name: "原価実績",
        slug: "prod-costs",
        icon: "table",
        color: "warning",
        sampleRows: 110,
        fields: [
          { key: "product_line", name: "製品ライン", type: "select", required: true, options: PRODUCT_LINE, sample: { weights: [4, 4, 3, 3] } },
          { key: "cost_type", name: "費目", type: "select", required: true, options: COST_TYPE, sample: { weights: [6, 4, 3, 2] } },
          { key: "cost_amount", name: "原価", type: "currency", required: true, sample: { min: 80000, max: 4200000 } },
          { key: "sales_amount", name: "売上", type: "currency", sample: { min: 200000, max: 7000000 } },
          { key: "cost_rate", name: "原価率(%)", type: "number", sample: { min: 42, max: 88 } },
          { key: "supplier", name: "仕入先", type: "text" },
          { key: "recorded_at", name: "計上日", type: "date", required: true, sample: { daysBack: 180, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "原価合計", collection: "prod-costs", span: 1, measure: { kind: "sum", field: "cost_amount" }, unit: "currency" },
      { id: "k2", type: "kpi", title: "売上合計", collection: "prod-costs", span: 1, measure: { kind: "sum", field: "sales_amount" }, unit: "currency" },
      { id: "k3", type: "kpi", title: "平均原価率", collection: "prod-costs", span: 1, measure: { kind: "avg", field: "cost_rate" }, unit: "percent" },
      { id: "k4", type: "kpi", title: "今月の原価", collection: "prod-costs", span: 1, measure: { kind: "sum", field: "cost_amount" }, unit: "currency", delta: { dateField: "recorded_at", period: "month" } },
      {
        id: "s1", type: "bar", title: "費目別の原価推移", collection: "prod-costs", span: 2,
        dateField: "recorded_at", bucket: "month", rangeCount: 6, stacked: true,
        measures: [
          { label: "材料費", measure: { kind: "sum", field: "cost_amount" }, filters: [{ field: "cost_type", op: "eq", value: "material" }], color: "khaki" },
          { label: "労務費", measure: { kind: "sum", field: "cost_amount" }, filters: [{ field: "cost_type", op: "eq", value: "labor" }], color: "info" },
          { label: "外注費", measure: { kind: "sum", field: "cost_amount" }, filters: [{ field: "cost_type", op: "eq", value: "outsourcing" }], color: "warning" },
        ],
      },
      { id: "b1", type: "hbar", title: "製品ライン別の原価", collection: "prod-costs", span: 1, groupBy: "product_line", measure: { kind: "sum", field: "cost_amount" }, limit: 4 },
      { id: "b2", type: "donut", title: "費目別の内訳", collection: "prod-costs", span: 1, groupBy: "cost_type", measure: { kind: "sum", field: "cost_amount" }, limit: 4 },
      { id: "t1", type: "table", title: "原価の大きい計上", collection: "prod-costs", span: 4, columns: ["recorded_at", "product_line", "cost_type", "cost_amount", "sales_amount", "cost_rate", "supplier"], sort: { field: "cost_amount", dir: "desc" }, limit: 8 },
    ],
  },
];
