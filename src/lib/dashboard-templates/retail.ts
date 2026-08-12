/**
 * Category: 小売・EC (retail) — dashboard templates.
 * Populated to match the shape in ./support.ts (the reference implementation).
 */
import type { DashboardTemplate } from "../widgets";

const STORE = [
  { label: "本店", value: "honten" },
  { label: "駅前店", value: "ekimae" },
  { label: "モール店", value: "mall" },
  { label: "郊外店", value: "suburb" },
  { label: "空港店", value: "airport" },
  { label: "オンライン", value: "online" },
];
const DEPARTMENT = [
  { label: "食品", value: "food" },
  { label: "日用品", value: "daily" },
  { label: "衣料", value: "apparel" },
  { label: "雑貨", value: "goods" },
  { label: "その他", value: "other" },
];
const CHANNEL = [
  { label: "自社EC", value: "own", color: "khaki" },
  { label: "楽天市場", value: "rakuten", color: "danger" },
  { label: "Amazon", value: "amazon", color: "warning" },
  { label: "Yahoo!ショッピング", value: "yahoo", color: "info" },
  { label: "実店舗", value: "store", color: "neutral" },
];
const SHIP_STATUS = [
  { label: "受付", value: "received", color: "neutral" },
  { label: "出荷準備", value: "packing", color: "warning" },
  { label: "出荷済", value: "shipped", color: "success" },
  { label: "キャンセル", value: "cancelled", color: "danger" },
];
const SKU_CATEGORY = [
  { label: "定番品", value: "staple" },
  { label: "季節品", value: "seasonal" },
  { label: "新商品", value: "new" },
  { label: "セール品", value: "sale" },
  { label: "終売予定", value: "discontinued" },
];
const MANAGER = ["西村", "大西", "宮本", "菅原", "野口", "橋本"];

