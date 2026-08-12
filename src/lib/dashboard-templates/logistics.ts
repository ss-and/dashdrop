/**
 * Category: 物流・配送 (logistics) — dashboard templates.
 * Populated to match the shape in ./support.ts (the reference implementation).
 */
import type { DashboardTemplate } from "../widgets";

const DELIVERY_STATUS = [
  { label: "集荷済", value: "picked", color: "neutral" },
  { label: "配送中", value: "in_transit", color: "info" },
  { label: "配達完了", value: "delivered", color: "success" },
  { label: "再配達", value: "redelivery", color: "warning" },
  { label: "持ち戻り", value: "returned", color: "danger" },
];
const DELAY_REASON = [
  { label: "交通渋滞", value: "traffic" },
  { label: "不在", value: "absent" },
  { label: "積込遅れ", value: "loading" },
  { label: "天候", value: "weather" },
  { label: "車両トラブル", value: "vehicle" },
];
const ROUTE = [
  { label: "都心ルート", value: "central" },
  { label: "北部ルート", value: "north" },
  { label: "南部ルート", value: "south" },
  { label: "長距離便", value: "longhaul" },
  { label: "スポット便", value: "spot" },
];
const VEHICLE_TYPE = [
  { label: "軽貨物", value: "kei" },
  { label: "2tトラック", value: "truck2t" },
  { label: "4tトラック", value: "truck4t" },
  { label: "10tトラック", value: "truck10t" },
];
const VEHICLE_STATUS = [
  { label: "稼働中", value: "active", color: "success" },
  { label: "待機", value: "idle", color: "neutral" },
  { label: "整備中", value: "maintenance", color: "warning" },
  { label: "故障", value: "broken", color: "danger" },
];
const DRIVER = ["赤松", "白井", "黒田", "青柳", "緑川", "紺野", "桃井"];

