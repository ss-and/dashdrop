/**
 * Category: クリニック・治療院 (clinic) — dashboard templates.
 * Populated to match the shape in ./support.ts (the reference implementation).
 */
import type { DashboardTemplate } from "../widgets";

const VISIT_TYPE = [
  { label: "初診", value: "first", color: "info" },
  { label: "再診", value: "repeat", color: "success" },
  { label: "健診・検査", value: "checkup", color: "khaki" },
  { label: "自費診療", value: "private", color: "warning" },
];
const RESERVE_STATUS = [
  { label: "予約済", value: "booked", color: "info" },
  { label: "来院", value: "visited", color: "success" },
  { label: "キャンセル", value: "cancelled", color: "warning" },
  { label: "無断キャンセル", value: "noshow", color: "danger" },
];
const RESERVE_CHANNEL = [
  { label: "Web予約", value: "web" },
  { label: "電話", value: "phone" },
  { label: "窓口", value: "counter" },
  { label: "LINE", value: "line" },
];
const TIME_BAND = [
  { label: "午前", value: "morning" },
  { label: "午後", value: "afternoon" },
  { label: "夜間", value: "evening" },
];
const DEPARTMENT = [
  { label: "内科", value: "internal" },
  { label: "整形外科", value: "ortho" },
  { label: "皮膚科", value: "derma" },
  { label: "小児科", value: "pediatrics" },
  { label: "自費・美容", value: "aesthetic" },
];
const PAYMENT = [
  { label: "保険診療", value: "insurance", color: "info" },
  { label: "自費診療", value: "private", color: "warning" },
  { label: "公費・助成", value: "public", color: "neutral" },
];

export const clinicTemplates: DashboardTemplate[] = [
  {
    key: "clinic-appointments",
    category: "clinic",
    name: "予約・来院管理ダッシュボード",
    description:
      "クリニックや整体院向けに、予約経路・時間帯別の来院数とキャンセル率を把握。",
    icon: "inbox",
    color: "info",
    collections: [
      {
        name: "予約",
        slug: "appointments",
        icon: "inbox",
        color: "info",
        sampleRows: 120,
        fields: [
          { key: "patient", name: "患者名", type: "text", required: true },
          { key: "visit_type", name: "受診区分", type: "select", required: true, options: VISIT_TYPE, sample: { weights: [3, 6, 2, 2] } },
          { key: "status", name: "予約状況", type: "select", required: true, options: RESERVE_STATUS, sample: { weights: [3, 8, 2, 1] } },
          { key: "channel", name: "予約経路", type: "select", options: RESERVE_CHANNEL, sample: { weights: [5, 4, 3, 2] } },
          { key: "time_band", name: "時間帯", type: "select", options: TIME_BAND, sample: { weights: [5, 4, 2] } },
          { key: "wait_min", name: "待ち時間(分)", type: "number", sample: { min: 3, max: 75 } },
          { key: "staff", name: "担当スタッフ", type: "text" },
          { key: "reserved_at", name: "予約日", type: "date", required: true, sample: { daysBack: 60, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "予約件数", collection: "appointments", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "来院率", collection: "appointments", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "status", op: "eq", value: "visited" }] },
      { id: "k3", type: "kpi", title: "キャンセル率", collection: "appointments", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "status", op: "in", value: ["cancelled", "noshow"] }] },
      { id: "k4", type: "kpi", title: "平均待ち時間(分)", collection: "appointments", span: 1, measure: { kind: "avg", field: "wait_min" } },
      {
        id: "s1", type: "line", title: "初診・再診の推移", collection: "appointments", span: 2,
        dateField: "reserved_at", bucket: "day", rangeCount: 28,
        measures: [
          { label: "初診", measure: { kind: "count" }, filters: [{ field: "visit_type", op: "eq", value: "first" }], color: "info" },
          { label: "再診", measure: { kind: "count" }, filters: [{ field: "visit_type", op: "eq", value: "repeat" }], color: "success" },
        ],
      },
      { id: "b1", type: "donut", title: "予約経路の内訳", collection: "appointments", span: 1, groupBy: "channel", measure: { kind: "count" }, limit: 4 },
      { id: "b2", type: "hbar", title: "時間帯別の予約数", collection: "appointments", span: 1, groupBy: "time_band", measure: { kind: "count" }, limit: 3 },
      { id: "t1", type: "table", title: "直近の予約", collection: "appointments", span: 4, columns: ["reserved_at", "patient", "visit_type", "status", "channel", "time_band", "wait_min", "staff"], sort: { field: "reserved_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "clinic-revenue",
    category: "clinic",
    name: "診療科別売上ダッシュボード",
    description:
      "診療科・保険/自費の別に売上と単価を集計し、院の収益構造を院長が確認する。",
    icon: "table",
    color: "success",
    collections: [
      {
        name: "診療実績",
        slug: "treatments",
        icon: "table",
        color: "success",
        sampleRows: 120,
        fields: [
          { key: "patient", name: "患者名", type: "text", required: true },
          { key: "department", name: "診療科", type: "select", required: true, options: DEPARTMENT, sample: { weights: [6, 4, 3, 3, 2] } },
          { key: "payment_type", name: "支払区分", type: "select", required: true, options: PAYMENT, sample: { weights: [7, 3, 1] } },
          { key: "revenue", name: "診療収入", type: "currency", required: true, sample: { min: 1200, max: 88000 } },
          { key: "points", name: "診療点数", type: "number", sample: { min: 80, max: 2400 } },
          { key: "doctor", name: "担当医", type: "text" },
          { key: "treated_at", name: "診療日", type: "date", required: true, sample: { daysBack: 90, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "診療収入合計", collection: "treatments", span: 1, measure: { kind: "sum", field: "revenue" }, unit: "currency" },
      { id: "k2", type: "kpi", title: "今月の診療収入", collection: "treatments", span: 1, measure: { kind: "sum", field: "revenue" }, unit: "currency", delta: { dateField: "treated_at", period: "month" } },
      { id: "k3", type: "kpi", title: "平均診療単価", collection: "treatments", span: 1, measure: { kind: "avg", field: "revenue" }, unit: "currency" },
      { id: "k4", type: "kpi", title: "自費診療の割合", collection: "treatments", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "payment_type", op: "eq", value: "private" }] },
      {
        id: "s1", type: "area", title: "診療収入の推移", collection: "treatments", span: 2,
        dateField: "treated_at", bucket: "week", rangeCount: 12,
        measures: [{ label: "診療収入", measure: { kind: "sum", field: "revenue" }, color: "success" }],
      },
      { id: "b1", type: "hbar", title: "診療科別の収入", collection: "treatments", span: 1, groupBy: "department", measure: { kind: "sum", field: "revenue" }, limit: 5 },
      { id: "b2", type: "donut", title: "支払区分の内訳", collection: "treatments", span: 1, groupBy: "payment_type", measure: { kind: "sum", field: "revenue" }, limit: 3 },
      { id: "t1", type: "table", title: "直近の診療実績", collection: "treatments", span: 4, columns: ["treated_at", "patient", "department", "payment_type", "revenue", "points", "doctor"], sort: { field: "treated_at", dir: "desc" }, limit: 8 },
    ],
  },
];
