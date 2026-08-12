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
  {
    id: "retail",
    label: "小売・EC",
    description: "店舗売上・EC受注・在庫回転の可視化",
    icon: "table",
    color: "khaki",
  },
  {
    id: "manufacturing",
    label: "製造・生産",
    description: "生産実績・稼働率・品質・製造原価の管理",
    icon: "check-square",
    color: "info",
  },
  {
    id: "construction",
    label: "建設・工事",
    description: "工事案件の進捗・原価・現場の安全管理",
    icon: "folder",
    color: "warning",
  },
  {
    id: "restaurant",
    label: "飲食・店舗",
    description: "日次売上・客単価・メニュー別の原価分析",
    icon: "table",
    color: "danger",
  },
  {
    id: "logistics",
    label: "物流・配送",
    description: "配送実績・遅延分析・車両稼働の管理",
    icon: "download",
    color: "info",
  },
  {
    id: "realestate",
    label: "不動産",
    description: "物件の成約管理と賃貸の入居率・賃料収入",
    icon: "folder",
    color: "success",
  },
  {
    id: "clinic",
    label: "クリニック・治療院",
    description: "予約・来院状況と診療科別の売上を把握",
    icon: "inbox",
    color: "info",
  },
  {
    id: "education",
    label: "教育・スクール",
    description: "受講生の在籍・月謝売上と出席・継続率",
    icon: "users",
    color: "khaki",
  },
  {
    id: "project",
    label: "プロジェクト・受託",
    description: "受託案件の採算とメンバーの稼働工数を管理",
    icon: "dashboard",
    color: "warning",
  },
];

export function getCategory(id: string): DashboardCategory | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
