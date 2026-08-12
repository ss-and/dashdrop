/**
 * The CRM core — the objects that make DashDrop the *master* record rather than
 * a viewer over imported files.
 *
 * Imported spreadsheets stay as-is (raw material), but 顧客 / 担当者 / 商談 / 活動
 * are first-class objects with typed fields and real relations between them, so
 * a workspace accumulates a customer database over time. Installed into a
 * workspace by `installCrm()` (src/lib/install-crm.ts), which resolves the
 * relation targets to the collections it just created.
 *
 * Definitions only — no DB access — so this module is safe to import anywhere.
 */
import type { FieldType, SelectOption } from "./field-types";

export type CrmSlug = "accounts" | "contacts" | "opportunities" | "activities";

export interface CrmField {
  key: string;
  name: string;
  type: FieldType;
  required?: boolean;
  options?: SelectOption[];
  /** For `relation` fields: which CRM object this points at. */
  relation?: { to: CrmSlug; multiple?: boolean; displayFieldKey?: string };
  /** For `lookup` fields: pull `target` through the relation field `via`. */
  lookup?: { via: string; target: string };
  /** For `rollup` fields: aggregate `target` across records linked by `via`. */
  rollup?: { via: string; target: string; op: "sum" | "count" | "avg" | "min" | "max" };
}

export interface CrmObject {
  slug: CrmSlug;
  name: string;
  /** Short plural label used in nav/launcher. */
  description: string;
  icon: string;
  color: string;
  fields: CrmField[];
  /** Columns to show in the Salesforce-style list view, in order. */
  listColumns: string[];
  /**
   * Demo rows. Relations are expressed by the *display name* of the target
   * record (e.g. account: "株式会社アオイ"); the installer resolves them to ids.
   */
  samples: Record<string, unknown>[];
}

/* ------------------------------- option sets ------------------------------ */

const INDUSTRY: SelectOption[] = [
  { label: "製造", value: "manufacturing" },
  { label: "卸売", value: "wholesale" },
  { label: "小売", value: "retail" },
  { label: "IT・情報通信", value: "it" },
  { label: "建設", value: "construction" },
  { label: "サービス", value: "service" },
  { label: "その他", value: "other" },
];

const ACCOUNT_STATUS: SelectOption[] = [
  { label: "見込み", value: "prospect", color: "info" },
  { label: "取引中", value: "active", color: "success" },
  { label: "休眠", value: "dormant", color: "khaki" },
];

const ACCOUNT_TIER: SelectOption[] = [
  { label: "A（重点）", value: "a", color: "success" },
  { label: "B", value: "b", color: "khaki" },
  { label: "C", value: "c", color: "info" },
];

const STAGE: SelectOption[] = [
  { label: "初回接触", value: "prospecting", color: "info" },
  { label: "提案", value: "proposal", color: "info" },
  { label: "見積提出", value: "quote", color: "warning" },
  { label: "交渉", value: "negotiation", color: "warning" },
  { label: "受注", value: "won", color: "success" },
  { label: "失注", value: "lost", color: "danger" },
];

const ACTIVITY_TYPE: SelectOption[] = [
  { label: "訪問", value: "visit" },
  { label: "電話", value: "call" },
  { label: "メール", value: "email" },
  { label: "打合せ", value: "meeting" },
  { label: "その他", value: "other" },
];

/* --------------------------------- objects -------------------------------- */

