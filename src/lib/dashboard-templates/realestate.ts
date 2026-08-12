/**
 * Category: 不動産 (realestate) — dashboard templates.
 * Populated to match the shape in ./support.ts (the reference implementation).
 */
import type { DashboardTemplate } from "../widgets";

const PROPERTY_TYPE = [
  { label: "戸建", value: "house" },
  { label: "マンション", value: "condo" },
  { label: "土地", value: "land" },
  { label: "収益物件", value: "investment" },
  { label: "事業用", value: "commercial" },
];
const DEAL_STATUS = [
  { label: "媒介受託", value: "listed", color: "neutral" },
  { label: "内見対応", value: "viewing", color: "info" },
  { label: "申込", value: "applied", color: "warning" },
  { label: "成約", value: "closed", color: "success" },
  { label: "取下げ", value: "withdrawn", color: "danger" },
];
const LEAD_SOURCE = [
  { label: "ポータルサイト", value: "portal" },
  { label: "自社サイト", value: "website" },
  { label: "紹介", value: "referral" },
  { label: "店頭来店", value: "walkin" },
  { label: "チラシ", value: "flyer" },
];
const ROOM_TYPE = [
  { label: "1K・1R", value: "1k" },
  { label: "1LDK", value: "1ldk" },
  { label: "2LDK", value: "2ldk" },
  { label: "3LDK以上", value: "3ldk" },
  { label: "店舗・事務所", value: "tenant" },
];
const ROOM_STATUS = [
  { label: "入居中", value: "occupied", color: "success" },
  { label: "空室", value: "vacant", color: "danger" },
  { label: "募集中", value: "recruiting", color: "warning" },
  { label: "リフォーム中", value: "renovating", color: "neutral" },
];

export const realestateTemplates: DashboardTemplate[] = [
  {
    key: "realestate-deals",
    category: "realestate",
    name: "物件・成約管理ダッシュボード",
    description:
      "不動産仲介向けに、預かり物件の状況と成約率・仲介手数料を反響経路別に管理。",
    icon: "table",
    color: "khaki",
    collections: [
      {
        name: "物件・商談",
        slug: "properties",
        icon: "table",
        color: "khaki",
        sampleRows: 110,
        fields: [
          { key: "property_name", name: "物件名", type: "text", required: true },
          { key: "property_type", name: "物件種別", type: "select", required: true, options: PROPERTY_TYPE, sample: { weights: [4, 5, 3, 2, 2] } },
          { key: "area", name: "エリア", type: "text" },
          { key: "status", name: "商談状況", type: "select", required: true, options: DEAL_STATUS, sample: { weights: [4, 4, 3, 3, 2] } },
          { key: "price", name: "価格", type: "currency", required: true, sample: { min: 4800000, max: 98000000 } },
          { key: "commission", name: "仲介手数料", type: "currency", sample: { min: 160000, max: 3200000 } },
          { key: "source", name: "反響経路", type: "select", options: LEAD_SOURCE, sample: { weights: [6, 3, 3, 2, 1] } },
          { key: "agent", name: "担当", type: "text" },
          { key: "listed_at", name: "受託日", type: "date", required: true, sample: { daysBack: 150, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "取扱物件数", collection: "properties", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "成約率", collection: "properties", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "status", op: "eq", value: "closed" }] },
      { id: "k3", type: "kpi", title: "成約価格合計", collection: "properties", span: 1, measure: { kind: "sum", field: "price" }, unit: "currency", filters: [{ field: "status", op: "eq", value: "closed" }] },
      { id: "k4", type: "kpi", title: "仲介手数料合計", collection: "properties", span: 1, measure: { kind: "sum", field: "commission" }, unit: "currency" },
      {
        id: "s1", type: "area", title: "成約手数料の推移", collection: "properties", span: 2,
        dateField: "listed_at", bucket: "month", rangeCount: 6,
        measures: [{ label: "仲介手数料", measure: { kind: "sum", field: "commission" }, filters: [{ field: "status", op: "eq", value: "closed" }], color: "success" }],
      },
      { id: "b1", type: "donut", title: "物件種別の内訳", collection: "properties", span: 1, groupBy: "property_type", measure: { kind: "count" }, limit: 5 },
      { id: "b2", type: "hbar", title: "反響経路別の件数", collection: "properties", span: 1, groupBy: "source", measure: { kind: "count" }, limit: 5 },
      { id: "b3", type: "hbar", title: "担当別の手数料", collection: "properties", span: 2, groupBy: "agent", measure: { kind: "sum", field: "commission" }, limit: 6 },
      { id: "t1", type: "table", title: "価格の高い物件", collection: "properties", span: 4, columns: ["property_name", "property_type", "status", "price", "commission", "source", "agent", "listed_at"], sort: { field: "price", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "realestate-rental",
    category: "realestate",
    name: "賃貸管理・入居率ダッシュボード",
    description:
      "賃貸管理会社・オーナー向けに、部屋ごとの入居状況と入居率・月額賃料収入を把握。",
    icon: "users",
    color: "info",
    collections: [
      {
        name: "管理物件",
        slug: "rental-rooms",
        icon: "users",
        color: "info",
        sampleRows: 110,
        fields: [
          { key: "building", name: "建物名", type: "text", required: true },
          { key: "room_no", name: "部屋番号", type: "text", required: true },
          { key: "room_type", name: "間取り", type: "select", required: true, options: ROOM_TYPE, sample: { weights: [5, 4, 3, 2, 1] } },
          { key: "status", name: "入居状況", type: "select", required: true, options: ROOM_STATUS, sample: { weights: [8, 2, 2, 1] } },
          { key: "rent", name: "月額賃料", type: "currency", required: true, sample: { min: 42000, max: 260000 } },
          { key: "management_fee", name: "管理費", type: "currency", sample: { min: 3000, max: 22000 } },
          { key: "vacant_days", name: "空室日数", type: "number", sample: { min: 0, max: 180 } },
          { key: "contract_at", name: "契約更新日", type: "date", required: true, sample: { daysBack: 300, trend: "flat" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "管理戸数", collection: "rental-rooms", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "入居率", collection: "rental-rooms", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "status", op: "eq", value: "occupied" }] },
      { id: "k3", type: "kpi", title: "月額賃料収入", collection: "rental-rooms", span: 1, measure: { kind: "sum", field: "rent" }, unit: "currency", filters: [{ field: "status", op: "eq", value: "occupied" }] },
      { id: "k4", type: "kpi", title: "平均空室日数", collection: "rental-rooms", span: 1, measure: { kind: "avg", field: "vacant_days" } },
      {
        id: "s1", type: "bar", title: "契約更新の件数推移", collection: "rental-rooms", span: 2,
        dateField: "contract_at", bucket: "month", rangeCount: 10,
        measures: [{ label: "更新件数", measure: { kind: "count" }, color: "info" }],
      },
      { id: "b1", type: "donut", title: "入居状況の内訳", collection: "rental-rooms", span: 1, groupBy: "status", measure: { kind: "count" }, limit: 4 },
      { id: "b2", type: "hbar", title: "間取り別の賃料合計", collection: "rental-rooms", span: 1, groupBy: "room_type", measure: { kind: "sum", field: "rent" }, limit: 5 },
      { id: "t1", type: "table", title: "空室・募集中の部屋", collection: "rental-rooms", span: 4, columns: ["building", "room_no", "room_type", "status", "rent", "management_fee", "vacant_days"], sort: { field: "vacant_days", dir: "desc" }, limit: 8, filters: [{ field: "status", op: "in", value: ["vacant", "recruiting"] }] },
    ],
  },
];
