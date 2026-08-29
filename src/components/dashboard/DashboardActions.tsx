"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { NavIcon } from "@/components/app/icons";

/**
 * Action row for a rendered dashboard: clear seeded sample data, jump to the
 * underlying table, or delete the dashboard. Destructive actions confirm first.
 *
 * 共有は3つ並ぶ——読み取り専用リンク、Slack、Notion。同じ「共有」なので、
 * 別々の場所に散らさず1つの吹き出しにまとめてある。
 */

/** GET /api/dashboards/[id]/share/targets の応答。 */
interface ShareTargets {
  slack: { connected: boolean; hint: string | null };
  notion: {
    connected: boolean;
    pages: Array<{ id: string; title: string }>;
    error: string | null;
  };
}
export function DashboardActions({
  dashboardId,
  firstCollectionId,
  hasSampleData,
  initialShareToken,
}: {
  dashboardId: string;
  firstCollectionId?: string;
  hasSampleData: boolean;
  initialShareToken?: string | null;
}) {
  const router = useRouter();
  /*
   * 破壊的な操作の確認。以前はブラウザ標準の確認ダイアログを3か所で呼んでいたが、
   * 1行しか書けないので「何が残るか」を語尾に押し込むしか無かった。
   * 製品の中のダイアログにして、残るものを別の行で言えるようにしてある。
   */
  const { ask, confirmDialog } = useConfirm();
  const [clearing, setClearing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [shareToken, setShareToken] = useState<string | null>(initialShareToken ?? null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  /*
   * 送り先（Slack / Notion）の状態。
   *
   * 共有ボタンを開いた時点で取りに行く。押してから「接続されていません」と
   * 言われるより、最初から押せる／押せないが見えている方が早い。
   */
  const [targets, setTargets] = useState<ShareTargets | null>(null);
  const [notionPage, setNotionPage] = useState("");
  const [sending, setSending] = useState<"slack" | "notion" | null>(null);
  const [sent, setSent] = useState<{ to: "slack" | "notion"; url?: string } | null>(
    null,
  );

  const loadTargets = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/share/targets`);
      const json = await res.json();
      if (res.ok && json.ok) setTargets(json.data as ShareTargets);
    } catch {
      // 取れなくても共有リンクの機能は使えるべきなので、黙って諦める。
    }
  }, [dashboardId]);

  useEffect(() => {
    if (shareOpen && targets === null) void loadTargets();
  }, [shareOpen, targets, loadTargets]);

  // Notionの作成先は、候補が1つなら選ぶ手間を省く。
  useEffect(() => {
    if (!notionPage && targets?.notion.pages.length === 1) {
      setNotionPage(targets.notion.pages[0].id);
    }
  }, [targets, notionPage]);

  async function sendTo(to: "slack" | "notion") {
    setSending(to);
    setError(null);
    setSent(null);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/share/${to}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: to === "notion" ? JSON.stringify({ parentPageId: notionPage }) : undefined,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "送信に失敗しました");
      setSent({ to, url: json.data?.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setSending(null);
    }
  }

  const shareUrl =
    shareToken && typeof window !== "undefined"
      ? `${window.location.origin}/share/d/${shareToken}`
      : "";

  async function enableShare() {
    setShareBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/share`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "共有リンクの作成に失敗しました");
      setShareToken(json.data.shareToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "共有リンクの作成に失敗しました");
    } finally {
      setShareBusy(false);
    }
  }

  async function revokeShare() {
    const ok = await ask({
      title: "共有リンクを停止しますか？",
      body: "すでに配ってあるリンクは、停止した時点で開けなくなります。リンクを渡した相手に通知は行きません。",
      keeps:
        "ダッシュボードと、その元になっているデータはそのまま残ります。あとから共有リンクを作り直すこともできます（URLは新しいものになります）。",
      confirmLabel: "リンクを停止",
      destructive: true,
    });
    if (!ok) return;
    setShareBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/share`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "停止に失敗しました");
      setShareToken(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "停止に失敗しました");
    } finally {
      setShareBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the field is selectable as a fallback */
    }
  }

  async function clearSamples() {
    const ok = await ask({
      title: "サンプルデータを削除しますか？",
      body: "最初から入っていた見本の行だけを、すべてのシートから削除します。元には戻せません。",
      keeps:
        "ご自身で入力・取り込みしたデータは1行も消えません。シートの項目（列）とダッシュボードの組み立ても、そのまま残ります。",
      confirmLabel: "サンプルデータを削除",
      destructive: true,
    });
    if (!ok) return;
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/clear-samples`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "削除に失敗しました");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setClearing(false);
    }
  }

  async function deleteDashboard() {
    const ok = await ask({
      title: "このダッシュボードを削除しますか？",
      body: "グラフの並び・絞り込み・配色といった組み立てが失われ、元には戻せません。共有リンクを配っている場合は、そのリンクも開けなくなります。",
      keeps:
        "元になっているスプレッドシートと、その中のデータは残ります。同じデータから、いつでも作り直せます。",
      confirmLabel: "ダッシュボードを削除",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "削除に失敗しました");
      router.push("/dashboards");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {/* 共有の吹き出しの中ではなく外側に置く。中に置くと、吹き出しが
          閉じた瞬間に問いかけごと消えてしまう。 */}
      {confirmDialog}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Button
            size="sm"
            variant={shareToken ? "outline" : "secondary"}
            onClick={() => setShareOpen((v) => !v)}
          >
            <NavIcon name="users" className="h-4 w-4" />
            {shareToken ? "共有中" : "共有"}
          </Button>
          {shareOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShareOpen(false)} aria-hidden />
              {/* 送り先が増えたぶん縦に伸びる。画面からはみ出す前に、
                  吹き出しの中でスクロールさせる。 */}
              <div className="absolute right-0 z-30 mt-2 max-h-[80vh] w-80 animate-fade-in overflow-y-auto rounded-md border border-ink-line bg-paper-raised p-4 text-left shadow-raised">
                <p className="text-sm font-semibold text-ink">読み取り専用リンクで共有</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  リンクを知っている人は、ログインなしでこのダッシュボードを閲覧できます（編集は不可）。
                </p>
                {shareToken ? (
                  <div className="mt-3 space-y-2">
                    <input
                      readOnly
                      value={shareUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="input-base h-8 text-xs"
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={copyLink} className="flex-1">
                        {copied ? "コピーしました" : "リンクをコピー"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={revokeShare} disabled={shareBusy} className="text-danger hover:bg-danger-soft">
                        停止
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" onClick={enableShare} disabled={shareBusy} className="mt-3 w-full">
                    {shareBusy ? "作成中…" : "共有リンクを作成"}
                  </Button>
                )}

                {/* ------------------------- Slack / Notion ------------------------- */}
                <div className="mt-4 space-y-3 border-t border-ink-line pt-3">
                  <p className="text-sm font-semibold text-ink">送って共有</p>
                  <p className="text-xs leading-relaxed text-ink-muted">
                    {/*
                      どのリンクが相手に届くのかを先に書く。共有リンクを作らずに
                      送ると、受け取った人はログイン画面に着く——それを
                      「リンクが壊れている」と受け取られるのがいちばん困る。
                    */}
                    {shareToken
                      ? "主要な数字と、ログイン不要の共有リンクを送ります。"
                      : "主要な数字と、社内メンバー向けのリンクを送ります。社外の人にも開いてほしいときは、先に共有リンクを作成してください。"}
                  </p>

                  {/* Slack */}
                  {targets?.slack.connected ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      onClick={() => void sendTo("slack")}
                      disabled={sending !== null}
                    >
                      {sending === "slack"
                        ? "送信中…"
                        : targets.slack.hint
                          ? `Slackに送る（${targets.slack.hint}）`
                          : "Slackに送る"}
                    </Button>
                  ) : (
                    <p className="text-xs text-ink-muted">
                      Slackは未接続です。
                      <Link href="/settings" className="ml-1 text-khaki-700 hover:underline">
                        設定で接続
                      </Link>
                    </p>
                  )}

                  {/* Notion */}
                  {targets?.notion.connected ? (
                    targets.notion.pages.length > 0 ? (
                      <div className="space-y-2">
                        {/* 作成先を選ばないと送れない。Notionの仕様上、ページは
                            必ず親を持つため。 */}
                        <select
                          aria-label="Notionの作成先ページ"
                          className="input-base h-8 w-full text-xs"
                          value={notionPage}
                          onChange={(e) => setNotionPage(e.target.value)}
                        >
                          <option value="">作成先のページを選ぶ…</option>
                          {targets.notion.pages.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.title}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="w-full"
                          onClick={() => void sendTo("notion")}
                          disabled={sending !== null || !notionPage}
                        >
                          {sending === "notion" ? "作成中…" : "Notionにページを作る"}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-ink-muted">
                        {targets.notion.error ??
                          "作成先にできるページがありません。Notion側で、インテグレーションにページを共有してください。"}
                      </p>
                    )
                  ) : (
                    <p className="text-xs text-ink-muted">
                      Notionは未接続です。
                      <Link href="/settings" className="ml-1 text-khaki-700 hover:underline">
                        設定で接続
                      </Link>
                    </p>
                  )}

                  {sent && (
                    <p className="text-xs text-success" role="status">
                      {sent.to === "slack" ? (
                        "Slackに送りました。"
                      ) : (
                        <>
                          Notionにページを作りました。
                          {sent.url && (
                            <a
                              href={sent.url}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-1 underline"
                            >
                              開く
                            </a>
                          )}
                        </>
                      )}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        {hasSampleData && (
          <Button
            size="sm"
            variant="secondary"
            onClick={clearSamples}
            disabled={clearing}
          >
            {clearing ? "削除中…" : "サンプルデータを削除"}
          </Button>
        )}
        {firstCollectionId && (
          <Link
            href={`/c/${firstCollectionId}`}
            className={buttonStyles({ variant: "secondary", size: "sm" })}
          >
            <NavIcon name="table" className="h-4 w-4" />
            スプレッドシートを開く
          </Link>
        )}
        <Link
          href={`/dashboards/build/${dashboardId}`}
          className={buttonStyles({ variant: "secondary", size: "sm" })}
        >
          <NavIcon name="settings" className="h-4 w-4" />
          編集
        </Link>
        <Button
          size="sm"
          variant="ghost"
          onClick={deleteDashboard}
          disabled={deleting}
          className="text-danger hover:bg-danger-soft"
        >
          {deleting ? "削除中…" : "削除"}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
