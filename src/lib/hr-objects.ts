/**
 * The HR core — 社員・人事のマスターデータベース.
 *
 * A sibling of `src/lib/crm-objects.ts`: the same definition format, the same
 * install mechanics (see src/lib/install-hr.ts), the same look. Where the CRM
 * accumulates a customer database, this accumulates the 社員名簿 and the
 * records that hang off it — 部署 / 勤怠 / 休暇申請 / 評価 — as first-class
 * objects with typed fields and real relations.
 *
 * ---------------------------------------------------------------------------
 * 個人情報の取り扱いについて（意図的に持たない項目 — 追加しないこと）
 * ---------------------------------------------------------------------------
 * - マイナンバー（個人番号）は **入れない**。番号法（マイナンバー法）上の
 *   特定個人情報にあたり、収集目的の限定・保管場所の分離・アクセスログ・
 *   保管期限経過後の確実な廃棄といった義務が課される。DashDrop はこれらの
 *   仕組みを実装していないため、「一応あると便利だから」と後から項目を
 *   足さないこと。給与支払報告等で必要になった場合は、対応する専用システムで
 *   管理する。
 * - 健康診断結果・病歴・障害の有無・国籍・信条・出身などは **入れない**。
 *   個人情報保護法の要配慮個人情報にあたり、取得に本人の明示的な同意が要る。
 *   汎用スプレッドシート製品が既定のテンプレートとして持つべきものではない。
 * - 基本給・生年月日は通常の個人情報として保持してよいが、社内でも閲覧を
 *   絞るべき機微な項目。将来フィールド単位のアクセス制御を入れる際は、
 *   まずこの 2 項目を対象にすること。
 *
 * Definitions only — no DB access — so this module is safe to import anywhere.
 */
import type { FieldType, SelectOption } from "./field-types";

export type HrSlug =
  | "hr-departments"
  | "hr-employees"
  | "hr-attendance"
  | "hr-leave-requests"
  | "hr-reviews";

export interface HrField {
  key: string;
  name: string;
  type: FieldType;
  required?: boolean;
  options?: SelectOption[];
  /** For `relation` fields: which HR object this points at. */
  relation?: { to: HrSlug; multiple?: boolean; displayFieldKey?: string };
  /** For `lookup` fields: pull `target` through the relation field `via`. */
  lookup?: { via: string; target: string };
  /** For `rollup` fields: aggregate `target` across records linked by `via`. */
  rollup?: { via: string; target: string; op: "sum" | "count" | "avg" | "min" | "max" };
  /** For `formula` fields: an expression over this row's other fields. */
  formula?: { expression: string };
}

export interface HrObject {
  slug: HrSlug;
  name: string;
  /** Short plural label used in nav/launcher. */
  description: string;
  icon: string;
  color: string;
  fields: HrField[];
  /** Columns to show in the Salesforce-style list view, in order. */
  listColumns: string[];
  /**
   * Demo rows. Relations are expressed by the *display name* of the target
   * record (e.g. employee: "佐々木 隆"); the installer resolves them to ids.
   */
  samples: Record<string, unknown>[];
}

/* ------------------------------- option sets ------------------------------ */

const EMPLOYMENT_TYPE: SelectOption[] = [
  { label: "正社員", value: "fulltime" },
  { label: "契約社員", value: "contract" },
  { label: "パート・アルバイト", value: "parttime" },
  { label: "業務委託", value: "outsourced" },
];

const EMPLOYEE_STATUS: SelectOption[] = [
  { label: "在籍", value: "active", color: "success" },
  { label: "休職", value: "leave", color: "warning" },
  { label: "退職", value: "retired", color: "khaki" },
];

const ATTENDANCE_CATEGORY: SelectOption[] = [
  { label: "通常出勤", value: "normal", color: "success" },
  { label: "リモート", value: "remote", color: "info" },
  { label: "有給", value: "paid_leave", color: "info" },
  { label: "欠勤", value: "absent", color: "danger" },
  { label: "休日出勤", value: "holiday_work", color: "warning" },
];

const LEAVE_TYPE: SelectOption[] = [
  { label: "有給休暇", value: "paid" },
  { label: "慶弔休暇", value: "condolence" },
  { label: "産前産後・育児", value: "parental" },
  { label: "特別休暇", value: "special" },
  { label: "欠勤", value: "absence" },
];

