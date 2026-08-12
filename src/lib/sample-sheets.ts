/**
 * 参考スプレッドシート — the sample-sheet library.
 *
 * Japanese SMBs already run on Excel: 売上日報, 見積書明細, 在庫管理, 勤怠管理…
 * This module is a catalogue of those spreadsheets, expressed in DashDrop's own
 * metadata (typed fields + realistic rows), so a workspace can add a fully
 * populated, immediately editable example with one click and see what the
 * product can hold.
 *
 * A sibling of `src/lib/crm-objects.ts`: definitions only, no DB access, so it
 * is safe to import from server components, route handlers and tests alike.
 * Installed into a workspace by `POST /api/sample-sheets`.
 */
import type { FieldType, SelectOption } from "./field-types";

export type SampleCategory = "sales" | "inventory" | "hr" | "operations";

export interface SampleField {
  key: string;
  name: string;
  type: FieldType;
  required?: boolean;
  options?: SelectOption[];
}

export interface SampleSheet {
  /** Stable id, also the basis of the installed collection slug. */
  key: string;
  /** 日本語名 — becomes the collection name. */
  name: string;
  category: SampleCategory;
  /** One line: what the sheet is for. */
  description: string;
  /** An icon name from components/app/icons.tsx. */
  icon: string;
  /** 1 sentence: 「こんな会社/場面で使う」 */
  useCase: string;
  fields: SampleField[];
  /** Field keys to show in the grid, in order. */
  listColumns: string[];
  /** Ready-to-import demo rows. */
  rows: Record<string, unknown>[];
}

export const SAMPLE_CATEGORIES: {
  id: SampleCategory;
  label: string;
  description: string;
}[] = [
  {
    id: "sales",
    label: "売上・請求",
    description: "日々の売上から見積・発注・入出金まで",
  },
  {
    id: "inventory",
    label: "在庫・仕入",
    description: "モノとお金の出入りを押さえる台帳",
  },
  {
    id: "hr",
    label: "人・労務",
    description: "勤怠・経費・名簿まわりの定番シート",
  },
  {
    id: "operations",
    label: "現場・運用",
    description: "案件、問い合わせ、備品などの現場管理",
  },
];

/* ------------------------------- option sets ------------------------------ */

const SALES_CHANNEL: SelectOption[] = [
  { label: "店頭", value: "store", color: "khaki" },
  { label: "EC", value: "ec", color: "info" },
  { label: "訪問営業", value: "field", color: "success" },
  { label: "電話・FAX", value: "phone", color: "khaki" },
];

const PAYMENT_METHOD: SelectOption[] = [
  { label: "現金", value: "cash", color: "khaki" },
  { label: "クレジット", value: "credit", color: "info" },
  { label: "掛売", value: "on_account", color: "warning" },
  { label: "電子マネー", value: "emoney", color: "info" },
];

const QUOTE_STATUS: SelectOption[] = [
  { label: "作成中", value: "draft", color: "khaki" },
  { label: "提出済", value: "sent", color: "info" },
  { label: "受注", value: "won", color: "success" },
  { label: "失注", value: "lost", color: "danger" },
];

const PO_STATUS: SelectOption[] = [
  { label: "未発注", value: "pending", color: "khaki" },
  { label: "発注済", value: "ordered", color: "info" },
  { label: "一部入荷", value: "partial", color: "warning" },
  { label: "入荷済", value: "received", color: "success" },
  { label: "キャンセル", value: "cancelled", color: "danger" },
];

const CASH_TYPE: SelectOption[] = [
  { label: "入金", value: "in", color: "success" },
  { label: "出金", value: "out", color: "danger" },
];

const CASH_ACCOUNT: SelectOption[] = [
  { label: "普通預金", value: "bank", color: "info" },
  { label: "現金", value: "cash", color: "khaki" },
  { label: "当座預金", value: "current", color: "info" },
];

const CASH_CATEGORY: SelectOption[] = [
  { label: "売上入金", value: "sales", color: "success" },
  { label: "仕入支払", value: "purchase", color: "warning" },
  { label: "経費", value: "expense", color: "khaki" },
  { label: "給与", value: "payroll", color: "khaki" },
  { label: "税金・社保", value: "tax", color: "danger" },
  { label: "その他", value: "other", color: "khaki" },
];

const ITEM_CATEGORY: SelectOption[] = [
  { label: "原材料", value: "material", color: "khaki" },
  { label: "部材", value: "parts", color: "info" },
  { label: "完成品", value: "finished", color: "success" },
  { label: "消耗品", value: "supplies", color: "khaki" },
  { label: "梱包資材", value: "packaging", color: "warning" },
];

const SUPPLIER_CATEGORY: SelectOption[] = [
  { label: "原材料", value: "material", color: "khaki" },
  { label: "部品", value: "parts", color: "info" },
  { label: "外注加工", value: "outsourcing", color: "warning" },
  { label: "消耗品", value: "supplies", color: "khaki" },
];

const PAYMENT_TERMS: SelectOption[] = [
  { label: "月末締 翌月末払", value: "eom_next", color: "khaki" },
  { label: "月末締 翌々月末払", value: "eom_2m", color: "warning" },
  { label: "20日締 翌月10日払", value: "d20_next10", color: "khaki" },
  { label: "都度払", value: "spot", color: "info" },
];

const GRADE: SelectOption[] = [
  { label: "A（主力）", value: "a", color: "success" },
  { label: "B", value: "b", color: "khaki" },
  { label: "C", value: "c", color: "info" },
];

const DEPARTMENT: SelectOption[] = [
  { label: "営業部", value: "sales", color: "success" },
  { label: "製造部", value: "production", color: "info" },
  { label: "総務・経理部", value: "admin", color: "khaki" },
  { label: "開発部", value: "dev", color: "warning" },
];

const ATTENDANCE_STATUS: SelectOption[] = [
  { label: "出勤", value: "present", color: "success" },
  { label: "在宅勤務", value: "remote", color: "info" },
  { label: "有給休暇", value: "paid_leave", color: "khaki" },
  { label: "半休", value: "half_day", color: "khaki" },
  { label: "欠勤", value: "absent", color: "danger" },
];

const EXPENSE_CATEGORY: SelectOption[] = [
  { label: "交通費", value: "transport", color: "khaki" },
  { label: "接待交際費", value: "entertainment", color: "warning" },
  { label: "消耗品費", value: "supplies", color: "khaki" },
  { label: "通信費", value: "communication", color: "info" },
  { label: "旅費・宿泊費", value: "travel", color: "info" },
  { label: "会議費", value: "meeting", color: "khaki" },
  { label: "その他", value: "other", color: "khaki" },
];

const APPROVAL_STATUS: SelectOption[] = [
  { label: "申請中", value: "submitted", color: "info" },
  { label: "承認済", value: "approved", color: "success" },
  { label: "差戻し", value: "returned", color: "danger" },
  { label: "精算済", value: "paid", color: "khaki" },
];

const JOB_TITLE: SelectOption[] = [
  { label: "部長", value: "manager", color: "success" },
  { label: "課長", value: "section_chief", color: "info" },
  { label: "主任", value: "chief", color: "khaki" },
  { label: "一般", value: "staff", color: "khaki" },
];

const EMPLOYMENT_TYPE: SelectOption[] = [
  { label: "正社員", value: "fulltime", color: "success" },
  { label: "契約社員", value: "contract", color: "info" },
  { label: "パート・アルバイト", value: "parttime", color: "khaki" },
  { label: "派遣", value: "dispatch", color: "warning" },
];

