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

/* ------------------------------ できること ------------------------------ */

/**
 * プランで開け閉めする機能のまとまり。
 *
 * 「Free はどこまで」を1か所で決めるためのもの。判定を各APIに散らすと、
 * 塞いだつもりの入口が1つ残る——しかも塞ぎ忘れた側は誰も報告しないので、
 * 気づくのは「なぜか使えている」と言われたときになる。
 */
export type Capability =
  /** Slack / Notion / Google スプレッドシート との連携。 */
  | "integrations"
  /** 数式・VLOOKUP・ルックアップ・ロールアップ（計算する項目）。 */
  | "computedFields"
  /** 通知ルール（条件に当てはまったら知らせる）。 */
  | "alerts"
  /** 定期レポート（決まった時刻に送る）。 */
  | "reports"
  /** 顧客データベース・人事データベース。 */
  | "databases"
  /**
   * AI による下見（取り込み時の列名・型の提案）と、AI ダッシュボード生成。
   *
   * これだけは**性質が違う**。他の5つは「うちのサーバで動く機能」だが、これは
   * 1回叩くたびに外部（Anthropic）へ実費が出ていく。しかも入口は無料アカウントの
   * ホーム——ファイルを置くたび毎回呼ぶので、上限が無ければ1アカウントで
   * いくらでも積める。値付けとして閉じるだけでなく、開いている側にも
   * 回数制限を掛けている（src/lib/rate-limit.ts の AI_RULE）。
   *
   * 閉じても**機能そのものは無くならない**のがここの肝。下見も生成も、
   * 決定的なヒューリスティックに落ちて最後まで通る（403 では止めない）。
   * 変わるのは「提案の精度」だけなので、Free でも Excel を置けば表とグラフが出る
   * ——この製品の約束は Free のまま守られる。
   */
  | "aiAssist";

export const CAPABILITY_LABEL: Record<Capability, string> = {
  integrations: "連携（Slack・Notion・Google スプレッドシート）",
  computedFields: "数式・VLOOKUP",
  alerts: "通知ルール",
  reports: "定期レポート",
  databases: "顧客データベース・人事データベース",
  aiAssist: "AIによる下見・AIダッシュボード生成",
};