export const logisticsTemplates: DashboardTemplate[] = [
  {
    key: "logistics-delivery",
    category: "logistics",
    name: "配送実績・遅延分析ダッシュボード",
    description:
      "運送・配送業向けに、配送件数と時間指定の遵守率、遅延理由をルート別に分析。",
    icon: "download",
    color: "info",
    collections: [
      {
        name: "配送実績",
        slug: "deliveries",
        icon: "download",
        color: "info",
        sampleRows: 120,
        fields: [
          { key: "slip_no", name: "送り状番号", type: "text", required: true },
          { key: "route", name: "ルート", type: "select", required: true, options: ROUTE, sample: { weights: [5, 4, 4, 2, 2] } },
          { key: "driver", name: "ドライバー", type: "text", sample: { pool: DRIVER } },
          { key: "status", name: "配送状況", type: "select", required: true, options: DELIVERY_STATUS, sample: { weights: [2, 3, 8, 2, 1] } },
          { key: "delay_min", name: "遅延時間(分)", type: "number", sample: { min: 0, max: 140 } },
          { key: "delay_reason", name: "遅延理由", type: "select", options: DELAY_REASON, sample: { weights: [5, 4, 2, 2, 1] } },
          { key: "freight", name: "運賃", type: "currency", sample: { min: 1200, max: 68000 } },
          { key: "delivered_at", name: "配送日", type: "date", required: true, sample: { daysBack: 60, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "配送件数", collection: "deliveries", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "運賃合計", collection: "deliveries", span: 1, measure: { kind: "sum", field: "freight" }, unit: "currency" },
      { id: "k3", type: "kpi", title: "配達完了率", collection: "deliveries", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "status", op: "eq", value: "delivered" }] },
      { id: "k4", type: "kpi", title: "平均遅延時間(分)", collection: "deliveries", span: 1, measure: { kind: "avg", field: "delay_min" } },
      {
        id: "s1", type: "line", title: "配送件数と再配達の推移", collection: "deliveries", span: 2,
        dateField: "delivered_at", bucket: "day", rangeCount: 21,
        measures: [
          { label: "配送件数", measure: { kind: "count" }, color: "info" },
          { label: "再配達", measure: { kind: "count" }, filters: [{ field: "status", op: "eq", value: "redelivery" }], color: "warning" },
        ],
      },
      { id: "b1", type: "hbar", title: "ルート別の配送件数", collection: "deliveries", span: 1, groupBy: "route", measure: { kind: "count" }, limit: 5 },
      { id: "b2", type: "donut", title: "遅延理由の内訳", collection: "deliveries", span: 1, groupBy: "delay_reason", measure: { kind: "count" }, limit: 5 },
      { id: "b3", type: "hbar", title: "ドライバー別の運賃", collection: "deliveries", span: 2, groupBy: "driver", measure: { kind: "sum", field: "freight" }, limit: 7 },
      { id: "t1", type: "table", title: "遅延の大きい配送", collection: "deliveries", span: 4, columns: ["delivered_at", "slip_no", "route", "driver", "status", "delay_min", "delay_reason", "freight"], sort: { field: "delay_min", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "logistics-fleet",
    category: "logistics",
    name: "車両稼働・整備ダッシュボード",
    description:
      "保有車両の稼働率・走行距離・燃料費と整備状況をまとめ、車両コストを管理。",
    icon: "settings",
    color: "warning",
    collections: [
      {
        name: "車両",
        slug: "vehicles",
        icon: "settings",
        color: "warning",
        sampleRows: 80,
        fields: [
          { key: "plate_no", name: "車両番号", type: "text", required: true },
          { key: "vehicle_type", name: "車種", type: "select", required: true, options: VEHICLE_TYPE, sample: { weights: [4, 5, 3, 2] } },
          { key: "status", name: "状態", type: "select", required: true, options: VEHICLE_STATUS, sample: { weights: [7, 3, 2, 1] } },
          { key: "driver", name: "主担当", type: "text", sample: { pool: DRIVER } },
          { key: "distance_km", name: "月間走行距離(km)", type: "number", sample: { min: 300, max: 9000 } },
          { key: "fuel_cost", name: "月間燃料費", type: "currency", sample: { min: 18000, max: 260000 } },
          { key: "operating_rate", name: "稼働率(%)", type: "number", sample: { min: 35, max: 98 } },
          { key: "inspected_at", name: "点検日", type: "date", required: true, sample: { daysBack: 180, trend: "flat" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "保有車両数", collection: "vehicles", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "平均稼働率", collection: "vehicles", span: 1, measure: { kind: "avg", field: "operating_rate" }, unit: "percent" },
      { id: "k3", type: "kpi", title: "燃料費合計", collection: "vehicles", span: 1, measure: { kind: "sum", field: "fuel_cost" }, unit: "currency" },
      { id: "k4", type: "kpi", title: "整備・故障中の割合", collection: "vehicles", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "status", op: "in", value: ["maintenance", "broken"] }] },
      {
        id: "s1", type: "bar", title: "点検実施数の推移", collection: "vehicles", span: 2,
        dateField: "inspected_at", bucket: "month", rangeCount: 6,
        measures: [{ label: "点検車両数", measure: { kind: "count" }, color: "warning" }],
      },
      { id: "b1", type: "donut", title: "車種別の台数", collection: "vehicles", span: 1, groupBy: "vehicle_type", measure: { kind: "count" }, limit: 4 },
      { id: "b2", type: "hbar", title: "車種別の走行距離", collection: "vehicles", span: 1, groupBy: "vehicle_type", measure: { kind: "sum", field: "distance_km" }, limit: 4 },
      { id: "t1", type: "table", title: "稼働率の低い車両", collection: "vehicles", span: 4, columns: ["plate_no", "vehicle_type", "status", "driver", "distance_km", "fuel_cost", "operating_rate", "inspected_at"], sort: { field: "operating_rate", dir: "asc" }, limit: 8 },
    ],
  },
];