const PROJECT_PHASE: SelectOption[] = [
  { label: "見積", value: "estimate", color: "khaki" },
  { label: "設計", value: "design", color: "info" },
  { label: "製作", value: "build", color: "info" },
  { label: "現場施工", value: "install", color: "warning" },
  { label: "検収", value: "acceptance", color: "warning" },
  { label: "完了", value: "done", color: "success" },
];

const INQUIRY_CHANNEL: SelectOption[] = [
  { label: "電話", value: "phone", color: "khaki" },
  { label: "メール", value: "email", color: "info" },
  { label: "Webフォーム", value: "web", color: "info" },
  { label: "来店・来社", value: "walkin", color: "khaki" },
];

const INQUIRY_CATEGORY: SelectOption[] = [
  { label: "商品問い合わせ", value: "inquiry", color: "khaki" },
  { label: "見積依頼", value: "quote", color: "info" },
  { label: "クレーム", value: "complaint", color: "danger" },
  { label: "修理・保守", value: "repair", color: "warning" },
  { label: "採用・その他", value: "other", color: "khaki" },
];

const INQUIRY_STATUS: SelectOption[] = [
  { label: "未対応", value: "open", color: "danger" },
  { label: "対応中", value: "in_progress", color: "warning" },
  { label: "完了", value: "closed", color: "success" },
];

const ASSET_CATEGORY: SelectOption[] = [
  { label: "機械設備", value: "machine", color: "info" },
  { label: "PC・IT機器", value: "it", color: "khaki" },
  { label: "什器・備品", value: "furniture", color: "khaki" },
  { label: "車両", value: "vehicle", color: "warning" },
];

const ASSET_STATUS: SelectOption[] = [
  { label: "稼働中", value: "active", color: "success" },
  { label: "修理中", value: "repair", color: "warning" },
  { label: "遊休", value: "idle", color: "khaki" },
  { label: "廃棄予定", value: "disposal", color: "danger" },
];

const CUSTOMER_SEGMENT: SelectOption[] = [
  { label: "法人", value: "corporate", color: "info" },
  { label: "個人", value: "individual", color: "khaki" },
];

const SURVEY_GOOD_POINTS: SelectOption[] = [
  { label: "対応の速さ", value: "speed", color: "success" },
  { label: "価格", value: "price", color: "khaki" },
  { label: "品質", value: "quality", color: "info" },
  { label: "提案力", value: "proposal", color: "info" },
  { label: "アフターサポート", value: "support", color: "warning" },
];

/* --------------------------------- sheets --------------------------------- */

const DAILY_SALES: SampleSheet = {
  key: "daily-sales",
  name: "売上日報",
  category: "sales",
  description: "その日の売上を担当者・チャネル別に記録する日次シート",
  icon: "report",
  useCase: "店舗や営業所ごとに毎日の売上をExcelで集計している会社の、締め作業をそのまま置き換えます。",
  listColumns: ["date", "staff", "channel", "customer", "amount", "orders", "payment"],
  fields: [
    { key: "date", name: "日付", type: "date", required: true },
    { key: "staff", name: "担当者", type: "text", required: true },
    { key: "channel", name: "販売チャネル", type: "select", options: SALES_CHANNEL },
    { key: "customer", name: "得意先・顧客名", type: "text" },
    { key: "amount", name: "売上金額", type: "currency" },
    { key: "orders", name: "件数", type: "number" },
    { key: "payment", name: "支払方法", type: "select", options: PAYMENT_METHOD },
    { key: "note", name: "備考", type: "longtext" },
  ],
  rows: [
    { date: "2026-06-01", staff: "田中 誠", channel: "store", customer: "一般来店", amount: 184000, orders: 22, payment: "cash", note: "月初セール初日。午前の客足が良い。" },
    { date: "2026-06-01", staff: "佐藤 由美", channel: "ec", customer: "オンライン", amount: 96500, orders: 14, payment: "credit" },
    { date: "2026-06-02", staff: "鈴木 健一", channel: "field", customer: "株式会社アオイ製作所", amount: 420000, orders: 1, payment: "on_account", note: "定期発注分。請求書は月末締め。" },
    { date: "2026-06-02", staff: "田中 誠", channel: "store", customer: "一般来店", amount: 132000, orders: 18, payment: "cash" },
    { date: "2026-06-03", staff: "高橋 直子", channel: "phone", customer: "ミドリ商事株式会社", amount: 78000, orders: 3, payment: "on_account" },
    { date: "2026-06-03", staff: "佐藤 由美", channel: "ec", customer: "オンライン", amount: 112400, orders: 17, payment: "emoney", note: "キャッシュレス決済の比率が上昇。" },
    { date: "2026-06-04", staff: "鈴木 健一", channel: "field", customer: "キイロ物産", amount: 268000, orders: 2, payment: "on_account" },
    { date: "2026-06-04", staff: "田中 誠", channel: "store", customer: "一般来店", amount: 97000, orders: 11, payment: "credit" },
    { date: "2026-06-05", staff: "高橋 直子", channel: "phone", customer: "ソラ建設株式会社", amount: 340000, orders: 1, payment: "on_account", note: "新規。初回は前金でご入金いただいた。" },
    { date: "2026-06-05", staff: "佐藤 由美", channel: "ec", customer: "オンライン", amount: 88900, orders: 12, payment: "credit" },
    { date: "2026-06-06", staff: "田中 誠", channel: "store", customer: "一般来店", amount: 205000, orders: 26, payment: "cash", note: "土曜。夕方に団体客あり。" },
    { date: "2026-06-06", staff: "鈴木 健一", channel: "field", customer: "ハナミズキ工業", amount: 154000, orders: 1, payment: "on_account" },
  ],
};