const LEAVE_STATUS: SelectOption[] = [
  { label: "申請中", value: "pending", color: "warning" },
  { label: "承認", value: "approved", color: "success" },
  { label: "却下", value: "rejected", color: "danger" },
];

const REVIEW_RATING: SelectOption[] = [
  { label: "S", value: "s", color: "success" },
  { label: "A", value: "a", color: "success" },
  { label: "B", value: "b", color: "info" },
  { label: "C", value: "c", color: "warning" },
  { label: "D", value: "d", color: "danger" },
];

/* --------------------------------- objects -------------------------------- */

const DEPARTMENTS: HrObject = {
  slug: "hr-departments",
  name: "部署",
  description: "組織と拠点のマスター",
  icon: "users",
  color: "khaki",
  listColumns: ["name", "code", "manager", "office", "headcountTarget"],
  fields: [
    { key: "name", name: "部署名", type: "text", required: true },
    { key: "code", name: "部門コード", type: "text" },
    { key: "manager", name: "責任者", type: "text" },
    { key: "office", name: "拠点", type: "text" },
    { key: "headcountTarget", name: "人数目標", type: "number" },
    { key: "note", name: "備考", type: "longtext" },
  ],
  samples: [
    { name: "営業部", code: "SAL", manager: "佐々木 隆", office: "東京本社", headcountTarget: 6, note: "首都圏・関西の法人営業を担当。" },
    { name: "製造部", code: "MFG", manager: "高橋 直人", office: "厚木工場", headcountTarget: 12, note: "二交替。繁忙期は休日出勤あり。" },
    { name: "管理部", code: "ADM", manager: "藤井 理恵", office: "東京本社", headcountTarget: 4, note: "経理・総務・人事を兼務。" },
    { name: "開発部", code: "DEV", manager: "中野 拓海", office: "東京本社", headcountTarget: 5, note: "リモート勤務を標準運用。" },
  ],
};

const EMPLOYEES: HrObject = {
  slug: "hr-employees",
  name: "社員",
  description: "社員名簿のマスター",
  icon: "users",
  color: "khaki",
  listColumns: [
    "name",
    "employeeNo",
    "department",
    "position",
    "employmentType",
    "status",
    "joinedOn",
  ],
  fields: [
    { key: "name", name: "氏名", type: "text", required: true },
    { key: "employeeNo", name: "社員番号", type: "text" },
    {
      key: "department",
      name: "部署",
      type: "relation",
      relation: { to: "hr-departments", displayFieldKey: "name" },
    },
    { key: "position", name: "役職", type: "text" },
    { key: "employmentType", name: "雇用形態", type: "select", options: EMPLOYMENT_TYPE },
    { key: "joinedOn", name: "入社日", type: "date" },
    { key: "status", name: "在籍状況", type: "select", options: EMPLOYEE_STATUS },
    { key: "email", name: "メール", type: "email" },
    { key: "phone", name: "電話", type: "phone" },
    // 基本給・生年月日: ordinary personal data, but see the note at the top of
    // this file — the first candidates for field-level access control.
    { key: "baseSalary", name: "基本給（月額）", type: "currency" },
    { key: "birthday", name: "生年月日", type: "date" },
    {
      key: "departmentCode",
      name: "部門コード",
      type: "lookup",
      lookup: { via: "department", target: "code" },
    },
    {
      key: "office",
      name: "勤務拠点",
      type: "lookup",
      lookup: { via: "department", target: "office" },
    },
    { key: "note", name: "備考", type: "longtext" },
  ],
  samples: [
    { name: "佐々木 隆", employeeNo: "EMP-001", department: "営業部", position: "部長", employmentType: "fulltime", joinedOn: "2012-04-01", status: "active", email: "sasaki@example.co.jp", phone: "03-5555-0101", baseSalary: 520000, birthday: "1980-05-12", note: "営業部の統括。主要顧客の最終折衝を担当。" },
    { name: "木村 彩香", employeeNo: "EMP-002", department: "営業部", position: "主任", employmentType: "contract", joinedOn: "2021-10-01", status: "active", email: "kimura@example.co.jp", phone: "03-5555-0102", baseSalary: 310000, birthday: "1993-11-03" },
    { name: "大西 誠", employeeNo: "EMP-003", department: "営業部", position: "担当", employmentType: "fulltime", joinedOn: "2018-04-01", status: "retired", email: "onishi@example.co.jp", phone: "03-5555-0103", baseSalary: 340000, birthday: "1990-02-20", note: "2026-06-30 付で退職。引き継ぎ完了。" },
    { name: "高橋 直人", employeeNo: "EMP-004", department: "製造部", position: "課長", employmentType: "fulltime", joinedOn: "2009-04-01", status: "active", email: "takahashi@example.co.jp", phone: "046-555-0201", baseSalary: 480000, birthday: "1977-08-30", note: "厚木工場の生産計画を担当。" },
    { name: "森田 早苗", employeeNo: "EMP-005", department: "製造部", position: "主任", employmentType: "fulltime", joinedOn: "2016-04-01", status: "leave", email: "morita@example.co.jp", phone: "046-555-0202", baseSalary: 360000, birthday: "1988-01-17", note: "育児休業中（2026-12 復職予定）。" },
    { name: "岡田 亮太", employeeNo: "EMP-006", department: "製造部", position: "担当", employmentType: "fulltime", joinedOn: "2022-04-01", status: "active", email: "okada@example.co.jp", phone: "046-555-0203", baseSalary: 280000, birthday: "1999-06-09" },
    { name: "藤井 理恵", employeeNo: "EMP-007", department: "管理部", position: "部長", employmentType: "fulltime", joinedOn: "2010-09-01", status: "active", email: "fujii@example.co.jp", phone: "03-5555-0301", baseSalary: 500000, birthday: "1979-03-25", note: "人事・給与計算の責任者。" },
    { name: "石井 光", employeeNo: "EMP-008", department: "管理部", position: "事務", employmentType: "parttime", joinedOn: "2023-06-01", status: "active", email: "ishii@example.co.jp", phone: "03-5555-0302", baseSalary: 150000, birthday: "1995-12-01", note: "週4日・10:00〜16:00 勤務。" },
    { name: "中野 拓海", employeeNo: "EMP-009", department: "開発部", position: "リーダー", employmentType: "fulltime", joinedOn: "2019-01-16", status: "active", email: "nakano@example.co.jp", phone: "03-5555-0401", baseSalary: 460000, birthday: "1986-07-07", note: "基幹システムの内製開発を担当。" },
    { name: "白石 由紀", employeeNo: "EMP-010", department: "開発部", position: "エンジニア", employmentType: "outsourced", joinedOn: "2025-04-01", status: "active", email: "shiraishi@example.co.jp", phone: "03-5555-0402", baseSalary: 400000, birthday: "1992-09-14", note: "業務委託。稼働は月120時間想定。" },
  ],
};

