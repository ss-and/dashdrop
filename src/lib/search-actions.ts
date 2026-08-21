/**
 * 検索から直接叩ける操作。
 *
 * Salesforce のグローバル検索が強いのは、名前を探すだけでなく
 * **「やりたいこと」からも辿れる**ところ。「取り込み」と打った人が探して
 * いるのはたいてい既存のファイル名ではなく、取り込む場所そのものです。
 *
 * ここは実データを引かないので、検索窓を開いた瞬間から候補に出せる。
 * 通信を待たずに出る候補が1つでもあると、窓が空のまま止まらない。
 */

export interface SearchAction {
  id: string;
  label: string;
  /** 一覧に添える一言。何が起きるかを動詞で書く。 */
  hint: string;
  href: string;
  /** icons.tsx の NavIcon 名。 */
  icon: string;
  /**
   * 別名。日本語の業務ユーザーは「インポート」とも「取り込み」とも打つし、
   * 英字で "import" と打つ人もいる。表示名だけで引くと、そのどれもが
   * 空振りする。
   */
  keywords: string[];
}

export const SEARCH_ACTIONS: SearchAction[] = [
  {
    id: "import",
    label: "Excel を取り込む",
    hint: "置くだけで表とグラフになります",
    href: "/home",
    icon: "upload",
    keywords: ["excel", "エクセル", "取り込み", "とりこみ", "インポート", "import", "アップロード", "csv", "追加"],
  },
  {
    id: "import-review",
    label: "列を確認しながら取り込む",
    hint: "項目名と型を直してから入れる",
    href: "/import",
    icon: "upload",
    keywords: ["取り込み", "インポート", "import", "列", "項目", "型", "マッピング"],
  },
  {
    id: "dashboard-new",
    label: "ダッシュボードを作る",
    hint: "テンプレートから、または自分で組む",
    href: "/dashboards/new",
    icon: "dashboard",
    keywords: ["ダッシュボード", "dashboard", "グラフ", "作成", "新規", "new", "chart"],
  },
  {
    id: "dashboards",
    label: "ダッシュボードの一覧",
    hint: "作ったものを全部見る",
    href: "/dashboards",
    icon: "dashboard",
    keywords: ["ダッシュボード", "dashboard", "一覧", "list"],
  },
  {
    id: "sheet-new",
    label: "スプレッドシートを作る",
    hint: "空の表から始める",
    href: "/c/new",
    icon: "table",
    keywords: ["シート", "表", "スプレッドシート", "sheet", "table", "作成", "新規"],
  },
  {
    id: "alerts",
    label: "通知ルール",
    hint: "条件に当てはまったら知らせる",
    href: "/alerts",
    icon: "bell",
    keywords: ["通知", "アラート", "alert", "ルール", "しきい値", "メール"],
  },
  {
    id: "reports",
    label: "定期レポート",
    hint: "決まった時刻に送る",
    href: "/reports",
    icon: "report",
    keywords: ["レポート", "report", "定期", "配信", "スケジュール", "pdf", "メール"],
  },
  {
    id: "samples",
    label: "見本のデータで試す",
    hint: "手元にファイルが無いとき",
    href: "/samples",
    icon: "sparkles",
    keywords: ["サンプル", "見本", "sample", "demo", "デモ", "試す", "お試し"],
  },
  {
    id: "logs",
    label: "操作の記録",
    hint: "誰が何をしたか",
    href: "/logs",
    icon: "clock",
    keywords: ["ログ", "log", "履歴", "記録", "監査", "activity"],
  },
  {
    id: "settings",
    label: "設定",
    hint: "ワークスペース・メンバー・連携",
    href: "/settings",
    icon: "settings",
    keywords: ["設定", "せってい", "settings", "メンバー", "招待", "連携", "slack", "notion", "ai"],
  },
  {
    id: "plan",
    label: "プラン",
    hint: "使える量と料金",
    href: "/pricing",
    icon: "plan",
    keywords: ["プラン", "料金", "plan", "pricing", "課金", "支払い", "アップグレード"],
  },
];

/**
 * 打った文字で操作を絞る。
 *
 * 前方一致ではなく部分一致。「ダッシュ」でも「ボード」でも当たってほしいし、
 * 「せってい」（変換前のひらがな）で「設定」に届いてほしい。
 * 候補の数がもともと十数個なので、素直に全部見て構わない。
 */
export function matchActions(query: string, limit = 4): SearchAction[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  return SEARCH_ACTIONS.filter(
    (a) =>
      a.label.toLowerCase().includes(q) ||
      a.hint.toLowerCase().includes(q) ||
      a.keywords.some((k) => k.toLowerCase().includes(q)),
  ).slice(0, limit);
}
