/** Dashboard template categories shown as tabs in the gallery. */
export interface DashboardCategory {
  id: string;
  label: string;
  description: string;
  icon: string; // NavIcon/CollectionIcon name
  color: string; // token: khaki|info|success|warning|danger
}

export const CATEGORIES: DashboardCategory[] = [
  {
    id: "support",
    label: "問い合わせ・サポート",
    description: "顧客対応・問い合わせ・サポート品質の可視化",
    icon: "inbox",
    color: "info",
  },
  {
    id: "sales",
    label: "営業・セールス",
    description: "商談パイプライン・受注・売上目標の進捗",
    icon: "sparkles",
    color: "khaki",
  },
  {
    id: "billing",
    label: "請求・売上",
    description: "請求書・入金・売掛金の管理",
    icon: "table",
    color: "success",
  },
  {
    id: "finance",
    label: "経理・財務",
    description: "経費・キャッシュフロー・予実の管理",
    icon: "table",
    color: "warning",
  },
  {
    id: "hr",
    label: "人事・HR",
    description: "採用・勤怠・従業員の状況を把握",
    icon: "users",
    color: "info",
  },
  {
    id: "marketing",
    label: "マーケティング",
    description: "リード・施策・チャネル別の効果測定",
    icon: "sparkles",
    color: "danger",
  },
  {
    id: "operations",
    label: "在庫・オペレーション",
    description: "在庫・受発注・現場業務の管理",
    icon: "check-square",
    color: "khaki",
  },
  {
    id: "executive",
    label: "経営サマリー",
    description: "全社KPIを一枚で俯瞰する経営ダッシュボード",
    icon: "dashboard",
    color: "khaki",
  },
];

export function getCategory(id: string): DashboardCategory | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