const ATTENDANCE: HrObject = {
  slug: "hr-attendance",
  name: "勤怠",
  description: "日々の出退勤の記録",
  icon: "inbox",
  color: "khaki",
  listColumns: [
    "date",
    "employee",
    "checkIn",
    "checkOut",
    "breakMinutes",
    "workHours",
    "category",
  ],
  fields: [
    // The primary field is a text 勤怠番号 rather than the date itself: the
    // installer labels records by the first required text field, and a date is
    // not unique per employee.
    { key: "recordNo", name: "勤怠番号", type: "text", required: true },
    { key: "date", name: "日付", type: "date" },
    {
      key: "employee",
      name: "社員",
      type: "relation",
      relation: { to: "hr-employees", displayFieldKey: "name" },
    },
    { key: "checkIn", name: "出勤", type: "text" },
    { key: "checkOut", name: "退勤", type: "text" },
    { key: "breakMinutes", name: "休憩時間（分）", type: "number" },
    { key: "workHours", name: "実働時間", type: "number" },
    {
      key: "overtimeHours",
      name: "残業時間",
      type: "formula",
      // 所定労働 8 時間を超えた分。負にならないよう MAX で丸める。
      formula: { expression: "ROUND(MAX({workHours} - 8, 0), 2)" },
    },
    { key: "category", name: "区分", type: "select", options: ATTENDANCE_CATEGORY },
    {
      key: "employeeNo",
      name: "社員番号",
      type: "lookup",
      lookup: { via: "employee", target: "employeeNo" },
    },
    { key: "note", name: "備考", type: "longtext" },
  ],
  samples: [
    { recordNo: "ATT-2026-0801", date: "2026-08-03", employee: "佐々木 隆", checkIn: "08:55", checkOut: "18:10", breakMinutes: 60, workHours: 8.25, category: "normal" },
    { recordNo: "ATT-2026-0802", date: "2026-08-04", employee: "佐々木 隆", checkIn: "08:50", checkOut: "19:40", breakMinutes: 60, workHours: 9.83, category: "normal", note: "アオイ製作所へ往訪。直帰せず帰社。" },
    { recordNo: "ATT-2026-0803", date: "2026-08-05", employee: "佐々木 隆", checkIn: "09:00", checkOut: "18:00", breakMinutes: 60, workHours: 8, category: "normal" },
    { recordNo: "ATT-2026-0804", date: "2026-08-06", employee: "佐々木 隆", checkIn: "09:00", checkOut: "17:30", breakMinutes: 60, workHours: 7.5, category: "remote" },
    { recordNo: "ATT-2026-0805", date: "2026-08-07", employee: "佐々木 隆", checkIn: "08:58", checkOut: "18:05", breakMinutes: 60, workHours: 8.12, category: "normal" },
    { recordNo: "ATT-2026-0806", date: "2026-08-10", employee: "佐々木 隆", category: "paid_leave", note: "夏季休暇。" },
    { recordNo: "ATT-2026-0807", date: "2026-08-11", employee: "佐々木 隆", checkIn: "09:05", checkOut: "18:20", breakMinutes: 60, workHours: 8.25, category: "normal" },
    { recordNo: "ATT-2026-0808", date: "2026-08-12", employee: "佐々木 隆", checkIn: "08:45", checkOut: "20:15", breakMinutes: 60, workHours: 10.5, category: "normal", note: "上期の受注見込みレビュー対応。" },
    { recordNo: "ATT-2026-0809", date: "2026-08-13", employee: "佐々木 隆", checkIn: "09:00", checkOut: "18:00", breakMinutes: 60, workHours: 8, category: "normal" },
    { recordNo: "ATT-2026-0810", date: "2026-08-14", employee: "佐々木 隆", checkIn: "09:00", checkOut: "17:45", breakMinutes: 60, workHours: 7.75, category: "normal" },
    { recordNo: "ATT-2026-0811", date: "2026-08-03", employee: "中野 拓海", checkIn: "09:30", checkOut: "18:30", breakMinutes: 60, workHours: 8, category: "remote" },
    { recordNo: "ATT-2026-0812", date: "2026-08-04", employee: "中野 拓海", checkIn: "09:30", checkOut: "19:00", breakMinutes: 60, workHours: 8.5, category: "remote" },
    { recordNo: "ATT-2026-0813", date: "2026-08-05", employee: "中野 拓海", checkIn: "09:00", checkOut: "18:00", breakMinutes: 60, workHours: 8, category: "normal", note: "月次の全体会議のため出社。" },
    { recordNo: "ATT-2026-0814", date: "2026-08-06", employee: "中野 拓海", checkIn: "09:30", checkOut: "18:30", breakMinutes: 60, workHours: 8, category: "remote" },
    { recordNo: "ATT-2026-0815", date: "2026-08-07", employee: "中野 拓海", checkIn: "09:30", checkOut: "21:00", breakMinutes: 60, workHours: 10.5, category: "remote", note: "リリース対応。" },
    { recordNo: "ATT-2026-0816", date: "2026-08-10", employee: "中野 拓海", checkIn: "09:30", checkOut: "18:30", breakMinutes: 60, workHours: 8, category: "remote" },
    { recordNo: "ATT-2026-0817", date: "2026-08-11", employee: "中野 拓海", category: "paid_leave", note: "半日ではなく終日取得。" },
    { recordNo: "ATT-2026-0818", date: "2026-08-12", employee: "中野 拓海", checkIn: "09:30", checkOut: "18:00", breakMinutes: 60, workHours: 7.5, category: "remote" },
    { recordNo: "ATT-2026-0819", date: "2026-08-13", employee: "中野 拓海", checkIn: "09:00", checkOut: "18:15", breakMinutes: 60, workHours: 8.25, category: "normal" },
    { recordNo: "ATT-2026-0820", date: "2026-08-14", employee: "中野 拓海", checkIn: "09:30", checkOut: "18:30", breakMinutes: 60, workHours: 8, category: "remote" },
    { recordNo: "ATT-2026-0821", date: "2026-08-03", employee: "高橋 直人", checkIn: "07:55", checkOut: "17:05", breakMinutes: 60, workHours: 8.17, category: "normal" },
    { recordNo: "ATT-2026-0822", date: "2026-08-04", employee: "高橋 直人", checkIn: "07:50", checkOut: "18:40", breakMinutes: 60, workHours: 9.83, category: "normal", note: "第2ラインの立ち上げに立ち会い。" },
    { recordNo: "ATT-2026-0823", date: "2026-08-05", employee: "高橋 直人", checkIn: "07:55", checkOut: "17:00", breakMinutes: 60, workHours: 8.08, category: "normal" },
    { recordNo: "ATT-2026-0824", date: "2026-08-06", employee: "高橋 直人", category: "absent", note: "体調不良のため欠勤の連絡あり。" },
    { recordNo: "ATT-2026-0825", date: "2026-08-07", employee: "高橋 直人", checkIn: "07:55", checkOut: "17:10", breakMinutes: 60, workHours: 8.25, category: "normal" },
    { recordNo: "ATT-2026-0826", date: "2026-08-15", employee: "高橋 直人", checkIn: "08:00", checkOut: "13:00", breakMinutes: 0, workHours: 5, category: "holiday_work", note: "設備メンテナンス立ち会い。代休取得予定。" },
    { recordNo: "ATT-2026-0827", date: "2026-08-03", employee: "岡田 亮太", checkIn: "07:58", checkOut: "17:00", breakMinutes: 60, workHours: 8.03, category: "normal" },
    { recordNo: "ATT-2026-0828", date: "2026-08-04", employee: "岡田 亮太", checkIn: "07:57", checkOut: "19:20", breakMinutes: 60, workHours: 10.38, category: "normal", note: "増産対応で残業。" },
    { recordNo: "ATT-2026-0829", date: "2026-08-05", employee: "石井 光", checkIn: "10:00", checkOut: "16:00", breakMinutes: 45, workHours: 5.25, category: "normal" },
    { recordNo: "ATT-2026-0830", date: "2026-08-06", employee: "石井 光", checkIn: "10:00", checkOut: "16:00", breakMinutes: 45, workHours: 5.25, category: "normal" },
  ],
};