const QUOTE_LINES: SampleSheet = {
  key: "quote-lines",
  name: "見積書明細",
  category: "sales",
  description: "見積書1行ごとの品名・数量・単価と、提出後のステータス",
  icon: "table",
  useCase: "見積書をExcelで作り、控えを別ファイルに転記している会社が、明細を一箇所にためられます。",
  listColumns: ["quoteNo", "issueDate", "customer", "item", "qty", "unitPrice", "amount", "status"],
  fields: [
    { key: "quoteNo", name: "見積番号", type: "text", required: true },
    { key: "issueDate", name: "発行日", type: "date" },
    { key: "customer", name: "顧客名", type: "text", required: true },
    { key: "item", name: "品名・仕様", type: "text", required: true },
    { key: "qty", name: "数量", type: "number" },
    { key: "unitPrice", name: "単価", type: "currency" },
    { key: "amount", name: "金額", type: "currency" },
    { key: "status", name: "ステータス", type: "select", options: QUOTE_STATUS },
    { key: "validUntil", name: "有効期限", type: "date" },
  ],
  rows: [
    { quoteNo: "Q-2026-0041", issueDate: "2026-04-06", customer: "株式会社アオイ製作所", item: "精密シャフト SUS304 φ12", qty: 400, unitPrice: 1850, amount: 740000, status: "won", validUntil: "2026-05-06" },
    { quoteNo: "Q-2026-0041", issueDate: "2026-04-06", customer: "株式会社アオイ製作所", item: "熱処理加工費", qty: 400, unitPrice: 320, amount: 128000, status: "won", validUntil: "2026-05-06" },
    { quoteNo: "Q-2026-0042", issueDate: "2026-04-10", customer: "ミドリ商事株式会社", item: "業務用収納ラック 1800mm", qty: 12, unitPrice: 24800, amount: 297600, status: "sent", validUntil: "2026-05-10" },
    { quoteNo: "Q-2026-0042", issueDate: "2026-04-10", customer: "ミドリ商事株式会社", item: "組立・設置費", qty: 1, unitPrice: 48000, amount: 48000, status: "sent", validUntil: "2026-05-10" },
    { quoteNo: "Q-2026-0043", issueDate: "2026-04-17", customer: "キイロ物産", item: "店舗用什器 一式", qty: 1, unitPrice: 386000, amount: 386000, status: "lost", validUntil: "2026-05-17" },
    { quoteNo: "Q-2026-0044", issueDate: "2026-05-08", customer: "ソラ建設株式会社", item: "現場事務所 仮設パネル", qty: 24, unitPrice: 12500, amount: 300000, status: "won", validUntil: "2026-06-08" },
    { quoteNo: "Q-2026-0044", issueDate: "2026-05-08", customer: "ソラ建設株式会社", item: "運搬費（都内近郊）", qty: 2, unitPrice: 35000, amount: 70000, status: "won", validUntil: "2026-06-08" },
    { quoteNo: "Q-2026-0045", issueDate: "2026-05-21", customer: "アカネシステムズ", item: "サーバーラック 42U", qty: 3, unitPrice: 168000, amount: 504000, status: "sent", validUntil: "2026-06-21" },
    { quoteNo: "Q-2026-0046", issueDate: "2026-06-02", customer: "ハナミズキ工業", item: "アルミフレーム 6m", qty: 60, unitPrice: 4300, amount: 258000, status: "draft", validUntil: "2026-07-02" },
    { quoteNo: "Q-2026-0046", issueDate: "2026-06-02", customer: "ハナミズキ工業", item: "切断加工費", qty: 60, unitPrice: 450, amount: 27000, status: "draft", validUntil: "2026-07-02" },
    { quoteNo: "Q-2026-0047", issueDate: "2026-06-15", customer: "株式会社アオイ製作所", item: "検査治具 特注", qty: 2, unitPrice: 240000, amount: 480000, status: "sent", validUntil: "2026-07-15" },
    { quoteNo: "Q-2026-0048", issueDate: "2026-07-01", customer: "キイロ物産", item: "消耗品セット（年間）", qty: 1, unitPrice: 840000, amount: 840000, status: "draft", validUntil: "2026-08-01" },
  ],
};

const PURCHASE_ORDERS: SampleSheet = {
  key: "purchase-orders",
  name: "発注管理",
  category: "sales",
  description: "仕入先への発注内容と納期・入荷状況の追跡",
  icon: "check-square",
  useCase: "発注書をメールで送りっぱなしにして、納期の抜けを電話で確認している会社向けです。",
  listColumns: ["poNo", "orderDate", "supplier", "item", "qty", "amount", "dueDate", "status"],
  fields: [
    { key: "poNo", name: "発注番号", type: "text", required: true },
    { key: "orderDate", name: "発注日", type: "date" },
    { key: "supplier", name: "仕入先", type: "text", required: true },
    { key: "item", name: "品名", type: "text" },
    { key: "qty", name: "数量", type: "number" },
    { key: "amount", name: "発注金額", type: "currency" },
    { key: "dueDate", name: "納期", type: "date" },
    { key: "status", name: "進捗", type: "select", options: PO_STATUS },
    { key: "inspected", name: "検収済", type: "checkbox" },
  ],
  rows: [
    { poNo: "PO-2026-0112", orderDate: "2026-04-02", supplier: "山陽金属工業株式会社", item: "SUS304 丸棒 φ12", qty: 500, amount: 640000, dueDate: "2026-04-20", status: "received", inspected: true },
    { poNo: "PO-2026-0113", orderDate: "2026-04-09", supplier: "東海樹脂工業", item: "ABS樹脂ペレット", qty: 800, amount: 296000, dueDate: "2026-04-28", status: "received", inspected: true },
    { poNo: "PO-2026-0114", orderDate: "2026-04-24", supplier: "阪和梱包資材", item: "段ボール 3号", qty: 2000, amount: 138000, dueDate: "2026-05-12", status: "received", inspected: true },
    { poNo: "PO-2026-0115", orderDate: "2026-05-07", supplier: "北関東精機", item: "ベアリング 6203ZZ", qty: 300, amount: 174000, dueDate: "2026-05-26", status: "partial", inspected: false },
    { poNo: "PO-2026-0116", orderDate: "2026-05-15", supplier: "山陽金属工業株式会社", item: "アルミフレーム 6m", qty: 120, amount: 468000, dueDate: "2026-06-05", status: "received", inspected: true },
    { poNo: "PO-2026-0117", orderDate: "2026-05-28", supplier: "みやこ工業塗装", item: "焼付塗装 外注加工", qty: 400, amount: 208000, dueDate: "2026-06-18", status: "ordered", inspected: false },
    { poNo: "PO-2026-0118", orderDate: "2026-06-03", supplier: "東海樹脂工業", item: "樹脂カバー 成形品", qty: 600, amount: 312000, dueDate: "2026-06-30", status: "ordered", inspected: false },
    { poNo: "PO-2026-0119", orderDate: "2026-06-11", supplier: "阪和梱包資材", item: "緩衝材ロール", qty: 150, amount: 67500, dueDate: "2026-06-25", status: "received", inspected: true },
    { poNo: "PO-2026-0120", orderDate: "2026-06-19", supplier: "北関東精機", item: "リニアガイド 400mm", qty: 40, amount: 384000, dueDate: "2026-07-15", status: "ordered", inspected: false },
    { poNo: "PO-2026-0121", orderDate: "2026-06-26", supplier: "みやこ工業塗装", item: "メッキ処理 外注加工", qty: 250, amount: 137500, dueDate: "2026-07-21", status: "pending", inspected: false },
    { poNo: "PO-2026-0122", orderDate: "2026-07-02", supplier: "山陽金属工業株式会社", item: "鋼板 SPCC t1.6", qty: 90, amount: 279000, dueDate: "2026-07-24", status: "ordered", inspected: false },
    { poNo: "PO-2026-0123", orderDate: "2026-07-08", supplier: "オフィスサプライ中央", item: "作業用手袋 他消耗品", qty: 1, amount: 48200, dueDate: "2026-07-14", status: "cancelled", inspected: false },
  ],
};

