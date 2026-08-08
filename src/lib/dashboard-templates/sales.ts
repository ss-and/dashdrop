/**
 * Category: 営業・受注 (sales) — dashboard templates.
 * Populated to match the shape in ./support.ts (the reference implementation).
 */
import type { DashboardTemplate } from "../widgets";

const PHASE = [
  { label: "リード", value: "lead", color: "neutral" },
  { label: "商談", value: "meeting", color: "info" },
  { label: "提案", value: "proposal", color: "warning" },
  { label: "受注", value: "won", color: "success" },
  { label: "失注", value: "lost", color: "danger" },
];
const REGION = [
  { label: "北海道・東北", value: "north" },
  { label: "関東", value: "kanto" },
  { label: "中部", value: "chubu" },
  { label: "近畿", value: "kinki" },
  { label: "中国・四国", value: "chugoku" },
  { label: "九州・沖縄", value: "kyushu" },
];
const INDUSTRY = [
  { label: "製造", value: "manufacturing" },
  { label: "小売", value: "retail" },
  { label: "IT・通信", value: "it" },
  { label: "金融", value: "finance" },
  { label: "建設", value: "construction" },
  { label: "医療・福祉", value: "healthcare" },
  { label: "その他", value: "other" },
];
const ACCOUNT_STATUS = [
  { label: "見込", value: "prospect", color: "info" },
  { label: "既存", value: "active", color: "success" },
  { label: "休眠", value: "dormant", color: "neutral" },
];
const ACTIVITY_TYPE = [
  { label: "訪問", value: "visit", color: "info" },
  { label: "電話", value: "call", color: "khaki" },
  { label: "メール", value: "email", color: "neutral" },
];
const OUTCOME = [
  { label: "アポ獲得", value: "appointment", color: "success" },
  { label: "検討中", value: "considering", color: "warning" },
  { label: "見送り", value: "declined", color: "danger" },
];