/** 有料プランで開くもの一式。Pro と Business の差は上限だけ。 */
const PAID_CAPABILITIES: Capability[] = [
  "integrations",
  "computedFields",
  "alerts",
  "reports",
  "databases",
  "aiAssist",
];

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
    /**
     * 上限: 取り込んだ Excel ファイル（ブック）の数。
     *
     * Free を「1つ」にしているのは、この製品の約束——**Excelを置いたら
     * ダッシュボードが出る**——をまるごと1回体験できて、2つ目から先が
     * 継続利用になる、という線だから。行数やシート数で切ると、
     * 1つ目のファイルの途中で止まって約束が果たせない。
     */
    workbooks: number;
    collections: number; // 上限: スプレッドシート数（有効）
    recordsPerCollection: number; // 上限: 1シートの行数（有効）
    members: number; // 招待機能ができたときの想定値（未実装）
    monthlyImports: number; // 取り込み計測ができたときの想定値（未実装）
    apiAccess: boolean; // 公開APIができたときの想定値（未実装）
  };
  /** このプランで開いている機能。 */
  capabilities: Capability[];
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
    /*
     * シート数を12にしてあるのは、「1つのファイルに入っているタブ」を
     * 収めるため。実際の業務Excelは3〜8タブが普通で、月ごとにタブを
     * 分けているものだと12枚になる。ここで切ると、Free の唯一のファイルが
     * 途中までしか入らない——約束を果たせないまま上限に当たる形になる。
     */
    limits: {
      workbooks: 1,
      collections: 12,
      recordsPerCollection: 500,
      members: 2,
      monthlyImports: 10,
      apiAccess: false,
    },
    capabilities: [],
    features: [
      "Excel / CSV を1ファイル取り込み",
      "1シート 500行まで（1ファイル 12シートまで）",
      "取り込んだ表の編集・並べ替え・絞り込み",
      "ダッシュボードの自動作成（22種類のグラフ・8つの配色）",
      "ダッシュボードの共有リンク",
      "Excel（.xlsx）への書き出し",
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
      workbooks: 20,
      collections: 50,
      recordsPerCollection: 50000,
      members: 15,
      monthlyImports: 500,
      apiAccess: true,
    },
    capabilities: PAID_CAPABILITIES,
    features: [],
    planned: [
      "Excel 20ファイルまで・スプレッドシート 50個まで",
      "1シート 50,000行まで",
      "連携（Slack・Notion・Google スプレッドシート）",
      "数式・VLOOKUP・シート間リレーション",
      "通知ルール（条件に当てはまったら知らせる）",
      "定期レポート（決まった時刻に送る）",
      "顧客データベース・人事データベース",
      "AIによる取り込みの下見・AIダッシュボード生成",
      "メンバーの招待（15名まで）",
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
      workbooks: 1000,
      collections: 1000,
      recordsPerCollection: 1000000,
      members: 100,
      monthlyImports: 100000,
      apiAccess: true,
    },
    capabilities: PAID_CAPABILITIES,
    features: [],
    planned: [
      "Pro のすべて",
      "Excel・スプレッドシート 実質無制限",
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

/* ------------------------- 制限をいつ効かせるか ------------------------- */

/**
 * 上限と機能の制限を、実際に効かせてよいか。
 *
 * ## なぜ「常に効かせる」ではないのか
 *
 * 買えないプランの後ろに機能を隠すと、**誰も使えない機能になる**。
 * 「この機能には Pro が必要です」と出したところで申し込む先が無いので、
 * 利用者にとっては単に壊れたのと同じ。制限が無い状態より確実に悪い。
 *
 * なので、線引きそのものはここに全部書いて動くようにしておき、
 * **効かせ始めるのは Pro が実際に買えるようになった瞬間**にする。
 * `anyPlanPurchasable` は決済ができたときに `available: true` を立てれば
 * 自動で真になるので、そのとき追加の作業は要らない。
 *
 * 価格表には今から新しい線を載せる。「いくらで何ができるか」を先に
 * 決めて見せるのは、隠すこととは別のことなので。
 */
export const plansEnforced = anyPlanPurchasable;

/**
 * そのプランに、この機能が**含まれているか**。値付けそのもの。
 * 効かせているかどうかは見ない——価格表を組み立てるのはこちら。
 */
export function planIncludes(
  planId: string | null | undefined,
  cap: Capability,
): boolean {
  return getPlan(planId).capabilities.includes(cap);
}

/**
 * いま実際に使えるか。値付け（planIncludes）に、効かせるかどうかを掛けたもの。
 * 止める側はこちらを見る。
 */
export function can(
  planId: string | null | undefined,
  cap: Capability,
): boolean {
  if (!plansEnforced) return true;
  return planIncludes(planId, cap);
}

/**
 * そのプランの上限。**そのままの数**を返す。
 *
 * ここで「効かせていない間は大きな数」を返すようにはしない。上限の値は
 * 価格表にも案内の文面にも出るもので、判定の都合で書き換えると
 * 「Free は10個まで」と書いてある画面が11個目を受け入れることになる。
 * 効かせるかどうかは、止める側（src/lib/workspace.ts）で判断する。
 */
export function limitOf(
  planId: string | null | undefined,
  key: keyof Plan["limits"],
): number {
  const value = getPlan(planId).limits[key];
  return typeof value === "number" ? value : 0;
}

/**
 * 断るときの文面。
 *
 * 何ができないかだけでなく、**いま何ができるのか**を必ず添える。
 * 「Proが必要です」で終わる案内は、申し込めない今は行き止まりになる。
 */
export function upgradeMessage(cap: Capability): string {
  return `${CAPABILITY_LABEL[cap]}は Pro 以上の機能です。Pro は準備中で、開始までは Free のままお使いいただけます。`;
}

export function limitMessage(what: string, limit: number): string {
  return `${what}は Free プランでは ${limit.toLocaleString("ja-JP")} までです。Pro は準備中です。`;
}