const CASH_LEDGER: SampleSheet = {
  key: "cash-ledger",
  name: "入出金管理",
  category: "sales",
  description: "口座・現金の入出金と残高を科目別に記録",
  icon: "report",
  useCase: "通帳と現金出納帳をExcelで突き合わせている経理担当の日次入力に使えます。",
  listColumns: ["date", "type", "account", "counterparty", "category", "amount", "balance"],
  fields: [
    { key: "date", name: "日付", type: "date", required: true },
    { key: "type", name: "区分", type: "select", options: CASH_TYPE },
    { key: "account", name: "口座", type: "select", options: CASH_ACCOUNT },
    { key: "counterparty", name: "相手先", type: "text", required: true },
    { key: "category", name: "科目", type: "select", options: CASH_CATEGORY },
    { key: "amount", name: "金額", type: "currency" },
    { key: "balance", name: "残高", type: "currency" },
    { key: "note", name: "摘要", type: "text" },
  ],
  rows: [
    { date: "2026-06-01", type: "in", account: "bank", counterparty: "株式会社アオイ製作所", category: "sales", amount: 3520000, balance: 8460000, note: "5月分請求 入金" },
    { date: "2026-06-02", type: "out", account: "bank", counterparty: "山陽金属工業株式会社", category: "purchase", amount: 704000, balance: 7756000, note: "4月仕入分 支払" },
    { date: "2026-06-05", type: "in", account: "bank", counterparty: "ミドリ商事株式会社", category: "sales", amount: 990000, balance: 8746000, note: "着手金" },
    { date: "2026-06-08", type: "out", account: "cash", counterparty: "オフィスサプライ中央", category: "expense", amount: 48200, balance: 121800, note: "事務用品 現金購入" },
    { date: "2026-06-10", type: "out", account: "bank", counterparty: "東海樹脂工業", category: "purchase", amount: 325600, balance: 8420400, note: "4月仕入分 支払" },
    { date: "2026-06-15", type: "out", account: "bank", counterparty: "従業員一同", category: "payroll", amount: 4180000, balance: 4240400, note: "6月度給与" },
    { date: "2026-06-20", type: "in", account: "bank", counterparty: "キイロ物産", category: "sales", amount: 231000, balance: 4471400, note: "スポット納品分" },
    { date: "2026-06-25", type: "out", account: "bank", counterparty: "港都税務署", category: "tax", amount: 386000, balance: 4085400, note: "源泉所得税 納付" },
    { date: "2026-06-28", type: "out", account: "bank", counterparty: "みなと不動産", category: "expense", amount: 280000, balance: 3805400, note: "7月分 事務所家賃" },
    { date: "2026-06-30", type: "in", account: "bank", counterparty: "ソラ建設株式会社", category: "sales", amount: 407000, balance: 4212400, note: "仮設パネル 納品分" },
    { date: "2026-07-01", type: "out", account: "cash", counterparty: "三ツ星商店", category: "other", amount: 12600, balance: 109200, note: "来客用備品" },
    { date: "2026-07-03", type: "in", account: "bank", counterparty: "アカネシステムズ", category: "sales", amount: 554400, balance: 4766800, note: "ラック納品分" },
  ],
};

const INVENTORY: SampleSheet = {
  key: "inventory",
  name: "在庫管理",
  category: "inventory",
  description: "品番ごとの在庫数・安全在庫・保管場所と発注要否",
  icon: "table",
  useCase: "棚卸のたびにExcelを作り直している倉庫・工場で、在庫表を常設の台帳にできます。",
  listColumns: ["code", "name", "category", "stock", "safetyStock", "unitCost", "location", "reorder"],
  fields: [
    { key: "code", name: "品番", type: "text", required: true },
    { key: "name", name: "品名", type: "text", required: true },
    { key: "category", name: "分類", type: "select", options: ITEM_CATEGORY },
    { key: "stock", name: "在庫数", type: "number" },
    { key: "safetyStock", name: "安全在庫", type: "number" },
    { key: "unitCost", name: "仕入単価", type: "currency" },
    { key: "location", name: "保管場所", type: "text" },
    { key: "lastCounted", name: "最終棚卸日", type: "date" },
    { key: "reorder", name: "要発注", type: "checkbox" },
  ],
  rows: [
    { code: "MT-1001", name: "SUS304 丸棒 φ12", category: "material", stock: 320, safetyStock: 200, unitCost: 1280, location: "A-1棚", lastCounted: "2026-06-30", reorder: false },
    { code: "MT-1002", name: "鋼板 SPCC t1.6", category: "material", stock: 42, safetyStock: 60, unitCost: 3100, location: "A-2棚", lastCounted: "2026-06-30", reorder: true },
    { code: "PT-2010", name: "ベアリング 6203ZZ", category: "parts", stock: 180, safetyStock: 150, unitCost: 580, location: "B-1棚", lastCounted: "2026-06-30", reorder: false },
    { code: "PT-2011", name: "リニアガイド 400mm", category: "parts", stock: 12, safetyStock: 30, unitCost: 9600, location: "B-2棚", lastCounted: "2026-06-30", reorder: true },
    { code: "PT-2012", name: "樹脂カバー 成形品", category: "parts", stock: 460, safetyStock: 200, unitCost: 520, location: "B-3棚", lastCounted: "2026-06-30", reorder: false },
    { code: "FG-3001", name: "搬送ユニット 標準型", category: "finished", stock: 8, safetyStock: 5, unitCost: 128000, location: "出荷ヤード", lastCounted: "2026-06-30", reorder: false },
    { code: "FG-3002", name: "搬送ユニット 小型", category: "finished", stock: 3, safetyStock: 5, unitCost: 96000, location: "出荷ヤード", lastCounted: "2026-06-30", reorder: true },
    { code: "SP-4001", name: "作業用手袋 Mサイズ", category: "supplies", stock: 240, safetyStock: 100, unitCost: 180, location: "資材庫", lastCounted: "2026-06-15", reorder: false },
    { code: "SP-4002", name: "切削油 20L缶", category: "supplies", stock: 6, safetyStock: 10, unitCost: 12800, location: "資材庫", lastCounted: "2026-06-15", reorder: true },
    { code: "PK-5001", name: "段ボール 3号", category: "packaging", stock: 1400, safetyStock: 800, unitCost: 69, location: "C-1棚", lastCounted: "2026-06-15", reorder: false },
    { code: "PK-5002", name: "緩衝材ロール", category: "packaging", stock: 96, safetyStock: 60, unitCost: 450, location: "C-2棚", lastCounted: "2026-06-15", reorder: false },
    { code: "PK-5003", name: "PPバンド 15mm", category: "packaging", stock: 18, safetyStock: 40, unitCost: 2200, location: "C-2棚", lastCounted: "2026-06-15", reorder: true },
  ],
};

const SUPPLIERS: SampleSheet = {
  key: "suppliers",
  name: "仕入先マスター",
  category: "inventory",
  description: "仕入先の連絡先・支払条件・取引評価をまとめた基本台帳",
  icon: "users",
  useCase: "仕入先の支払条件が担当者の頭の中にしかない会社の、引き継ぎ用マスターになります。",
  listColumns: ["name", "contact", "phone", "category", "terms", "grade", "active"],
  fields: [
    { key: "name", name: "仕入先名", type: "text", required: true },
    { key: "contact", name: "先方担当者", type: "text" },
    { key: "phone", name: "電話", type: "phone" },
    { key: "email", name: "メール", type: "email" },
    { key: "category", name: "取扱区分", type: "select", options: SUPPLIER_CATEGORY },
    { key: "terms", name: "支払条件", type: "select", options: PAYMENT_TERMS },
    { key: "grade", name: "取引ランク", type: "select", options: GRADE },
    { key: "since", name: "取引開始日", type: "date" },
    { key: "active", name: "取引中", type: "checkbox" },
  ],
  rows: [
    { name: "山陽金属工業株式会社", contact: "村上 隆", phone: "084-921-3300", email: "murakami@sanyo-metal.co.jp", category: "material", terms: "eom_next", grade: "a", since: "2018-04-01", active: true },
    { name: "東海樹脂工業", contact: "岡田 里美", phone: "052-771-4820", email: "okada@tokai-jushi.co.jp", category: "material", terms: "eom_next", grade: "a", since: "2019-09-02", active: true },
    { name: "北関東精機", contact: "石井 満", phone: "027-345-1188", email: "ishii@kk-seiki.jp", category: "parts", terms: "eom_2m", grade: "b", since: "2020-06-15", active: true },
    { name: "みやこ工業塗装", contact: "藤本 亮", phone: "075-611-2244", email: "fujimoto@miyako-tosou.jp", category: "outsourcing", terms: "d20_next10", grade: "b", since: "2021-02-08", active: true },
    { name: "阪和梱包資材", contact: "西村 陽子", phone: "072-233-9010", email: "nishimura@hanwa-pack.co.jp", category: "supplies", terms: "eom_next", grade: "b", since: "2017-11-20", active: true },
    { name: "オフィスサプライ中央", contact: "遠藤 拓也", phone: "03-5432-7788", email: "endo@os-chuo.co.jp", category: "supplies", terms: "spot", grade: "c", since: "2022-05-10", active: true },
    { name: "九州鋳造センター", contact: "松尾 直人", phone: "092-451-6677", email: "matsuo@kyushu-chuzo.jp", category: "outsourcing", terms: "eom_2m", grade: "c", since: "2019-03-25", active: false },
    { name: "信州電子部品", contact: "小池 恵", phone: "026-224-5511", email: "koike@shinshu-denshi.co.jp", category: "parts", terms: "eom_next", grade: "b", since: "2021-08-30", active: true },
    { name: "北陸ゴム工業所", contact: "谷口 章", phone: "076-263-4400", email: "taniguchi@hokuriku-gomu.jp", category: "material", terms: "d20_next10", grade: "c", since: "2023-01-16", active: true },
    { name: "浪速プレス工業", contact: "森本 大輔", phone: "06-6392-8811", email: "morimoto@naniwa-press.co.jp", category: "outsourcing", terms: "eom_next", grade: "a", since: "2016-07-04", active: true },
  ],
};

