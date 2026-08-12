/**
 * Category: 飲食・店舗 (restaurant) — dashboard templates.
 * Populated to match the shape in ./support.ts (the reference implementation).
 */
import type { DashboardTemplate } from "../widgets";

const SHOP = [
  { label: "本店", value: "main" },
  { label: "駅前店", value: "ekimae" },
  { label: "商店街店", value: "shotengai" },
  { label: "ロードサイド店", value: "roadside" },
];
const TIME_SLOT = [
  { label: "ランチ", value: "lunch", color: "warning" },
  { label: "カフェ", value: "cafe", color: "khaki" },
  { label: "ディナー", value: "dinner", color: "info" },
];
const WEATHER = [
  { label: "晴", value: "sunny" },
  { label: "曇", value: "cloudy" },
  { label: "雨", value: "rainy" },
  { label: "雪", value: "snowy" },
];
const MENU_CATEGORY = [
  { label: "フード", value: "food", color: "khaki" },
  { label: "ドリンク", value: "drink", color: "info" },
  { label: "デザート", value: "dessert", color: "warning" },
  { label: "アルコール", value: "alcohol", color: "danger" },
  { label: "テイクアウト", value: "takeout", color: "neutral" },
];

export const restaurantTemplates: DashboardTemplate[] = [
  {
    key: "restaurant-daily-sales",
    category: "restaurant",
    name: "日次売上・客単価ダッシュボード",
    description:
      "飲食店の日々の売上・客数・客単価を時間帯別に把握し、店舗運営の判断材料にする。",
    icon: "table",
    color: "khaki",
    collections: [
      {
        name: "日次売上",
        slug: "daily-sales",
        icon: "table",
        color: "khaki",
        sampleRows: 120,
        fields: [
          { key: "shop", name: "店舗", type: "select", required: true, options: SHOP, sample: { weights: [5, 4, 3, 3] } },
          { key: "time_slot", name: "時間帯", type: "select", required: true, options: TIME_SLOT, sample: { weights: [5, 3, 5] } },
          { key: "sales", name: "売上", type: "currency", required: true, sample: { min: 35000, max: 420000 } },
          { key: "guests", name: "客数", type: "number", required: true, sample: { min: 12, max: 180 } },
          { key: "avg_check", name: "客単価", type: "currency", sample: { min: 850, max: 5200 } },
          { key: "seat_turnover", name: "回転数", type: "number", sample: { min: 1, max: 5 } },
          { key: "weather", name: "天候", type: "select", options: WEATHER, sample: { weights: [6, 3, 3, 1] } },
          { key: "business_date", name: "営業日", type: "date", required: true, sample: { daysBack: 60, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "売上合計", collection: "daily-sales", span: 1, measure: { kind: "sum", field: "sales" }, unit: "currency" },
      { id: "k2", type: "kpi", title: "今週の売上", collection: "daily-sales", span: 1, measure: { kind: "sum", field: "sales" }, unit: "currency", delta: { dateField: "business_date", period: "week" } },
      { id: "k3", type: "kpi", title: "客数合計", collection: "daily-sales", span: 1, measure: { kind: "sum", field: "guests" } },
      { id: "k4", type: "kpi", title: "平均客単価", collection: "daily-sales", span: 1, measure: { kind: "avg", field: "avg_check" }, unit: "currency" },
      {
        id: "s1", type: "area", title: "ランチ・ディナー別の売上推移", collection: "daily-sales", span: 2,
        dateField: "business_date", bucket: "day", rangeCount: 28, stacked: true,
        measures: [
          { label: "ランチ", measure: { kind: "sum", field: "sales" }, filters: [{ field: "time_slot", op: "eq", value: "lunch" }], color: "warning" },
          { label: "ディナー", measure: { kind: "sum", field: "sales" }, filters: [{ field: "time_slot", op: "eq", value: "dinner" }], color: "info" },
        ],
      },
      { id: "b1", type: "hbar", title: "店舗別の売上", collection: "daily-sales", span: 1, groupBy: "shop", measure: { kind: "sum", field: "sales" }, limit: 4 },
      { id: "b2", type: "donut", title: "時間帯別の客数", collection: "daily-sales", span: 1, groupBy: "time_slot", measure: { kind: "sum", field: "guests" }, limit: 3 },
      { id: "t1", type: "table", title: "直近の営業実績", collection: "daily-sales", span: 4, columns: ["business_date", "shop", "time_slot", "sales", "guests", "avg_check", "seat_turnover", "weather"], sort: { field: "business_date", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "restaurant-menu-cost",
    category: "restaurant",
    name: "メニュー別分析・食材原価ダッシュボード",
    description:
      "メニューごとの出数・売上・原価率を並べ、儲かる看板メニューと赤字メニューを見極める。",
    icon: "report",
    color: "warning",
    collections: [
      {
        name: "メニュー実績",
        slug: "menu-items",
        icon: "report",
        color: "warning",
        sampleRows: 90,
        fields: [
          { key: "menu_name", name: "メニュー名", type: "text", required: true },
          { key: "category", name: "カテゴリ", type: "select", required: true, options: MENU_CATEGORY, sample: { weights: [6, 4, 2, 3, 2] } },
          { key: "sold_qty", name: "出数", type: "number", required: true, sample: { min: 5, max: 480 } },
          { key: "price", name: "販売価格", type: "currency", sample: { min: 380, max: 3800 } },
          { key: "food_cost", name: "食材原価", type: "currency", sample: { min: 100, max: 1600 } },
          { key: "cost_rate", name: "原価率(%)", type: "number", sample: { min: 22, max: 62 } },
          { key: "sales", name: "売上", type: "currency", sample: { min: 8000, max: 900000 } },
          { key: "aggregated_at", name: "集計日", type: "date", required: true, sample: { daysBack: 90, trend: "flat" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "メニュー売上合計", collection: "menu-items", span: 1, measure: { kind: "sum", field: "sales" }, unit: "currency" },
      { id: "k2", type: "kpi", title: "出数合計", collection: "menu-items", span: 1, measure: { kind: "sum", field: "sold_qty" } },
      { id: "k3", type: "kpi", title: "平均原価率", collection: "menu-items", span: 1, measure: { kind: "avg", field: "cost_rate" }, unit: "percent" },
      { id: "k4", type: "kpi", title: "原価率40%超の割合", collection: "menu-items", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "cost_rate", op: "gt", value: 40 }] },
      {
        id: "s1", type: "bar", title: "食材原価の推移", collection: "menu-items", span: 2,
        dateField: "aggregated_at", bucket: "week", rangeCount: 12,
        measures: [{ label: "食材原価", measure: { kind: "sum", field: "food_cost" }, color: "warning" }],
      },
      { id: "b1", type: "donut", title: "カテゴリ別の売上", collection: "menu-items", span: 1, groupBy: "category", measure: { kind: "sum", field: "sales" }, limit: 5 },
      { id: "b2", type: "hbar", title: "カテゴリ別の出数", collection: "menu-items", span: 1, groupBy: "category", measure: { kind: "sum", field: "sold_qty" }, limit: 5 },
      { id: "t1", type: "table", title: "原価率の高いメニュー", collection: "menu-items", span: 4, columns: ["menu_name", "category", "sold_qty", "price", "food_cost", "cost_rate", "sales"], sort: { field: "cost_rate", dir: "desc" }, limit: 8 },
    ],
  },
];