const LEAVE_REQUESTS: HrObject = {
  slug: "hr-leave-requests",
  name: "休暇申請",
  description: "休暇の申請と承認",
  icon: "inbox",
  color: "khaki",
  listColumns: ["number", "employee", "type", "startDate", "endDate", "status"],
  fields: [
    { key: "number", name: "申請番号", type: "text", required: true },
    {
      key: "employee",
      name: "社員",
      type: "relation",
      relation: { to: "hr-employees", displayFieldKey: "name" },
    },
    { key: "type", name: "種別", type: "select", options: LEAVE_TYPE },
    { key: "startDate", name: "開始日", type: "date" },
    { key: "endDate", name: "終了日", type: "date" },
    {
      key: "days",
      name: "日数",
      type: "formula",
      // 開始日と終了日を含む暦日数（同日申請なら 1 日）。
      formula: { expression: "DATEDIFF({startDate}, {endDate}) + 1" },
    },
    { key: "status", name: "状況", type: "select", options: LEAVE_STATUS },
    {
      key: "approvers",
      name: "承認者",
      type: "relation",
      relation: { to: "hr-employees", displayFieldKey: "name", multiple: true },
    },
    {
      key: "approverCount",
      name: "承認者数",
      type: "rollup",
      rollup: { via: "approvers", target: "name", op: "count" },
    },
    {
      key: "employmentType",
      name: "雇用形態",
      type: "lookup",
      lookup: { via: "employee", target: "employmentType" },
    },
    { key: "reason", name: "理由", type: "longtext" },
  ],
  samples: [
    { number: "LV-2026-001", employee: "佐々木 隆", type: "paid", startDate: "2026-08-10", endDate: "2026-08-10", status: "approved", approvers: "藤井 理恵", reason: "夏季休暇の一部を取得。" },
    { number: "LV-2026-002", employee: "中野 拓海", type: "paid", startDate: "2026-08-11", endDate: "2026-08-11", status: "approved", approvers: "藤井 理恵", reason: "私用のため。" },
    { number: "LV-2026-003", employee: "森田 早苗", type: "parental", startDate: "2026-01-05", endDate: "2026-11-30", status: "approved", approvers: "藤井 理恵", reason: "育児休業。復職は2026-12を予定。" },
    { number: "LV-2026-004", employee: "岡田 亮太", type: "condolence", startDate: "2026-07-13", endDate: "2026-07-15", status: "approved", approvers: "高橋 直人", reason: "親族の葬儀のため。" },
    { number: "LV-2026-005", employee: "木村 彩香", type: "paid", startDate: "2026-09-07", endDate: "2026-09-11", status: "pending", approvers: "佐々木 隆", reason: "連続取得の希望。期末の繁忙と重ならないか要確認。" },
    { number: "LV-2026-006", employee: "高橋 直人", type: "special", startDate: "2026-08-24", endDate: "2026-08-24", status: "pending", approvers: "藤井 理恵", reason: "休日出勤（8/15）の代休。" },
    { number: "LV-2026-007", employee: "石井 光", type: "absence", startDate: "2026-06-22", endDate: "2026-06-22", status: "rejected", approvers: "藤井 理恵", reason: "事後申請のため差し戻し。勤怠を欠勤で処理。" },
  ],
};