const ATTENDANCE: SampleSheet = {
  key: "attendance",
  name: "勤怠管理",
  category: "hr",
  description: "日別の出退勤・実働・残業時間と承認状況",
  icon: "check-square",
  useCase: "タイムカードを月末にExcelへ手入力している総務担当の、集計作業を軽くします。",
  listColumns: ["date", "employee", "dept", "clockIn", "clockOut", "workHours", "overtime", "status", "approved"],
  fields: [
    { key: "date", name: "日付", type: "date", required: true },
    { key: "employee", name: "氏名", type: "text", required: true },
    { key: "dept", name: "部署", type: "select", options: DEPARTMENT },
    { key: "clockIn", name: "出勤時刻", type: "text" },
    { key: "clockOut", name: "退勤時刻", type: "text" },
    { key: "workHours", name: "実働時間", type: "number" },
    { key: "overtime", name: "残業時間", type: "number" },
    { key: "status", name: "勤務区分", type: "select", options: ATTENDANCE_STATUS },
    { key: "approved", name: "承認済", type: "checkbox" },
  ],
  rows: [
    { date: "2026-06-01", employee: "田中 誠", dept: "sales", clockIn: "08:52", clockOut: "18:10", workHours: 8, overtime: 0.5, status: "present", approved: true },
    { date: "2026-06-01", employee: "佐藤 由美", dept: "sales", clockIn: "09:00", clockOut: "17:45", workHours: 7.75, overtime: 0, status: "present", approved: true },
    { date: "2026-06-01", employee: "山口 剛", dept: "production", clockIn: "07:58", clockOut: "19:35", workHours: 8, overtime: 2.5, status: "present", approved: true },
    { date: "2026-06-02", employee: "田中 誠", dept: "sales", clockIn: "08:55", clockOut: "17:50", workHours: 8, overtime: 0, status: "present", approved: true },
    { date: "2026-06-02", employee: "佐藤 由美", dept: "sales", workHours: 0, overtime: 0, status: "paid_leave", approved: true },
    { date: "2026-06-02", employee: "中村 亜衣", dept: "admin", clockIn: "09:02", clockOut: "18:05", workHours: 8, overtime: 0, status: "present", approved: true },
    { date: "2026-06-03", employee: "山口 剛", dept: "production", clockIn: "07:55", clockOut: "20:10", workHours: 8, overtime: 3, status: "present", approved: false },
    { date: "2026-06-03", employee: "渡辺 拓", dept: "dev", clockIn: "10:00", clockOut: "19:00", workHours: 8, overtime: 0, status: "remote", approved: true },
    { date: "2026-06-04", employee: "中村 亜衣", dept: "admin", clockIn: "09:00", clockOut: "13:00", workHours: 4, overtime: 0, status: "half_day", approved: true },
    { date: "2026-06-04", employee: "田中 誠", dept: "sales", clockIn: "08:50", clockOut: "18:40", workHours: 8, overtime: 1, status: "present", approved: false },
    { date: "2026-06-05", employee: "渡辺 拓", dept: "dev", clockIn: "09:45", clockOut: "18:50", workHours: 8, overtime: 0.5, status: "remote", approved: false },
    { date: "2026-06-05", employee: "山口 剛", dept: "production", workHours: 0, overtime: 0, status: "absent", approved: true },
    { date: "2026-06-08", employee: "佐藤 由美", dept: "sales", clockIn: "08:58", clockOut: "18:20", workHours: 8, overtime: 0.5, status: "present", approved: false },
    { date: "2026-06-08", employee: "中村 亜衣", dept: "admin", clockIn: "08:57", clockOut: "18:00", workHours: 8, overtime: 0, status: "present", approved: false },
  ],
};

const EXPENSES: SampleSheet = {
  key: "expenses",
  name: "経費精算",
  category: "hr",
  description: "立替経費の申請内容・費目・承認状況の一覧",
  icon: "inbox",
  useCase: "紙の精算書と社内メールで回している経費申請を、そのまま一覧で追えるようにします。",
  listColumns: ["date", "applicant", "category", "detail", "amount", "payee", "status", "receipt"],
  fields: [
    { key: "date", name: "使用日", type: "date", required: true },
    { key: "applicant", name: "申請者", type: "text", required: true },
    { key: "category", name: "費目", type: "select", options: EXPENSE_CATEGORY },
    { key: "detail", name: "内容", type: "text" },
    { key: "amount", name: "金額", type: "currency" },
    { key: "payee", name: "支払先", type: "text" },
    { key: "status", name: "承認状況", type: "select", options: APPROVAL_STATUS },
    { key: "receipt", name: "領収書あり", type: "checkbox" },
  ],
  rows: [
    { date: "2026-06-02", applicant: "田中 誠", category: "transport", detail: "アオイ製作所 訪問（往復）", amount: 1840, payee: "東日本旅客鉄道", status: "paid", receipt: true },
    { date: "2026-06-03", applicant: "佐藤 由美", category: "supplies", detail: "梱包用テープ 追加購入", amount: 3480, payee: "オフィスサプライ中央", status: "approved", receipt: true },
    { date: "2026-06-05", applicant: "鈴木 健一", category: "entertainment", detail: "ソラ建設 打合せ後 会食（3名）", amount: 24600, payee: "居酒屋 まる玄", status: "submitted", receipt: true },
    { date: "2026-06-08", applicant: "中村 亜衣", category: "communication", detail: "郵送料（請求書一括発送）", amount: 6720, payee: "日本郵便", status: "paid", receipt: true },
    { date: "2026-06-10", applicant: "山口 剛", category: "travel", detail: "名古屋工場 立会い 宿泊費", amount: 12800, payee: "ホテルさくら名古屋", status: "approved", receipt: true },
    { date: "2026-06-10", applicant: "山口 剛", category: "transport", detail: "名古屋工場 立会い 新幹線", amount: 22360, payee: "東海旅客鉄道", status: "approved", receipt: true },
    { date: "2026-06-12", applicant: "渡辺 拓", category: "meeting", detail: "社内定例 飲料・軽食", amount: 4200, payee: "三ツ星商店", status: "returned", receipt: false },
    { date: "2026-06-15", applicant: "田中 誠", category: "transport", detail: "キイロ物産 訪問 タクシー", amount: 3260, payee: "みなと交通", status: "submitted", receipt: true },
    { date: "2026-06-18", applicant: "佐藤 由美", category: "communication", detail: "業務用スマートフォン 通信料", amount: 8580, payee: "通信キャリア", status: "approved", receipt: true },
    { date: "2026-06-22", applicant: "鈴木 健一", category: "entertainment", detail: "取引先 中元手配", amount: 32400, payee: "百貨店 大宮堂", status: "submitted", receipt: true },
    { date: "2026-06-25", applicant: "中村 亜衣", category: "supplies", detail: "プリンタトナー 2本", amount: 18700, payee: "オフィスサプライ中央", status: "approved", receipt: true },
    { date: "2026-06-29", applicant: "渡辺 拓", category: "other", detail: "技術書籍 3冊", amount: 9460, payee: "みどり書店", status: "submitted", receipt: false },
  ],
};

