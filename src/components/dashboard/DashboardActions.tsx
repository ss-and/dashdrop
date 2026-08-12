"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/Button";
import { NavIcon } from "@/components/app/icons";

/**
 * Action row for a rendered dashboard: clear seeded sample data, jump to the
 * underlying table, or delete the dashboard. Destructive actions confirm first.
 */
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
  const [clearing, setClearing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [shareToken, setShareToken] = useState<string | null>(initialShareToken ?? null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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
    if (!confirm("共有リンクを停止します。現在のリンクは無効になります。よろしいですか？")) return;
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
    if (
      !confirm(
        "サンプルデータをすべて削除します。実際に入力したデータは残ります。よろしいですか？",
      )
    )
      return;
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
    if (
      !confirm(
        "このダッシュボードを削除します。スプレッドシートとデータは残ります。よろしいですか？",
      )
    )
      return;
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
              <div className="absolute right-0 z-30 mt-2 w-80 animate-fade-in rounded-md border border-ink-line bg-paper-raised p-4 text-left shadow-raised">
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
