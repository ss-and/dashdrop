/**
 * プランの定義と、実際に効いている上限。
 *
 * ここに書いてよいのは「製品が今できること」と「まだできないこと」の区別が
 * ついた情報だけ。以前は Pro / Business の機能として「API アクセス」
 * 「Webhook」「監査ログ・権限管理」「メンバー N 名まで」を並べていたが、
 * API トークンの発行もWebhookの送信も権限の判定もメンバーの招待も
 * 実装が存在しない。売り文句と製品を一致させるため、
 *   features … 今この製品で実際に使えること
 *   planned  … 提供予定（画面では必ず「予定」と明示する）
 * に分けてある。
 *
 * さらに重要な前提として、**現在このアプリに有料プランへ移る手段は無い**。
 * `Workspace.plan` を書くのはサインアップ（常に "free"）とシードだけで、
 * 決済も Webhook もアップグレードのAPIも存在しない。だから
 * `available: false` のプランは「準備中」としてしか表示してはいけない。
 */

export type PlanId = "free" | "pro" | "business";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** 月額（円）。0 = 無料、null = 「お問い合わせ」。 */
  priceMonthly: number | null;
  /**
   * 今すぐ利用できるプランか。false は「準備中」— 申し込みも課金も、
   * プランを切り替える手段もまだ無い。
   */
  available: boolean;
  highlighted?: boolean;
  /**
   * 上限値。
   *
   * 実際にサーバ側で効いているのは次の2つだけ:
   *  - collections          … src/lib/master-objects.ts の assertWithinCollectionLimit
   *  - recordsPerCollection … src/lib/workspace.ts と各 import ルート
   *
   * members / monthlyImports / apiAccess は、対応する機能（招待、月次の
   * 取り込み計測、APIトークン）自体がまだ無いため、どこでも参照していない
   * 「提供時の想定値」。画面には planned 経由でしか出さないこと。
   */
  limits: {
    collections: number; // 上限: スプレッドシート数（有効）
    recordsPerCollection: number; // 上限: 1シートの行数（有効）
    members: number; // 招待機能ができたときの想定値（未実装）
    monthlyImports: number; // 取り込み計測ができたときの想定値（未実装）
    apiAccess: boolean; // 公開APIができたときの想定値（未実装）
  };
  /** 今この製品で実際に使える機能。 */
  features: string[];
  /** 提供予定（未実装）。画面では「予定」と分けて表示する。 */
  planned: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "今すぐ使える、唯一のプラン",
    priceMonthly: 0,
    available: true,
    // 現時点で契約できるのはこのプランだけなので、ここを主役にする。
    highlighted: true,
    // Roomy enough for the CRM core (顧客/担当者/商談/活動) plus a few imports —
    // the customer database is the product's backbone, not a paid add-on.
    limits: {
      collections: 10,
      recordsPerCollection: 500,
      members: 2,
      monthlyImports: 10,
      apiAccess: false,
    },
    features: [
      "顧客データベース（顧客・担当者・商談・請求書・活動）",
      "人事データベース（部署・社員・勤怠・休暇申請・評価）",
      "スプレッドシート 10個まで",
      "1シート 500行まで",
      "Excel / CSV / Google スプレッドシート / Notion の取り込み",
      "Excel（.xlsx）への書き出し",
      "ダッシュボード（テンプレート・自動生成・共有リンク）",
      "数式・VLOOKUP・シート間リレーション",
      "アラート（アプリ内通知・Slack 通知）",
      "定期レポート（アプリ内通知＋印刷 / PDF）",
    ],
    planned: [],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "上限を広げたい成長企業向け（準備中）",
    priceMonthly: 3800,
    available: false,
    limits: {
      collections: 50,
      recordsPerCollection: 50000,
      members: 15,
      monthlyImports: 500,
      apiAccess: true,
    },
    features: [],
    planned: [
      "スプレッドシート 50個まで",
      "1シート 50,000行まで",
      "メンバーの招待（15名まで）",
      "API アクセス",
      "優先サポート",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    tagline: "複数拠点・本格運用向け（準備中）",
    priceMonthly: 12000,
    available: false,
    limits: {
      collections: 1000,
      recordsPerCollection: 1000000,
      members: 100,
      monthlyImports: 100000,
      apiAccess: true,
    },
    features: [],
    planned: [
      "スプレッドシート 実質無制限",
      "1シート 100万行まで",
      "メンバーの招待（100名まで）",
      "API アクセス + Webhook",
      "権限管理・監査ログ",
      "専任サポート / SLA",
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "pro", "business"];

export function getPlan(id: string | null | undefined): Plan {
  if (id && (id === "free" || id === "pro" || id === "business")) {
    return PLANS[id];
  }
  return PLANS.free;
}

export function formatPrice(plan: Plan): string {
  if (plan.priceMonthly === null) return "お問い合わせ";
  if (plan.priceMonthly === 0) return "¥0";
  return `¥${plan.priceMonthly.toLocaleString("ja-JP")}`;
}

/**
 * 申し込める（＝プランを切り替えられる）プランがあるか。
 *
 * 決済もアップグレードのAPIも無いので今は常に false。課金を実装するときは
 * `available` を立てるだけで、価格表もお申し込み導線も追随する。
 */
export const anyPlanPurchasable = PLAN_ORDER.some((id) => {
  const plan = PLANS[id];
  return plan.available && plan.priceMonthly !== 0;
});