const EMPLOYEES: SampleSheet = {
  key: "employees",
  name: "社員名簿",
  category: "hr",
  description: "社員番号・所属・雇用区分・連絡先の基本情報",
  icon: "users",
  useCase: "年末調整や緊急連絡のたびに古い名簿ファイルを探している総務の、常設マスターです。",
  listColumns: ["empNo", "name", "dept", "title", "employment", "joinedAt", "email"],
  fields: [
    { key: "empNo", name: "社員番号", type: "text", required: true },
    { key: "name", name: "氏名", type: "text", required: true },
    { key: "kana", name: "フリガナ", type: "text" },
    { key: "dept", name: "部署", type: "select", options: DEPARTMENT },
    { key: "title", name: "役職", type: "select", options: JOB_TITLE },
    { key: "employment", name: "雇用区分", type: "select", options: EMPLOYMENT_TYPE },
    { key: "joinedAt", name: "入社日", type: "date" },
    { key: "email", name: "社用メール", type: "email" },
    { key: "phone", name: "連絡先", type: "phone" },
    { key: "active", name: "在籍中", type: "checkbox" },
  ],
  rows: [
    { empNo: "E-0001", name: "大西 康彦", kana: "オオニシ ヤスヒコ", dept: "admin", title: "manager", employment: "fulltime", joinedAt: "2009-04-01", email: "onishi@example.co.jp", phone: "090-1234-0001", active: true },
    { empNo: "E-0007", name: "田中 誠", kana: "タナカ マコト", dept: "sales", title: "section_chief", employment: "fulltime", joinedAt: "2013-04-01", email: "tanaka@example.co.jp", phone: "090-1234-0007", active: true },
    { empNo: "E-0012", name: "佐藤 由美", kana: "サトウ ユミ", dept: "sales", title: "chief", employment: "fulltime", joinedAt: "2016-10-01", email: "sato@example.co.jp", phone: "090-1234-0012", active: true },
    { empNo: "E-0015", name: "鈴木 健一", kana: "スズキ ケンイチ", dept: "sales", title: "staff", employment: "fulltime", joinedAt: "2018-04-02", email: "suzuki@example.co.jp", phone: "090-1234-0015", active: true },
    { empNo: "E-0019", name: "山口 剛", kana: "ヤマグチ ツヨシ", dept: "production", title: "section_chief", employment: "fulltime", joinedAt: "2011-09-01", email: "yamaguchi@example.co.jp", phone: "090-1234-0019", active: true },
    { empNo: "E-0023", name: "中村 亜衣", kana: "ナカムラ アイ", dept: "admin", title: "chief", employment: "fulltime", joinedAt: "2019-04-01", email: "nakamura@example.co.jp", phone: "090-1234-0023", active: true },
    { empNo: "E-0028", name: "渡辺 拓", kana: "ワタナベ タク", dept: "dev", title: "staff", employment: "contract", joinedAt: "2022-07-01", email: "watanabe@example.co.jp", phone: "090-1234-0028", active: true },
    { empNo: "E-0031", name: "高橋 直子", kana: "タカハシ ナオコ", dept: "sales", title: "staff", employment: "parttime", joinedAt: "2023-03-06", email: "takahashi@example.co.jp", phone: "090-1234-0031", active: true },
    { empNo: "E-0034", name: "林 悟", kana: "ハヤシ サトル", dept: "production", title: "staff", employment: "fulltime", joinedAt: "2021-04-01", email: "hayashi@example.co.jp", phone: "090-1234-0034", active: true },
    { empNo: "E-0036", name: "小野 千夏", kana: "オノ チナツ", dept: "production", title: "staff", employment: "parttime", joinedAt: "2024-05-13", email: "ono@example.co.jp", phone: "090-1234-0036", active: true },
    { empNo: "E-0038", name: "藤井 亮太", kana: "フジイ リョウタ", dept: "dev", title: "staff", employment: "dispatch", joinedAt: "2025-10-01", email: "fujii@example.co.jp", phone: "090-1234-0038", active: true },
    { empNo: "E-0021", name: "村上 沙織", kana: "ムラカミ サオリ", dept: "admin", title: "staff", employment: "fulltime", joinedAt: "2017-04-03", email: "murakami@example.co.jp", phone: "090-1234-0021", active: false },
  ],
};

const PROJECT_PROGRESS: SampleSheet = {
  key: "project-progress",
  name: "案件進捗管理",
  category: "operations",
  description: "案件ごとのフェーズ・進捗率・納期・受注金額を横断で把握",
  icon: "dashboard",
  useCase: "案件ごとにExcelがバラバラで、全体の遅れが週次会議まで見えない現場に向いています。",
  listColumns: ["code", "name", "client", "owner", "phase", "progress", "due", "amount", "delayed"],
  fields: [
    { key: "code", name: "案件番号", type: "text", required: true },
    { key: "name", name: "案件名", type: "text", required: true },
    { key: "client", name: "顧客", type: "text" },
    { key: "owner", name: "担当", type: "text" },
    { key: "phase", name: "フェーズ", type: "select", options: PROJECT_PHASE },
    { key: "progress", name: "進捗率（%）", type: "number" },
    { key: "start", name: "着手日", type: "date" },
    { key: "due", name: "納期", type: "date" },
    { key: "amount", name: "受注金額", type: "currency" },
    { key: "delayed", name: "遅延あり", type: "checkbox" },
  ],
  rows: [
    { code: "PJ-2026-01", name: "アオイ製作所 検査治具 製作", client: "株式会社アオイ製作所", owner: "山口 剛", phase: "build", progress: 65, start: "2026-05-11", due: "2026-08-21", amount: 480000, delayed: false },
    { code: "PJ-2026-02", name: "ミドリ商事 倉庫ラック 導入", client: "ミドリ商事株式会社", owner: "田中 誠", phase: "install", progress: 80, start: "2026-04-20", due: "2026-07-31", amount: 345600, delayed: false },
    { code: "PJ-2026-03", name: "ソラ建設 現場事務所 仮設一式", client: "ソラ建設株式会社", owner: "鈴木 健一", phase: "done", progress: 100, start: "2026-05-18", due: "2026-06-30", amount: 370000, delayed: false },
    { code: "PJ-2026-04", name: "アカネシステムズ サーバー室 整備", client: "アカネシステムズ", owner: "渡辺 拓", phase: "design", progress: 35, start: "2026-06-01", due: "2026-09-18", amount: 554400, delayed: true },
    { code: "PJ-2026-05", name: "キイロ物産 店舗什器 更新", client: "キイロ物産", owner: "佐藤 由美", phase: "estimate", progress: 10, start: "2026-06-22", due: "2026-10-30", amount: 386000, delayed: false },
    { code: "PJ-2026-06", name: "ハナミズキ工業 フレーム加工", client: "ハナミズキ工業", owner: "林 悟", phase: "build", progress: 55, start: "2026-06-08", due: "2026-08-07", amount: 285000, delayed: true },
    { code: "PJ-2026-07", name: "アオイ製作所 追加ライン 立ち上げ", client: "株式会社アオイ製作所", owner: "山口 剛", phase: "design", progress: 25, start: "2026-07-01", due: "2026-11-27", amount: 5600000, delayed: false },
    { code: "PJ-2026-08", name: "自社工場 レイアウト変更", client: "自社", owner: "大西 康彦", phase: "acceptance", progress: 92, start: "2026-03-02", due: "2026-07-24", amount: 1240000, delayed: false },
    { code: "PJ-2026-09", name: "ミドリ商事 第2拠点 什器搬入", client: "ミドリ商事株式会社", owner: "田中 誠", phase: "estimate", progress: 5, start: "2026-07-06", due: "2026-12-11", amount: 620000, delayed: false },
    { code: "PJ-2026-10", name: "ソラ建設 現場詰所 増設", client: "ソラ建設株式会社", owner: "鈴木 健一", phase: "install", progress: 70, start: "2026-06-15", due: "2026-08-14", amount: 448000, delayed: false },
  ],
};

