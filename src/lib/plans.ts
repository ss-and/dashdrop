/**
 * Pricing plans and their enforced limits. Shared by the pricing page,
 * the billing stub, and server-side limit checks.
 */

export type PlanId = "free" | "pro" | "business";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Monthly price in JPY. 0 = free, null = "contact us". */
  priceMonthly: number | null;
  highlighted?: boolean;
  limits: {
    collections: number; // max collections (tables)
    recordsPerCollection: number; // max rows per collection
    members: number; // max workspace members
    monthlyImports: number; // max spreadsheet imports / month
    apiAccess: boolean;
  };
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "個人・小さく始めるチーム向け",
    priceMonthly: 0,
    limits: {
      collections: 3,
      recordsPerCollection: 500,
      members: 2,
      monthlyImports: 10,
      apiAccess: false,
    },
    features: [
      "テーブル 3個まで",
      "1テーブル 500行まで",
      "メンバー 2名まで",
      "Excel / CSV インポート・エクスポート",
      "週間パフォーマンス ダッシュボード",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "成長する中小企業向け",
    priceMonthly: 3800,
    highlighted: true,
    limits: {
      collections: 50,
      recordsPerCollection: 50000,
      members: 15,
      monthlyImports: 500,
      apiAccess: true,
    },
    features: [
      "テーブル 50個まで",
      "1テーブル 50,000行まで",
      "メンバー 15名まで",
      "API アクセス",
      "無制限に近いインポート",
      "優先サポート",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    tagline: "複数拠点・本格運用向け",
    priceMonthly: 12000,
    limits: {
      collections: 1000,
      recordsPerCollection: 1000000,
      members: 100,
      monthlyImports: 100000,
      apiAccess: true,
    },
    features: [
      "テーブル 実質無制限",
      "1テーブル 100万行まで",
      "メンバー 100名まで",
      "API アクセス + Webhook",
      "監査ログ・権限管理",
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
