/**
 * Category: 人事・HR (hr)
 *
 * Shape mirrors ./support.ts (the reference implementation): each template is a
 * set of collections (fields + light sample hints) plus a widget layout on a
 * 4-column grid (widget `span` sums to 4 per visual row).
 */
import type { DashboardTemplate } from "../widgets";

const STAGE = [
  { label: "応募", value: "applied", color: "info" },
  { label: "書類", value: "screening", color: "info" },
  { label: "一次", value: "first", color: "warning" },
  { label: "最終", value: "final", color: "warning" },
  { label: "内定", value: "offer", color: "success" },
  { label: "見送り", value: "rejected", color: "danger" },
];
const ROLE = [
  { label: "エンジニア", value: "engineer" },
  { label: "営業", value: "sales" },
  { label: "デザイナー", value: "designer" },
  { label: "コーポレート", value: "corporate" },
  { label: "マーケティング", value: "marketing" },
];
const CHANNEL = [
  { label: "求人媒体", value: "job_board" },
  { label: "紹介", value: "referral" },
  { label: "自社サイト", value: "own_site" },
];
const DEPT = [
  { label: "営業部", value: "sales" },
  { label: "開発部", value: "dev" },
  { label: "管理部", value: "admin" },
  { label: "マーケティング部", value: "marketing" },
  { label: "人事部", value: "hr" },
];
const POSITION = [
  { label: "メンバー", value: "member" },
  { label: "リーダー", value: "leader" },
  { label: "マネージャー", value: "manager" },
  { label: "部長", value: "director" },
];
const EMPLOYMENT = [
  { label: "正社員", value: "fulltime", color: "success" },
  { label: "契約社員", value: "contract", color: "warning" },
  { label: "パート", value: "parttime", color: "info" },
];
const MEETING_TYPE = [
  { label: "1on1", value: "one_on_one" },
  { label: "評価面談", value: "evaluation" },
  { label: "面談", value: "general" },
];