const INQUIRY_LOG: SampleSheet = {
  key: "inquiry-log",
  name: "問い合わせ受付簿",
  category: "operations",
  description: "電話・メール・Webからの問い合わせと対応状況の記録",
  icon: "inbox",
  useCase: "電話メモが個人のノートに散っていて、対応漏れが後から発覚する会社に向いています。",
  listColumns: ["receivedAt", "channel", "customer", "category", "content", "assignee", "status"],
  fields: [
    { key: "receivedAt", name: "受付日", type: "date", required: true },
    { key: "channel", name: "受付経路", type: "select", options: INQUIRY_CHANNEL },
    { key: "customer", name: "お客様名", type: "text", required: true },
    { key: "phone", name: "連絡先", type: "phone" },
    { key: "category", name: "種別", type: "select", options: INQUIRY_CATEGORY },
    { key: "content", name: "内容", type: "longtext" },
    { key: "assignee", name: "担当", type: "text" },
    { key: "status", name: "対応状況", type: "select", options: INQUIRY_STATUS },
    { key: "closedAt", name: "完了日", type: "date" },
  ],
  rows: [
    { receivedAt: "2026-06-01", channel: "phone", customer: "株式会社アオイ製作所", phone: "03-1234-5678", category: "quote", content: "追加ライン向けの治具について概算見積が欲しいとのこと。", assignee: "田中 誠", status: "closed", closedAt: "2026-06-04" },
    { receivedAt: "2026-06-02", channel: "web", customer: "小島 直樹", phone: "090-2233-4455", category: "inquiry", content: "カタログ掲載のラックの寸法違いがあるか知りたい。", assignee: "佐藤 由美", status: "closed", closedAt: "2026-06-03" },
    { receivedAt: "2026-06-04", channel: "email", customer: "キイロ物産", phone: "052-345-6789", category: "complaint", content: "納品された什器に擦り傷。写真添付あり。交換を希望。", assignee: "鈴木 健一", status: "closed", closedAt: "2026-06-11" },
    { receivedAt: "2026-06-08", channel: "phone", customer: "ハナミズキ工業", phone: "092-567-8901", category: "repair", content: "5年前納入の搬送ユニットが異音。部品在庫の確認依頼。", assignee: "山口 剛", status: "in_progress" },
    { receivedAt: "2026-06-10", channel: "web", customer: "ソラ建設株式会社", phone: "011-456-7890", category: "quote", content: "現場詰所の増設分について追加見積の依頼。", assignee: "鈴木 健一", status: "closed", closedAt: "2026-06-15" },
    { receivedAt: "2026-06-15", channel: "walkin", customer: "大和田 千鶴", phone: "080-7788-9900", category: "inquiry", content: "個人でも購入可能かの確認。ショールーム見学を希望。", assignee: "高橋 直子", status: "closed", closedAt: "2026-06-15" },
    { receivedAt: "2026-06-18", channel: "email", customer: "アカネシステムズ", phone: "045-678-9012", category: "inquiry", content: "サーバーラックの耐荷重仕様書がほしい。", assignee: "渡辺 拓", status: "closed", closedAt: "2026-06-19" },
    { receivedAt: "2026-06-23", channel: "phone", customer: "ミドリ商事株式会社", phone: "06-2345-6789", category: "complaint", content: "納期回答が遅いとの指摘。今後の連絡フローを要調整。", assignee: "田中 誠", status: "in_progress" },
    { receivedAt: "2026-06-26", channel: "web", customer: "篠塚 洋子", phone: "080-3344-5566", category: "other", content: "求人の応募方法についての問い合わせ。", assignee: "中村 亜衣", status: "closed", closedAt: "2026-06-26" },
    { receivedAt: "2026-06-30", channel: "phone", customer: "北関東精機", phone: "027-345-1188", category: "inquiry", content: "支払サイトの変更相談。経理へ取次ぎ。", assignee: "中村 亜衣", status: "open" },
    { receivedAt: "2026-07-02", channel: "email", customer: "株式会社アオイ製作所", phone: "03-1234-5678", category: "repair", content: "検査治具の当たり調整を現地で実施してほしい。", assignee: "山口 剛", status: "open" },
    { receivedAt: "2026-07-06", channel: "walkin", customer: "河本 慎吾", phone: "090-6677-8899", category: "quote", content: "個人事業所向けに小型ラック3台の見積依頼。", assignee: "高橋 直子", status: "in_progress" },
  ],
};