export const salesTemplates: DashboardTemplate[] = [
  {
    key: "sales-pipeline",
    category: "sales",
    name: "営業パイプラインダッシュボード",
    description:
      "商談をフェーズ別に追跡し、パイプライン総額・受注率・担当者別の進捗を一望。",
    icon: "sparkles",
    color: "khaki",
    collections: [
      {
        name: "商談",
        slug: "deals",
        icon: "sparkles",
        color: "khaki",
        sampleRows: 140,
        fields: [
          { key: "account", name: "取引先", type: "text", required: true },
          { key: "amount", name: "金額", type: "currency", required: true, sample: { min: 200000, max: 8000000 } },
          { key: "phase", name: "フェーズ", type: "select", required: true, options: PHASE, sample: { weights: [4, 3, 3, 3, 2] } },
          { key: "probability", name: "確度(%)", type: "number", sample: { min: 10, max: 95 } },
          { key: "owner", name: "担当", type: "text" },
          { key: "expected_amount", name: "受注予定額", type: "currency", sample: { min: 100000, max: 6000000 } },
          { key: "next_action_at", name: "次回アクション日", type: "date", sample: { daysBack: 60, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "今月の受注額", collection: "deals", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency", filters: [{ field: "phase", op: "eq", value: "won" }], delta: { dateField: "next_action_at", period: "month" }, icon: "check-square" },
      { id: "k2", type: "kpi", title: "パイプライン総額", collection: "deals", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency" },
      { id: "k3", type: "kpi", title: "受注率", collection: "deals", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "phase", op: "eq", value: "won" }] },
      { id: "k4", type: "kpi", title: "商談数", collection: "deals", span: 1, measure: { kind: "count" } },
      {
        id: "s1", type: "area", title: "受注額の推移", collection: "deals", span: 2,
        dateField: "next_action_at", bucket: "week", rangeCount: 8,
        measures: [{ label: "受注額", measure: { kind: "sum", field: "amount" }, filters: [{ field: "phase", op: "eq", value: "won" }], color: "success" }],
      },
      { id: "b1", type: "donut", title: "フェーズ別の内訳", collection: "deals", span: 1, groupBy: "phase", measure: { kind: "count" }, limit: 5 },
      { id: "b2", type: "hbar", title: "担当者別の金額", collection: "deals", span: 1, groupBy: "owner", measure: { kind: "sum", field: "amount" }, limit: 6 },
      { id: "t1", type: "table", title: "直近の商談", collection: "deals", span: 4, columns: ["account", "amount", "phase", "probability", "owner", "next_action_at"], sort: { field: "next_action_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "sales-targets",
    category: "sales",
    name: "受注・売上目標ダッシュボード",
    description: "受注実績を目標と比較し、月次売上・商品別・地域別の達成状況を可視化。",
    icon: "dashboard",
    color: "success",
    collections: [
      {
        name: "受注",
        slug: "orders",
        icon: "check-square",
        color: "success",
        sampleRows: 160,
        fields: [
          { key: "product", name: "商品", type: "select", required: true, options: [
            { label: "基本プラン", value: "basic" },
            { label: "標準プラン", value: "standard" },
            { label: "上位プラン", value: "premium" },
            { label: "追加オプション", value: "addon" },
            { label: "導入支援", value: "onboarding" },
          ] },
          { key: "amount", name: "金額", type: "currency", required: true, sample: { min: 150000, max: 5000000 } },
          { key: "owner", name: "担当", type: "text" },
          { key: "region", name: "地域", type: "select", options: REGION },
          { key: "ordered_at", name: "受注日", type: "date", required: true, sample: { daysBack: 120, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "売上", collection: "orders", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency" },
      { id: "k2", type: "kpi", title: "目標達成率", collection: "orders", span: 1, measure: { kind: "sum", field: "amount" }, unit: "currency", target: 250000000 },
      { id: "k3", type: "kpi", title: "平均単価", collection: "orders", span: 1, measure: { kind: "avg", field: "amount" }, unit: "currency" },
      { id: "k4", type: "kpi", title: "受注件数", collection: "orders", span: 1, measure: { kind: "count" } },
      {
        id: "s1", type: "bar", title: "月次売上", collection: "orders", span: 2,
        dateField: "ordered_at", bucket: "month", rangeCount: 6,
        measures: [{ label: "売上", measure: { kind: "sum", field: "amount" }, color: "khaki" }],
      },
      { id: "b1", type: "donut", title: "商品別の売上", collection: "orders", span: 1, groupBy: "product", measure: { kind: "sum", field: "amount" }, limit: 5 },
      { id: "b2", type: "hbar", title: "地域別の売上", collection: "orders", span: 1, groupBy: "region", measure: { kind: "sum", field: "amount" }, limit: 6 },
      { id: "t1", type: "table", title: "直近の受注", collection: "orders", span: 4, columns: ["product", "amount", "owner", "region", "ordered_at"], sort: { field: "ordered_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "sales-accounts",
    category: "sales",
    name: "顧客・アカウント管理ダッシュボード",
    description: "顧客を業種・ステータス・LTVで整理し、担当別の状況と接触状況を把握。",
    icon: "users",
    color: "info",
    collections: [
      {
        name: "顧客",
        slug: "accounts",
        icon: "users",
        color: "info",
        sampleRows: 120,
        fields: [
          { key: "company", name: "会社名", type: "text", required: true },
          { key: "industry", name: "業種", type: "select", options: INDUSTRY },
          { key: "status", name: "ステータス", type: "select", required: true, options: ACCOUNT_STATUS, sample: { weights: [4, 5, 2] } },
          { key: "ltv", name: "LTV", type: "currency", sample: { min: 300000, max: 20000000 } },
          { key: "owner", name: "担当", type: "text" },
          { key: "last_contact_at", name: "最終接触日", type: "date", sample: { daysBack: 90, trend: "down" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "顧客数", collection: "accounts", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "総LTV", collection: "accounts", span: 1, measure: { kind: "sum", field: "ltv" }, unit: "currency" },
      { id: "k3", type: "kpi", title: "既存顧客率", collection: "accounts", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "status", op: "eq", value: "active" }] },
      { id: "k4", type: "kpi", title: "平均LTV", collection: "accounts", span: 1, measure: { kind: "avg", field: "ltv" }, unit: "currency" },
      { id: "b1", type: "donut", title: "業種別の内訳", collection: "accounts", span: 2, groupBy: "industry", measure: { kind: "count" }, limit: 7 },
      { id: "b2", type: "hbar", title: "ステータス別の件数", collection: "accounts", span: 2, groupBy: "status", measure: { kind: "count" }, limit: 3 },
      { id: "t1", type: "table", title: "顧客一覧", collection: "accounts", span: 4, columns: ["company", "industry", "status", "ltv", "owner", "last_contact_at"], sort: { field: "ltv", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "sales-activities",
    category: "sales",
    name: "営業活動ダッシュボード",
    description: "訪問・架電・メールなどの営業活動量とアポ獲得率を担当別に追跡。",
    icon: "check-square",
    color: "warning",
    collections: [
      {
        name: "営業活動",
        slug: "activities",
        icon: "check-square",
        color: "warning",
        sampleRows: 180,
        fields: [
          { key: "type", name: "種別", type: "select", required: true, options: ACTIVITY_TYPE, sample: { weights: [3, 4, 5] } },
          { key: "owner", name: "担当", type: "text" },
          { key: "account", name: "対象顧客", type: "text" },
          { key: "outcome", name: "成果", type: "select", options: OUTCOME, sample: { weights: [3, 4, 3] } },
          { key: "acted_at", name: "実施日", type: "date", required: true, sample: { daysBack: 45, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "今週の活動数", collection: "activities", span: 1, measure: { kind: "count" }, delta: { dateField: "acted_at", period: "week" }, icon: "check-square" },
      { id: "k2", type: "kpi", title: "アポ獲得率", collection: "activities", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "outcome", op: "eq", value: "appointment" }] },
      { id: "k3", type: "kpi", title: "訪問数", collection: "activities", span: 1, measure: { kind: "count" }, filters: [{ field: "type", op: "eq", value: "visit" }] },
      { id: "k4", type: "kpi", title: "アポ獲得件数", collection: "activities", span: 1, measure: { kind: "count" }, filters: [{ field: "outcome", op: "eq", value: "appointment" }] },
      {
        id: "s1", type: "line", title: "活動量の推移", collection: "activities", span: 2,
        dateField: "acted_at", bucket: "day", rangeCount: 21,
        measures: [{ label: "活動数", measure: { kind: "count" }, color: "khaki" }],
      },
      { id: "b1", type: "donut", title: "種別の内訳", collection: "activities", span: 1, groupBy: "type", measure: { kind: "count" }, limit: 3 },
      { id: "b2", type: "hbar", title: "担当別の活動数", collection: "activities", span: 1, groupBy: "owner", measure: { kind: "count" }, limit: 6 },
      { id: "t1", type: "table", title: "直近の活動", collection: "activities", span: 4, columns: ["type", "owner", "account", "outcome", "acted_at"], sort: { field: "acted_at", dir: "desc" }, limit: 8 },
    ],
  },
];