export const hrTemplates: DashboardTemplate[] = [
  {
    key: "hr-recruiting",
    category: "hr",
    name: "採用パイプラインダッシュボード",
    description:
      "候補者を応募から内定まで選考段階で追跡し、チャネル・職種別の状況を可視化。",
    icon: "users",
    color: "info",
    collections: [
      {
        name: "候補者",
        slug: "candidates",
        icon: "users",
        color: "info",
        sampleRows: 120,
        fields: [
          { key: "name", name: "氏名", type: "text", required: true },
          { key: "role", name: "職種", type: "select", options: ROLE },
          { key: "stage", name: "選考段階", type: "select", required: true, options: STAGE, sample: { weights: [5, 4, 3, 2, 2, 4] } },
          { key: "channel", name: "チャネル", type: "select", options: CHANNEL, sample: { weights: [5, 3, 2] } },
          { key: "owner", name: "担当", type: "text" },
          { key: "applied_at", name: "応募日", type: "date", sample: { daysBack: 60, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "今月の応募数", collection: "candidates", span: 1, measure: { kind: "count" }, delta: { dateField: "applied_at", period: "month" }, icon: "users" },
      { id: "k2", type: "kpi", title: "選考中", collection: "candidates", span: 1, measure: { kind: "count" }, filters: [{ field: "stage", op: "in", value: ["screening", "first", "final"] }] },
      { id: "k3", type: "kpi", title: "内定率", collection: "candidates", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "stage", op: "eq", value: "offer" }] },
      { id: "k4", type: "kpi", title: "見送り", collection: "candidates", span: 1, measure: { kind: "count" }, filters: [{ field: "stage", op: "eq", value: "rejected" }] },
      {
        id: "s1", type: "area", title: "応募の推移", collection: "candidates", span: 2,
        dateField: "applied_at", bucket: "day", rangeCount: 30,
        measures: [{ label: "応募", measure: { kind: "count" }, color: "info" }],
      },
      { id: "b1", type: "donut", title: "チャネル別の応募", collection: "candidates", span: 2, groupBy: "channel", measure: { kind: "count" }, limit: 3 },
      { id: "b2", type: "hbar", title: "職種別の候補者", collection: "candidates", span: 2, groupBy: "role", measure: { kind: "count" }, limit: 5 },
      { id: "t1", type: "table", title: "選考中の一覧", collection: "candidates", span: 2, columns: ["name", "role", "stage", "channel", "owner"], sort: { field: "applied_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "hr-attendance",
    category: "hr",
    name: "勤怠管理ダッシュボード",
    description:
      "勤務時間・残業・有給取得を従業員と部門別に集計し、働き方の状況を把握。",
    icon: "check-square",
    color: "warning",
    collections: [
      {
        name: "勤怠",
        slug: "attendance",
        icon: "check-square",
        color: "warning",
        sampleRows: 180,
        fields: [
          { key: "employee", name: "従業員", type: "text", required: true },
          { key: "department", name: "部門", type: "select", options: DEPT },
          { key: "work_hours", name: "勤務時間", type: "number", sample: { min: 6, max: 10 } },
          { key: "overtime_hours", name: "残業時間", type: "number", sample: { min: 0, max: 5, trend: "down" } },
          { key: "paid_leave", name: "有給取得", type: "checkbox", sample: { min: 0.12 } },
          { key: "date", name: "日付", type: "date", sample: { daysBack: 45, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "平均残業時間", collection: "attendance", span: 1, measure: { kind: "avg", field: "overtime_hours" }, icon: "check-square" },
      { id: "k2", type: "kpi", title: "総労働時間", collection: "attendance", span: 1, measure: { kind: "sum", field: "work_hours" } },
      { id: "k3", type: "kpi", title: "有給取得率", collection: "attendance", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "paid_leave", op: "truthy" }] },
      { id: "k4", type: "kpi", title: "平均勤務時間", collection: "attendance", span: 1, measure: { kind: "avg", field: "work_hours" } },
      {
        id: "s1", type: "line", title: "残業時間の推移", collection: "attendance", span: 2,
        dateField: "date", bucket: "day", rangeCount: 21,
        measures: [{ label: "平均残業(時間)", measure: { kind: "avg", field: "overtime_hours" }, color: "warning" }],
      },
      { id: "b1", type: "donut", title: "部門別の勤怠件数", collection: "attendance", span: 2, groupBy: "department", measure: { kind: "count" }, limit: 5 },
      { id: "b2", type: "hbar", title: "従業員別の残業時間", collection: "attendance", span: 2, groupBy: "employee", measure: { kind: "sum", field: "overtime_hours" }, limit: 8 },
      { id: "t1", type: "table", title: "直近の勤怠", collection: "attendance", span: 2, columns: ["date", "employee", "department", "work_hours", "overtime_hours"], sort: { field: "date", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "hr-roster",
    category: "hr",
    name: "従業員名簿・組織ダッシュボード",
    description:
      "従業員の部門・役職・雇用形態・評価を集計し、組織の構成を一望。",
    icon: "users",
    color: "info",
    collections: [
      {
        name: "従業員",
        slug: "employees",
        icon: "users",
        color: "info",
        sampleRows: 90,
        fields: [
          { key: "name", name: "氏名", type: "text", required: true },
          { key: "department", name: "部門", type: "select", options: DEPT },
          { key: "position", name: "役職", type: "select", options: POSITION, sample: { weights: [6, 3, 2, 1] } },
          { key: "employment", name: "雇用形態", type: "select", options: EMPLOYMENT, sample: { weights: [6, 2, 2] } },
          { key: "hired_at", name: "入社日", type: "date", sample: { daysBack: 120 } },
          { key: "tenure_years", name: "勤続年数", type: "number", sample: { min: 1, max: 12 } },
          { key: "rating", name: "評価(1-5)", type: "number", sample: { min: 2, max: 5 } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "従業員数", collection: "employees", span: 1, measure: { kind: "count" }, icon: "users" },
      { id: "k2", type: "kpi", title: "正社員率", collection: "employees", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "employment", op: "eq", value: "fulltime" }] },
      { id: "k3", type: "kpi", title: "平均勤続年数", collection: "employees", span: 1, measure: { kind: "avg", field: "tenure_years" } },
      { id: "k4", type: "kpi", title: "平均評価", collection: "employees", span: 1, measure: { kind: "avg", field: "rating" }, target: 4 },
      { id: "b1", type: "donut", title: "部門別の人数", collection: "employees", span: 2, groupBy: "department", measure: { kind: "count" }, limit: 5 },
      { id: "b2", type: "hbar", title: "役職別の人数", collection: "employees", span: 2, groupBy: "position", measure: { kind: "count" }, limit: 4 },
      { id: "t1", type: "table", title: "従業員一覧", collection: "employees", span: 4, columns: ["name", "department", "position", "employment", "rating"], sort: { field: "hired_at", dir: "desc" }, limit: 10 },
    ],
  },

  {
    key: "hr-engagement",
    category: "hr",
    name: "エンゲージメント・1on1ダッシュボード",
    description:
      "1on1や面談の満足度・フォロー要否を記録し、従業員エンゲージメントを可視化。",
    icon: "sparkles",
    color: "info",
    collections: [
      {
        name: "面談",
        slug: "one-on-ones",
        icon: "sparkles",
        color: "info",
        sampleRows: 110,
        fields: [
          { key: "employee", name: "従業員", type: "text", required: true },
          { key: "interviewer", name: "実施者", type: "text" },
          { key: "satisfaction", name: "満足度(1-5)", type: "number", required: true, sample: { min: 2, max: 5, trend: "up" } },
          { key: "type", name: "種別", type: "select", options: MEETING_TYPE, sample: { weights: [6, 2, 2] } },
          { key: "followup", name: "フォロー要", type: "checkbox", sample: { min: 0.28 } },
          { key: "date", name: "日付", type: "date", sample: { daysBack: 60, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "平均満足度", collection: "one-on-ones", span: 1, measure: { kind: "avg", field: "satisfaction" }, target: 4, icon: "sparkles" },
      { id: "k2", type: "kpi", title: "今月の実施数", collection: "one-on-ones", span: 1, measure: { kind: "count" }, delta: { dateField: "date", period: "month" } },
      { id: "k3", type: "kpi", title: "フォロー要率", collection: "one-on-ones", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "followup", op: "truthy" }] },
      { id: "k4", type: "kpi", title: "実施件数", collection: "one-on-ones", span: 1, measure: { kind: "count" } },
      {
        id: "s1", type: "area", title: "満足度の推移", collection: "one-on-ones", span: 2,
        dateField: "date", bucket: "week", rangeCount: 9,
        measures: [{ label: "平均満足度", measure: { kind: "avg", field: "satisfaction" }, color: "khaki" }],
      },
      { id: "b1", type: "donut", title: "種別の内訳", collection: "one-on-ones", span: 2, groupBy: "type", measure: { kind: "count" }, limit: 3 },
      { id: "t1", type: "table", title: "直近の面談", collection: "one-on-ones", span: 4, columns: ["date", "employee", "interviewer", "type", "satisfaction"], sort: { field: "date", dir: "desc" }, limit: 8 },
    ],
  },
];