const ASSET_LEDGER: SampleSheet = {
  key: "asset-ledger",
  name: "設備・備品台帳",
  category: "operations",
  description: "設備・PC・車両などの取得情報と点検予定・稼働状況",
  icon: "table",
  useCase: "固定資産の一覧が税理士向けの表しかなく、現物の所在が分からない会社に向いています。",
  listColumns: ["assetNo", "name", "category", "location", "user", "purchaseDate", "cost", "nextCheck", "status"],
  fields: [
    { key: "assetNo", name: "管理番号", type: "text", required: true },
    { key: "name", name: "品目", type: "text", required: true },
    { key: "category", name: "区分", type: "select", options: ASSET_CATEGORY },
    { key: "location", name: "設置場所", type: "text" },
    { key: "user", name: "使用者・管理者", type: "text" },
    { key: "purchaseDate", name: "取得日", type: "date" },
    { key: "cost", name: "取得価額", type: "currency" },
    { key: "nextCheck", name: "次回点検日", type: "date" },
    { key: "status", name: "状態", type: "select", options: ASSET_STATUS },
  ],
  rows: [
    { assetNo: "A-M001", name: "NC旋盤 TL-250", category: "machine", location: "第1工場", user: "山口 剛", purchaseDate: "2019-08-20", cost: 8600000, nextCheck: "2026-09-15", status: "active" },
    { assetNo: "A-M002", name: "マシニングセンタ MC-450", category: "machine", location: "第1工場", user: "林 悟", purchaseDate: "2021-03-11", cost: 12400000, nextCheck: "2026-08-28", status: "active" },
    { assetNo: "A-M003", name: "フォークリフト 1.5t", category: "machine", location: "資材倉庫", user: "小野 千夏", purchaseDate: "2018-05-30", cost: 2380000, nextCheck: "2026-07-30", status: "repair" },
    { assetNo: "A-M004", name: "コンプレッサ 7.5kW", category: "machine", location: "第2工場", user: "山口 剛", purchaseDate: "2016-10-05", cost: 980000, nextCheck: "2026-10-02", status: "idle" },
    { assetNo: "A-I001", name: "ノートPC ThinkClass 14", category: "it", location: "営業部", user: "田中 誠", purchaseDate: "2024-04-08", cost: 168000, nextCheck: "2027-04-08", status: "active" },
    { assetNo: "A-I002", name: "ノートPC ThinkClass 14", category: "it", location: "営業部", user: "佐藤 由美", purchaseDate: "2024-04-08", cost: 168000, nextCheck: "2027-04-08", status: "active" },
    { assetNo: "A-I003", name: "複合機 MFP-C360", category: "it", location: "本社2F", user: "中村 亜衣", purchaseDate: "2022-11-14", cost: 620000, nextCheck: "2026-11-14", status: "active" },
    { assetNo: "A-I004", name: "社内サーバー R240", category: "it", location: "サーバー室", user: "渡辺 拓", purchaseDate: "2021-06-21", cost: 940000, nextCheck: "2026-12-20", status: "active" },
    { assetNo: "A-F001", name: "会議用テーブル 2400mm", category: "furniture", location: "本社3F 会議室", user: "中村 亜衣", purchaseDate: "2020-02-17", cost: 128000, nextCheck: "2027-02-17", status: "active" },
    { assetNo: "A-F002", name: "書庫 スチール 6段", category: "furniture", location: "本社2F", user: "村上 沙織", purchaseDate: "2015-09-01", cost: 64000, nextCheck: "2027-09-01", status: "disposal" },
    { assetNo: "A-V001", name: "営業車 ハイブリッドセダン", category: "vehicle", location: "本社駐車場", user: "田中 誠", purchaseDate: "2023-07-03", cost: 2860000, nextCheck: "2026-07-25", status: "active" },
    { assetNo: "A-V002", name: "配送用トラック 2t", category: "vehicle", location: "資材倉庫", user: "林 悟", purchaseDate: "2020-12-09", cost: 3480000, nextCheck: "2026-12-09", status: "active" },
  ],
};

const CUSTOMER_SURVEY: SampleSheet = {
  key: "customer-survey",
  name: "顧客アンケート集計",
  category: "operations",
  description: "納品後アンケートの満足度・推奨度と自由記述の集計",
  icon: "report",
  useCase: "アンケート用紙を回収したものの、集計されないまま棚に積まれている会社向けです。",
  listColumns: ["respondedAt", "customer", "segment", "satisfaction", "nps", "goodPoints", "followUp"],
  fields: [
    { key: "respondedAt", name: "回答日", type: "date", required: true },
    { key: "customer", name: "回答者・顧客名", type: "text", required: true },
    { key: "segment", name: "区分", type: "select", options: CUSTOMER_SEGMENT },
    { key: "satisfaction", name: "総合満足度（1-5）", type: "number" },
    { key: "nps", name: "推奨度（0-10）", type: "number" },
    { key: "goodPoints", name: "良かった点", type: "multiselect", options: SURVEY_GOOD_POINTS },
    { key: "comment", name: "自由記述", type: "longtext" },
    { key: "followUp", name: "要フォロー", type: "checkbox" },
  ],
  rows: [
    { respondedAt: "2026-05-12", customer: "株式会社アオイ製作所", segment: "corporate", satisfaction: 5, nps: 9, goodPoints: ["speed", "quality"], comment: "急な仕様変更にも即日で返答いただけた。", followUp: false },
    { respondedAt: "2026-05-15", customer: "ミドリ商事株式会社", segment: "corporate", satisfaction: 3, nps: 6, goodPoints: ["price"], comment: "価格は納得だが、納期回答までの連絡が遅かった。", followUp: true },
    { respondedAt: "2026-05-20", customer: "小島 直樹", segment: "individual", satisfaction: 4, nps: 8, goodPoints: ["support", "quality"], comment: "組立の説明が丁寧で助かった。", followUp: false },
    { respondedAt: "2026-05-28", customer: "キイロ物産", segment: "corporate", satisfaction: 2, nps: 3, goodPoints: ["price"], comment: "納品時に傷があった。交換対応は早かったが再発防止を希望。", followUp: true },
    { respondedAt: "2026-06-03", customer: "ソラ建設株式会社", segment: "corporate", satisfaction: 5, nps: 10, goodPoints: ["speed", "proposal", "support"], comment: "現場の制約を踏まえた代案を出してもらえた。", followUp: false },
    { respondedAt: "2026-06-09", customer: "大和田 千鶴", segment: "individual", satisfaction: 4, nps: 7, goodPoints: ["support"], comment: "ショールームでの相談がしやすかった。", followUp: false },
    { respondedAt: "2026-06-14", customer: "アカネシステムズ", segment: "corporate", satisfaction: 4, nps: 8, goodPoints: ["quality", "proposal"], comment: "仕様書の粒度がちょうど良かった。", followUp: false },
    { respondedAt: "2026-06-19", customer: "ハナミズキ工業", segment: "corporate", satisfaction: 3, nps: 5, goodPoints: ["quality"], comment: "納期が2週間ずれた。事前連絡があれば問題なかった。", followUp: true },
    { respondedAt: "2026-06-25", customer: "河本 慎吾", segment: "individual", satisfaction: 5, nps: 9, goodPoints: ["speed", "price"], comment: "見積が翌日に届いたのが決め手。", followUp: false },
    { respondedAt: "2026-07-01", customer: "北関東精機", segment: "corporate", satisfaction: 4, nps: 7, goodPoints: ["support", "speed"], comment: "問い合わせ窓口が明確で助かる。", followUp: false },
    { respondedAt: "2026-07-04", customer: "篠塚 洋子", segment: "individual", satisfaction: 3, nps: 6, goodPoints: ["price"], comment: "Webの商品情報がもう少し詳しいと嬉しい。", followUp: true },
    { respondedAt: "2026-07-08", customer: "浪速プレス工業", segment: "corporate", satisfaction: 5, nps: 10, goodPoints: ["quality", "speed", "support"], comment: "長年安定した品質。今後も継続したい。", followUp: false },
  ],
};

/** The full library, in gallery order. */
export const SAMPLE_SHEETS: SampleSheet[] = [
  DAILY_SALES,
  QUOTE_LINES,
  PURCHASE_ORDERS,
  CASH_LEDGER,
  INVENTORY,
  SUPPLIERS,
  ATTENDANCE,
  EXPENSES,
  EMPLOYEES,
  PROJECT_PROGRESS,
  INQUIRY_LOG,
  ASSET_LEDGER,
  CUSTOMER_SURVEY,
];

export function getSampleSheet(key: string): SampleSheet | undefined {
  return SAMPLE_SHEETS.find((s) => s.key === key);
}

/** Sheets belonging to one category, in library order. */
export function getSampleSheetsByCategory(category: SampleCategory): SampleSheet[] {
  return SAMPLE_SHEETS.filter((s) => s.category === category);
}

export function getSampleCategory(id: string) {
  return SAMPLE_CATEGORIES.find((c) => c.id === id);
}

/** How many sheets each category holds — used by the gallery tabs. */
export function sampleSheetCounts(): Record<SampleCategory, number> {
  const counts = { sales: 0, inventory: 0, hr: 0, operations: 0 } as Record<
    SampleCategory,
    number
  >;
  for (const s of SAMPLE_SHEETS) counts[s.category] += 1;
  return counts;
}