const REVIEWS: HrObject = {
  slug: "hr-reviews",
  name: "評価",
  description: "人事評価の記録",
  icon: "report",
  color: "khaki",
  listColumns: ["reviewId", "employee", "period", "reviewer", "rating", "achievement"],
  fields: [
    { key: "reviewId", name: "評価ID", type: "text", required: true },
    {
      key: "employee",
      name: "社員",
      type: "relation",
      relation: { to: "hr-employees", displayFieldKey: "name" },
    },
    { key: "period", name: "対象期間", type: "text" },
    { key: "reviewer", name: "評価者", type: "text" },
    { key: "rating", name: "総合評価", type: "select", options: REVIEW_RATING },
    { key: "achievement", name: "目標達成率（%）", type: "number" },
    {
      key: "achievementBand",
      name: "達成度区分",
      type: "formula",
      formula: {
        expression:
          'IF({achievement} >= 120, "大幅達成", IF({achievement} >= 100, "達成", IF({achievement} >= 80, "一部未達", "未達")))',
      },
    },
    {
      key: "position",
      name: "評価時の役職",
      type: "lookup",
      lookup: { via: "employee", target: "position" },
    },
    { key: "comment", name: "コメント", type: "longtext" },
  ],
  samples: [
    { reviewId: "REV-2026H1-001", employee: "佐々木 隆", period: "2026年度 上期", reviewer: "代表取締役", rating: "a", achievement: 112, comment: "主要顧客の維持と新規2社の開拓。部内の育成にも着手。" },
    { reviewId: "REV-2026H1-002", employee: "木村 彩香", period: "2026年度 上期", reviewer: "佐々木 隆", rating: "b", achievement: 96, comment: "受注件数は目標水準。単価改善が次期の課題。" },
    { reviewId: "REV-2026H1-003", employee: "高橋 直人", period: "2026年度 上期", reviewer: "代表取締役", rating: "s", achievement: 128, comment: "増産要請に対しライン組み替えで対応。不良率も低下。" },
    { reviewId: "REV-2026H1-004", employee: "岡田 亮太", period: "2026年度 上期", reviewer: "高橋 直人", rating: "b", achievement: 88, comment: "作業習熟は順調。次期は多能工化を目標に設定。" },
    { reviewId: "REV-2026H1-005", employee: "藤井 理恵", period: "2026年度 上期", reviewer: "代表取締役", rating: "a", achievement: 105, comment: "給与計算の内製化を完了。締め作業の工数を約3割削減。" },
    { reviewId: "REV-2026H1-006", employee: "中野 拓海", period: "2026年度 上期", reviewer: "藤井 理恵", rating: "a", achievement: 118, comment: "基幹システムの刷新を予定どおり進行。運用手順の整備も完了。" },
    { reviewId: "REV-2026H1-007", employee: "石井 光", period: "2026年度 上期", reviewer: "藤井 理恵", rating: "c", achievement: 74, comment: "勤怠の事後申請が続いた。手順の再確認を実施。" },
  ],
};

/** Install order matters: relation targets must exist first. */
export const HR_OBJECTS: HrObject[] = [
  DEPARTMENTS,
  EMPLOYEES,
  ATTENDANCE,
  LEAVE_REQUESTS,
  REVIEWS,
];

export const HR_SLUGS: HrSlug[] = HR_OBJECTS.map((o) => o.slug);

export function getHrObject(slug: string): HrObject | undefined {
  return HR_OBJECTS.find((o) => o.slug === slug);
}

/** True when a collection slug is one of the HR core objects. */
export function isHrSlug(slug: string): slug is HrSlug {
  return HR_SLUGS.includes(slug as HrSlug);
}