const ACCOUNTS: CrmObject = {
  slug: "accounts",
  name: "顧客",
  description: "取引先・見込み客のマスター",
  icon: "users",
  color: "khaki",
  listColumns: ["name", "industry", "status", "tier", "owner", "annualRevenue"],
  fields: [
    { key: "name", name: "取引先名", type: "text", required: true },
    { key: "industry", name: "業種", type: "select", options: INDUSTRY },
    { key: "status", name: "取引状況", type: "select", options: ACCOUNT_STATUS },
    { key: "tier", name: "ランク", type: "select", options: ACCOUNT_TIER },
    { key: "owner", name: "自社担当", type: "text" },
    { key: "phone", name: "電話", type: "phone" },
    { key: "email", name: "メール", type: "email" },
    { key: "website", name: "Webサイト", type: "url" },
    { key: "address", name: "住所", type: "text" },
    { key: "annualRevenue", name: "年間取引額", type: "currency" },
    { key: "note", name: "メモ", type: "longtext" },
  ],
  samples: [
    {
      name: "株式会社アオイ製作所",
      industry: "manufacturing",
      status: "active",
      tier: "a",
      owner: "田中",
      phone: "03-1234-5678",
      email: "info@aoi-mfg.co.jp",
      website: "https://aoi-mfg.example.jp",
      address: "東京都大田区1-2-3",
      annualRevenue: 12000000,
      note: "主力は精密部品。年2回の定期発注あり。",
    },
    {
      name: "ミドリ商事株式会社",
      industry: "wholesale",
      status: "active",
      tier: "b",
      owner: "佐藤",
      phone: "06-2345-6789",
      email: "sales@midori-trading.co.jp",
      address: "大阪府大阪市中央区4-5-6",
      annualRevenue: 8400000,
      note: "卸ルート開拓中。価格交渉がシビア。",
    },
    {
      name: "キイロ物産",
      industry: "retail",
      status: "active",
      tier: "b",
      owner: "鈴木",
      phone: "052-345-6789",
      email: "contact@kiiro-bussan.jp",
      address: "愛知県名古屋市中区7-8-9",
      annualRevenue: 5600000,
      note: "店舗向け消耗品が中心。",
    },
    {
      name: "ソラ建設株式会社",
      industry: "construction",
      status: "prospect",
      tier: "a",
      owner: "田中",
      phone: "011-456-7890",
      email: "info@sora-kensetsu.co.jp",
      address: "北海道札幌市北区10-11",
      annualRevenue: 0,
      note: "紹介経由の新規見込み。初回提案フェーズ。",
    },
    {
      name: "ハナミズキ工業",
      industry: "manufacturing",
      status: "dormant",
      tier: "c",
      owner: "佐藤",
      phone: "092-567-8901",
      email: "info@hanamizuki-ind.jp",
      address: "福岡県福岡市博多区12-13",
      annualRevenue: 1800000,
      note: "2年前に取引停止。再アプローチ候補。",
    },
    {
      name: "アカネシステムズ",
      industry: "it",
      status: "prospect",
      tier: "b",
      owner: "鈴木",
      phone: "045-678-9012",
      email: "hello@akane-sys.jp",
      website: "https://akane-sys.example.jp",
      address: "神奈川県横浜市西区14-15",
      annualRevenue: 0,
      note: "SaaS導入検討中。決裁は次期予算。",
    },
  ],
};

const CONTACTS: CrmObject = {
  slug: "contacts",
  name: "担当者",
  description: "顧客側のキーパーソン",
  icon: "users",
  color: "khaki",
  listColumns: ["name", "account", "title", "email", "phone", "isPrimary"],
  fields: [
    { key: "name", name: "氏名", type: "text", required: true },
    {
      key: "account",
      name: "顧客",
      type: "relation",
      relation: { to: "accounts", displayFieldKey: "name" },
    },
    { key: "title", name: "役職", type: "text" },
    { key: "department", name: "部署", type: "text" },
    { key: "email", name: "メール", type: "email" },
    { key: "phone", name: "電話", type: "phone" },
    { key: "isPrimary", name: "主担当", type: "checkbox" },
    {
      key: "accountIndustry",
      name: "顧客の業種",
      type: "lookup",
      lookup: { via: "account", target: "industry" },
    },
    { key: "note", name: "メモ", type: "longtext" },
  ],
  samples: [
    { name: "山田 太郎", account: "株式会社アオイ製作所", title: "購買部長", department: "購買部", email: "yamada@aoi-mfg.co.jp", phone: "03-1234-5679", isPrimary: true, note: "決裁権あり。レスポンス早い。" },
    { name: "井上 花子", account: "株式会社アオイ製作所", title: "主任", department: "生産技術部", email: "inoue@aoi-mfg.co.jp", phone: "03-1234-5680", isPrimary: false },
    { name: "高橋 健", account: "ミドリ商事株式会社", title: "営業課長", department: "営業部", email: "takahashi@midori-trading.co.jp", phone: "06-2345-6790", isPrimary: true, note: "価格交渉の窓口。" },
    { name: "中村 美咲", account: "キイロ物産", title: "店舗運営マネージャー", department: "運営部", email: "nakamura@kiiro-bussan.jp", phone: "052-345-6790", isPrimary: true },
    { name: "小林 誠", account: "ソラ建設株式会社", title: "経営企画室長", department: "経営企画室", email: "kobayashi@sora-kensetsu.co.jp", phone: "011-456-7891", isPrimary: true, note: "紹介元のキーパーソン。" },
    { name: "渡辺 遥", account: "アカネシステムズ", title: "情報システム部", department: "情報システム部", email: "watanabe@akane-sys.jp", phone: "045-678-9013", isPrimary: true },
  ],
};

