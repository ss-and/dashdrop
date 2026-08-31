/**
 * 事業者情報。
 *
 * 特定商取引法に基づく表記は、**実在の事業者の情報でなければ意味が無い**。
 * ここを埋めるのは運営者の仕事なので、コードでは埋められない項目を空のまま
 * 置き、画面には「未記入」と出す。うっかり空欄のまま公開しても、それが
 * 画面で分かるようにするため（黙って空文字を出すと気づけない）。
 *
 * ⚠ この配下の文面は、法務の確認を受けていない下書きです。
 *   公開前に、必ず弁護士・行政書士の確認を受けてください。
 */

export interface LegalEntry {
  label: string;
  value: string;
  /** 記入が必須の項目か（特商法で求められるもの）。 */
  required?: boolean;
  /** 補足。 */
  note?: string;
}

/** サービス名と運営者。規約・ポリシー全体で使う。 */
export const SERVICE_NAME = "DashDrop";

/**
 * 特定商取引法に基づく表記。
 * 有料で提供する場合、ここが空のまま公開することはできない。
 */
export const COMMERCE_ENTRIES: LegalEntry[] = [
  { label: "販売事業者", value: "S&S合同会社", required: true },
  { label: "運営統括責任者", value: "境野 竣介", required: true },
  { label: "所在地", value: "東京都渋谷区道玄坂1丁目10番8号 渋谷道玄坂東急ビル2F-C", required: true },
  { label: "電話番号", value: "請求があれば遅滞なく開示いたします", required: true },
  { label: "メールアドレス", value: "ssakaino@ss-and.com", required: true },
  { label: "販売価格", value: "料金ページに記載の金額（消費税込み）", required: true },
  { label: "商品代金以外の必要料金", value: "インターネット接続に必要な通信料はお客様のご負担となります。" },
  { label: "支払方法", value: "", required: true, note: "クレジットカード決済など、実際の手段を記載" },
  { label: "支払時期", value: "", required: true },
  { label: "役務の提供時期", value: "お申し込み手続の完了後、直ちにご利用いただけます。" },
  {
    label: "返品・キャンセル",
    value:
      "サービスの性質上、提供開始後の返金には応じかねます。解約はいつでも可能で、解約後は次回請求が発生しません。",
  },
  { label: "動作環境", value: "最新版の Google Chrome / Microsoft Edge / Safari / Firefox" },
];

/**
 * 「誰が運営しているか」だけを抜き出したもの。
 *
 * 無償で提供している間は特商法の表示義務が無い。それでも運営者と連絡先は
 * 出す——名前も宛先も無いサービスに、自社の売上や顧客の一覧を預ける人はいない。
 * 売り始めたら COMMERCE_ENTRIES の全項目に切り替わる。
 */
export const SELLER_ENTRIES: LegalEntry[] = COMMERCE_ENTRIES.filter((e) =>
  ["販売事業者", "運営統括責任者", "メールアドレス"].includes(e.label),
);

/** 未記入の必須項目。1つでもあれば公開前の作業が残っている。 */
export function missingCommerceEntries(): string[] {
  return COMMERCE_ENTRIES.filter((e) => e.required && e.value.trim() === "").map(
    (e) => e.label,
  );
}

/** 問い合わせ先。規約・ポリシーの末尾に出す。 */
export const CONTACT_EMAIL = "ssakaino@ss-and.com";

/** 最終改定日。文面を変えたら必ず更新する。 */
export const LEGAL_UPDATED_AT = "2026-08-20";
