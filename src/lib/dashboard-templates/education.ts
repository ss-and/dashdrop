/**
 * Category: 教育・スクール (education) — dashboard templates.
 * Populated to match the shape in ./support.ts (the reference implementation).
 */
import type { DashboardTemplate } from "../widgets";

const COURSE = [
  { label: "英会話", value: "english" },
  { label: "プログラミング", value: "programming" },
  { label: "受験対策", value: "exam" },
  { label: "資格講座", value: "license" },
  { label: "キッズクラス", value: "kids" },
];
const PLAN = [
  { label: "月4回", value: "m4", color: "neutral" },
  { label: "月8回", value: "m8", color: "info" },
  { label: "通い放題", value: "unlimited", color: "success" },
  { label: "単発", value: "single", color: "warning" },
];
const ENROLL_STATUS = [
  { label: "体験", value: "trial", color: "warning" },
  { label: "受講中", value: "active", color: "success" },
  { label: "休会", value: "paused", color: "neutral" },
  { label: "退会", value: "withdrawn", color: "danger" },
];
const ATTEND_STATUS = [
  { label: "出席", value: "attended", color: "success" },
  { label: "遅刻", value: "late", color: "warning" },
  { label: "欠席", value: "absent", color: "danger" },
  { label: "振替", value: "makeup", color: "info" },
];
const CLASSROOM = [
  { label: "本校", value: "main" },
  { label: "第2教室", value: "room2" },
  { label: "オンライン", value: "online" },
];

export const educationTemplates: DashboardTemplate[] = [
  {
    key: "education-students",
    category: "education",
    name: "受講生管理ダッシュボード",
    description:
      "学習塾・スクール向けに、受講生の在籍状況と月謝売上・コース別の人数を管理。",
    icon: "users",
    color: "khaki",
    collections: [
      {
        name: "受講生",
        slug: "students",
        icon: "users",
        color: "khaki",
        sampleRows: 110,
        fields: [
          { key: "student_name", name: "受講生名", type: "text", required: true },
          { key: "course", name: "コース", type: "select", required: true, options: COURSE, sample: { weights: [5, 4, 4, 2, 3] } },
          { key: "plan", name: "受講プラン", type: "select", required: true, options: PLAN, sample: { weights: [5, 4, 2, 2] } },
          { key: "status", name: "在籍状況", type: "select", required: true, options: ENROLL_STATUS, sample: { weights: [2, 8, 2, 2] } },
          { key: "monthly_fee", name: "月謝", type: "currency", required: true, sample: { min: 6000, max: 46000 } },
          { key: "teacher", name: "担当講師", type: "text" },
          { key: "months_enrolled", name: "在籍月数", type: "number", sample: { min: 1, max: 42 } },
          { key: "enrolled_at", name: "入会日", type: "date", required: true, sample: { daysBack: 300, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "受講生数", collection: "students", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "月謝売上", collection: "students", span: 1, measure: { kind: "sum", field: "monthly_fee" }, unit: "currency", filters: [{ field: "status", op: "eq", value: "active" }] },
      { id: "k3", type: "kpi", title: "在籍率", collection: "students", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "status", op: "eq", value: "active" }] },
      { id: "k4", type: "kpi", title: "平均在籍月数", collection: "students", span: 1, measure: { kind: "avg", field: "months_enrolled" } },
      {
        id: "s1", type: "bar", title: "入会数の推移", collection: "students", span: 2,
        dateField: "enrolled_at", bucket: "month", rangeCount: 10,
        measures: [
          { label: "入会数", measure: { kind: "count" }, color: "khaki" },
          { label: "うち体験から", measure: { kind: "count" }, filters: [{ field: "status", op: "eq", value: "trial" }], color: "warning" },
        ],
      },
      { id: "b1", type: "donut", title: "コース別の人数", collection: "students", span: 1, groupBy: "course", measure: { kind: "count" }, limit: 5 },
      { id: "b2", type: "hbar", title: "プラン別の月謝売上", collection: "students", span: 1, groupBy: "plan", measure: { kind: "sum", field: "monthly_fee" }, limit: 4 },
      { id: "t1", type: "table", title: "受講生一覧", collection: "students", span: 4, columns: ["student_name", "course", "plan", "status", "monthly_fee", "teacher", "months_enrolled", "enrolled_at"], sort: { field: "enrolled_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "education-attendance",
    category: "education",
    name: "出席・継続率ダッシュボード",
    description:
      "授業ごとの出席・欠席・振替を集計し、教室別の出席率と継続リスクを講師が確認。",
    icon: "check-square",
    color: "info",
    collections: [
      {
        name: "出席記録",
        slug: "attendance",
        icon: "check-square",
        color: "info",
        sampleRows: 120,
        fields: [
          { key: "student_name", name: "受講生名", type: "text", required: true },
          { key: "course", name: "コース", type: "select", required: true, options: COURSE },
          { key: "classroom", name: "教室", type: "select", options: CLASSROOM, sample: { weights: [5, 3, 3] } },
          { key: "status", name: "出欠", type: "select", required: true, options: ATTEND_STATUS, sample: { weights: [8, 2, 2, 1] } },
          { key: "teacher", name: "担当講師", type: "text" },
          { key: "duration_min", name: "授業時間(分)", type: "number", sample: { min: 45, max: 120 } },
          { key: "class_date", name: "授業日", type: "date", required: true, sample: { daysBack: 60, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "授業回数", collection: "attendance", span: 1, measure: { kind: "count" } },
      { id: "k2", type: "kpi", title: "出席率", collection: "attendance", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "status", op: "in", value: ["attended", "late"] }] },
      { id: "k3", type: "kpi", title: "欠席件数", collection: "attendance", span: 1, measure: { kind: "count" }, filters: [{ field: "status", op: "eq", value: "absent" }] },
      { id: "k4", type: "kpi", title: "振替率", collection: "attendance", span: 1, measure: { kind: "count" }, unit: "percent", rateNumerator: [{ field: "status", op: "eq", value: "makeup" }] },
      {
        id: "s1", type: "line", title: "出席・欠席の推移", collection: "attendance", span: 2,
        dateField: "class_date", bucket: "week", rangeCount: 10,
        measures: [
          { label: "出席", measure: { kind: "count" }, filters: [{ field: "status", op: "eq", value: "attended" }], color: "success" },
          { label: "欠席", measure: { kind: "count" }, filters: [{ field: "status", op: "eq", value: "absent" }], color: "danger" },
        ],
      },
      { id: "b1", type: "donut", title: "出欠区分の内訳", collection: "attendance", span: 1, groupBy: "status", measure: { kind: "count" }, limit: 4 },
      { id: "b2", type: "hbar", title: "教室別の授業数", collection: "attendance", span: 1, groupBy: "classroom", measure: { kind: "count" }, limit: 3 },
      { id: "t1", type: "table", title: "直近の欠席記録", collection: "attendance", span: 4, columns: ["class_date", "student_name", "course", "classroom", "status", "teacher", "duration_min"], sort: { field: "class_date", dir: "desc" }, limit: 8, filters: [{ field: "status", op: "eq", value: "absent" }] },
    ],
  },
];