export const retailTemplates: DashboardTemplate[] = [
  {
    key: "retail-store-sales",
    category: "retail",
    name: "店舗別売上ダッシュボード",
    description:
      "複数店舗を運営する小売業向けに、店舗・部門別の売上と客数・客単価を日次で比較。",
    icon: "table",
    color: "khaki",
    collections: [
      {
        name: "日次売上",
        slug: "store-sales",
        icon: "table",
        color: "khaki",
        sampleRows: 120,
        fields: [
          { key: "store", name: "店舗", type: "select", required: true, options: STORE, sample: { weights: [5, 4, 4, 3, 2, 3] } },
          { key: "department", name: "部門", type: "select", options: DEPARTMENT, sample: { weights: [5, 4, 3, 3, 1] } },
          { key: "sales", name: "売上", type: "currency", required: true, sample: { min: 120000, max: 1400000 } },
          { key: "customers", name: "客数", type: "number", sample: { min: 40, max: 620 } },
          { key: "avg_spend", name: "客単価", type: "currency", sample: { min: 900, max: 6800 } },
          { key: "manager", name: "店長", type: "text", sample: { pool: MANAGER } },
          { key: "sold_at", name: "売上日", type: "date", required: true, sample: { daysBack: 90, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "売上合計", collection: "store-sales", span: 1, measure: { kind: "sum", field: "sales" }, unit: "currency", icon: "table" },
      { id: "k2", type: "kpi", title: "今月の売上", collection: "store-sales", span: 1, measure: { kind: "sum", field: "sales" }, unit: "currency", delta: { dateField: "sold_at", period: "month" } },
      { id: "k3", type: "kpi", title: "客数合計", collection: "store-sales", span: 1, measure: { kind: "sum", field: "customers" } },
      { id: "k4", type: "kpi", title: "平均客単価", collection: "store-sales", span: 1, measure: { kind: "avg", field: "avg_spend" }, unit: "currency" },
      {
        id: "s1", type: "area", title: "売上の推移", collection: "store-sales", span: 2,
        dateField: "sold_at", bucket: "day", rangeCount: 28,
        measures: [{ label: "売上", measure: { kind: "sum", field: "sales" }, color: "khaki" }],
      },
      { id: "b1", type: "hbar", title: "店舗別の売上", collection: "store-sales", span: 1, groupBy: "store", measure: { kind: "sum", field: "sales" }, limit: 6 },
      { id: "b2", type: "donut", title: "部門別の売上", collection: "store-sales", span: 1, groupBy: "department", measure: { kind: "sum", field: "sales" }, limit: 5 },
      { id: "t1", type: "table", title: "直近の売上明細", collection: "store-sales", span: 4, columns: ["sold_at", "store", "department", "sales", "customers", "avg_spend", "manager"], sort: { field: "sold_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "retail-ec-orders",
    category: "retail",
    name: "EC受注・リピート率ダッシュボード",
    description:
      "ネットショップの受注をチャネル別に追跡し、リピート購入率と出荷状況を把握。",
    icon: "download",
    color: "info",
    collections: [
      {
        name: "EC受注",
        slug: "ec-orders",
        icon: "download",
        color: "info",
        sampleRows: 120,
        fields: [
          { key: "order_no", name: "注文番号", type: "text", required: true },
          { key: "customer", name: "顧客", type: "text" },
          { key: "channel", name: "販売チャネル", type: "select", required: true, options: CHANNEL, sample: { weights: [5, 4, 4, 2, 2] } },
          { key: "amount", name: "注文金額", type: "currency", required: true, sample: { min: 2000, max: 68000 } },
          { key: "items", name: "点数", type: "number", sample: { min: 1, max: 8 } },
          { key: "is_repeat", name: "リピート購入", type: "checkbox", sample: { min: 0.42 } },
          { key: "status", name: "出荷ステータス", type: "select", options: SHIP_STATUS, sample: { weights: [2, 3, 6, 1] } },
          { key: "ordered_at", name: "注文日", type: "date", required: true, sample: { daysBack: 60, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "受注金額", collection: "ec-orders", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency" },
      { id: "k2", type: "kpi", title: "受注件数", collection: "ec-orders", span: 1, measure: { kind: "count" } },
      { id: "k3", type: "kpi", title: "リピート率", collection: "ec-orders", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "is_repeat", op: "truthy" }] },
      { id: "k4", type: "kpi", title: "平均注文単価", collection: "ec-orders", span: 1, measure: { kind: "avg", field: "amount" }, unit: "currency" },
      {
        id: "s1", type: "line", title: "新規・リピートの受注件数", collection: "ec-orders", span: 2,
        dateField: "ordered_at", bucket: "day", rangeCount: 28,
        measures: [
          { label: "新規", measure: { kind: "count" }, filters: [{ field: "is_repeat", op: "falsy" }], color: "info" },
          { label: "リピート", measure: { kind: "count" }, filters: [{ field: "is_repeat", op: "truthy" }], color: "success" },
        ],
      },
      { id: "b1", type: "donut", title: "チャネル別の売上", collection: "ec-orders", span: 1, groupBy: "channel", measure: { kind: "sum", field: "amount" }, limit: 5 },
      { id: "b2", type: "hbar", title: "出荷ステータス別の件数", collection: "ec-orders", span: 1, groupBy: "status", measure: { kind: "count" }, limit: 4 },
      { id: "t1", type: "table", title: "直近の受注", collection: "ec-orders", span: 4, columns: ["ordered_at", "order_no", "customer", "channel", "amount", "items", "status"], sort: { field: "ordered_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "retail-inventory-turnover",
    category: "retail",
    name: "在庫回転ダッシュボード",
    description:
      "SKU単位の在庫回転率と滞留在庫を見える化し、仕入れ・値下げ判断を支援。",
    icon: "check-square",
    color: "warning",
    collections: [
      {
        name: "在庫SKU",
        slug: "stock-items",
        icon: "check-square",
        color: "warning",
        sampleRows: 110,
        fields: [
          { key: "sku", name: "SKUコード", type: "text", required: true },
          { key: "product", name: "商品名", type: "text", required: true },
          { key: "category", name: "区分", type: "select", options: SKU_CATEGORY, sample: { weights: [5, 3, 3, 2, 1] } },
          { key: "stock_qty", name: "在庫数", type: "number", required: true, sample: { min: 0, max: 480 } },
          { key: "shipped_qty", name: "月間出荷数", type: "number", sample: { min: 0, max: 320 } },
          { key: "unit_cost", name: "仕入原価", type: "currency", sample: { min: 200, max: 28000 } },
          { key: "turnover", name: "回転率", type: "number", sample: { min: 0, max: 11 } },
          { key: "counted_at", name: "棚卸日", type: "date", required: true, sample: { daysBack: 90, trend: "flat" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "SKU数", collection: "stock-items", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "在庫総数", collection: "stock-items", span: 1, measure: { kind: "sum", field: "stock_qty" } },
      { id: "k3", type: "kpi", title: "平均回転率", collection: "stock-items", span: 1, measure: { kind: "avg", field: "turnover" } },
      { id: "k4", type: "kpi", title: "滞留SKU率", collection: "stock-items", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "turnover", op: "lt", value: 2 }] },
      {
        id: "s1", type: "bar", title: "出荷数の推移", collection: "stock-items", span: 2,
        dateField: "counted_at", bucket: "week", rangeCount: 12,
        measures: [{ label: "出荷数", measure: { kind: "sum", field: "shipped_qty" }, color: "khaki" }],
      },
      { id: "b1", type: "hbar", title: "区分別の在庫数", collection: "stock-items", span: 1, groupBy: "category", measure: { kind: "sum", field: "stock_qty" }, limit: 5 },
      { id: "b2", type: "donut", title: "区分別のSKU数", collection: "stock-items", span: 1, groupBy: "category", measure: { kind: "count" }, limit: 5 },
      { id: "t1", type: "table", title: "滞留在庫(回転率の低い順)", collection: "stock-items", span: 4, columns: ["sku", "product", "category", "stock_qty", "shipped_qty", "turnover", "unit_cost"], sort: { field: "turnover", dir: "asc" }, limit: 8 },
    ],
  },
];
