/**
 * 「最近見たもの」——検索窓を開いた瞬間に出す、その人の足あと。
 *
 * ## なぜサーバではなく端末に持つのか
 *
 * Salesforce は同じものをサーバ側（MRU）で持っているが、そこには
 * 「1画面開くたびに1回書き込む」という代償がある。DashDrop の使い方だと
 * 画面遷移は多く、書き込みの中身は**その人にしか意味がない**。
 * 台数をまたげない代わりに、DBに1行も足さずに済むほうを採った。
 *
 * 端末が変われば空になるが、そのときはサーバから「最近更新されたもの」を
 * 出す（/api/search/recent）。空の検索窓を見せないことが目的なので、
 * 出どころが2つあっても構わない——ただし**別の見出しで出す**。
 * 「自分が見たもの」と「誰かが更新したもの」は別の情報で、混ぜると
 * 「開いた覚えのないものが履歴にある」ことになる。
 */

export type RecentKind = "dashboard" | "sheet" | "file" | "record";

export interface RecentItem {
  kind: RecentKind;
  /** 同じものを二重に持たないための鍵。href をそのまま使う。 */
  href: string;
  name: string;
  /** 補足（レコードなら所属シート名など）。 */
  sub?: string;
  /** 記録した時刻（ミリ秒）。並べ替えにだけ使う。 */
  at: number;
}

/** 保持する件数。多すぎると「最近」でなくなる。 */
const LIMIT = 12;

const keyFor = (workspaceId: string) => `dashdrop:recent:${workspaceId}`;

/**
 * 読み出し。
 *
 * localStorage は利用者が手で書き換えられるし、古い版の形が残っていることも
 * ある。**壊れていたら黙って空にする**——履歴の表示のために画面を落とすのは
 * 割に合わない。
 */
export function readRecent(workspaceId: string, limit = LIMIT): RecentItem[] {
  if (typeof window === "undefined" || !workspaceId) return [];
  try {
    const raw = window.localStorage.getItem(keyFor(workspaceId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecentItem)
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
  } catch {
    return [];
  }
}

function isRecentItem(v: unknown): v is RecentItem {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.href === "string" &&
    o.href.startsWith("/") &&
    typeof o.name === "string" &&
    o.name.length > 0 &&
    typeof o.at === "number" &&
    Number.isFinite(o.at) &&
    (o.kind === "dashboard" || o.kind === "sheet" || o.kind === "file" || o.kind === "record")
  );
}

/**
 * 記録する。同じ場所は上書きして先頭へ。
 *
 * 名前が変わっていれば新しい名前で置き換える（ダッシュボードを改名したのに
 * 履歴だけ古い名前で残ると、押すまでどれか分からない）。
 */
export function rememberRecent(
  workspaceId: string,
  item: Omit<RecentItem, "at">,
): void {
  if (typeof window === "undefined" || !workspaceId) return;
  if (!item.href.startsWith("/") || item.name.trim() === "") return;
  try {
    const next = [
      { ...item, name: item.name.trim(), at: Date.now() },
      ...readRecent(workspaceId, LIMIT).filter((r) => r.href !== item.href),
    ].slice(0, LIMIT);
    window.localStorage.setItem(keyFor(workspaceId), JSON.stringify(next));
    // 同じタブの検索窓にも、開き直さずに届くように。
    window.dispatchEvent(new CustomEvent("dashdrop:recent"));
  } catch {
    /* 容量超過やプライベートモード。履歴は無くても製品は動く。 */
  }
}

/** 消えたものを履歴から外す（削除したダッシュボードが残り続けないように）。 */
export function forgetRecent(workspaceId: string, href: string): void {
  if (typeof window === "undefined" || !workspaceId) return;
  try {
    const next = readRecent(workspaceId, LIMIT).filter((r) => r.href !== href);
    window.localStorage.setItem(keyFor(workspaceId), JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("dashdrop:recent"));
  } catch {
    /* 同上 */
  }
}