const OPPORTUNITIES: CrmObject = {
  slug: "opportunities",
  name: "商談",
  description: "案件のパイプライン",
  icon: "report",
  color: "khaki",
  listColumns: ["name", "account", "amount", "stage", "closeDate", "owner"],
  fields: [
    { key: "name", name: "商談名", type: "text", required: true },
    {
      key: "account",
      name: "顧客",
      type: "relation",
      relation: { to: "accounts", displayFieldKey: "name" },
    },
    { key: "amount", name: "金額", type: "currency" },
    { key: "stage", name: "フェーズ", type: "select", options: STAGE },
    { key: "closeDate", name: "完了予定日", type: "date" },
    { key: "probability", name: "確度（%）", type: "number" },
    { key: "owner", name: "自社担当", type: "text" },
    {
      key: "accountIndustry",
      name: "顧客の業種",
      type: "lookup",
      lookup: { via: "account", target: "industry" },
    },
    { key: "note", name: "メモ", type: "longtext" },
  ],
  samples: [
    { name: "精密部品 定期発注（上期）", account: "株式会社アオイ製作所", amount: 3200000, stage: "won", closeDate: "2026-03-20", probability: 100, owner: "田中" },
    { name: "精密部品 追加ライン", account: "株式会社アオイ製作所", amount: 5600000, stage: "negotiation", closeDate: "2026-09-30", probability: 70, owner: "田中", note: "見積提出済み。納期が論点。" },
    { name: "卸ルート拡大パッケージ", account: "ミドリ商事株式会社", amount: 1800000, stage: "quote", closeDate: "2026-08-31", probability: 50, owner: "佐藤" },
    { name: "店舗消耗品 年間契約", account: "キイロ物産", amount: 840000, stage: "proposal", closeDate: "2026-10-15", probability: 40, owner: "鈴木" },
    { name: "新社屋向け什器一式", account: "ソラ建設株式会社", amount: 7400000, stage: "prospecting", closeDate: "2026-12-20", probability: 20, owner: "田中", note: "初回ヒアリング完了。" },
    { name: "業務システム刷新", account: "アカネシステムズ", amount: 4200000, stage: "proposal", closeDate: "2026-11-28", probability: 45, owner: "鈴木" },
    { name: "再取引トライアル", account: "ハナミズキ工業", amount: 600000, stage: "lost", closeDate: "2026-05-10", probability: 0, owner: "佐藤", note: "予算未確保で見送り。来期再打診。" },
  ],
};

const ACTIVITIES: CrmObject = {
  slug: "activities",
  name: "活動",
  description: "訪問・電話・メールの履歴",
  icon: "inbox",
  color: "khaki",
  listColumns: ["subject", "type", "date", "account", "opportunity", "owner"],
  fields: [
    { key: "subject", name: "件名", type: "text", required: true },
    { key: "type", name: "種別", type: "select", options: ACTIVITY_TYPE },
    { key: "date", name: "日付", type: "date" },
    {
      key: "account",
      name: "顧客",
      type: "relation",
      relation: { to: "accounts", displayFieldKey: "name" },
    },
    {
      key: "opportunity",
      name: "商談",
      type: "relation",
      relation: { to: "opportunities", displayFieldKey: "name" },
    },
    { key: "owner", name: "自社担当", type: "text" },
    { key: "note", name: "内容", type: "longtext" },
  ],
  samples: [
    { subject: "追加ラインの要件ヒアリング", type: "visit", date: "2026-07-08", account: "株式会社アオイ製作所", opportunity: "精密部品 追加ライン", owner: "田中", note: "納期短縮の要望。工場見学を実施。" },
    { subject: "見積の条件すり合わせ", type: "call", date: "2026-07-22", account: "株式会社アオイ製作所", opportunity: "精密部品 追加ライン", owner: "田中" },
    { subject: "卸価格テーブルの送付", type: "email", date: "2026-07-15", account: "ミドリ商事株式会社", opportunity: "卸ルート拡大パッケージ", owner: "佐藤" },
    { subject: "店舗巡回・在庫確認", type: "visit", date: "2026-07-30", account: "キイロ物産", opportunity: "店舗消耗品 年間契約", owner: "鈴木" },
    { subject: "初回提案（新社屋）", type: "meeting", date: "2026-08-04", account: "ソラ建設株式会社", opportunity: "新社屋向け什器一式", owner: "田中", note: "先方役員も同席。反応は良好。" },
    { subject: "現行システムの課題整理", type: "meeting", date: "2026-08-06", account: "アカネシステムズ", opportunity: "業務システム刷新", owner: "鈴木" },
    { subject: "再アプローチのご挨拶", type: "email", date: "2026-06-18", account: "ハナミズキ工業", owner: "佐藤" },
  ],
};

/** Install order matters: relation targets must exist first. */
export const CRM_OBJECTS: CrmObject[] = [
  ACCOUNTS,
  CONTACTS,
  OPPORTUNITIES,
  ACTIVITIES,
];

export const CRM_SLUGS: CrmSlug[] = CRM_OBJECTS.map((o) => o.slug);

export function getCrmObject(slug: string): CrmObject | undefined {
  return CRM_OBJECTS.find((o) => o.slug === slug);
}

/** True when a collection slug is one of the CRM core objects. */
export function isCrmSlug(slug: string): slug is CrmSlug {
  return CRM_SLUGS.includes(slug as CrmSlug);
}
