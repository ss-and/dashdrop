"use client";

/**
 * Notion connection card for the settings page.
 *
 * The token is write-only: it is posted once, sealed server-side, and only ever
 * comes back as a mask. The card also carries the single most important piece of
 * setup guidance — a Notion integration sees *nothing* until the database page
 * is shared with it — because that is what almost every failed import turns out
 * to be.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Summary {
  connected: boolean;
  masked: string | null;
  lastOkAt: string | null;
  lastError: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * `initial` lets the settings page hand over the masked summary it already read
 * on the server (like the Slack card does). Omit it and the card fetches its own
 * status — so it can be dropped anywhere with `<NotionCard />`.
 */
export function NotionCard({ initial }: { initial?: Summary | null }) {
  const { ask, confirmDialog } = useConfirm();
  const [summary, setSummary] = useState<Summary | null>(initial ?? null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(initial === undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    // The server already provided the summary; no need to ask again.
    if (initial !== undefined) return;
    try {
      const res = await fetch("/api/integrations/notion");
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) setSummary(body.data.integration as Summary);
    } catch {
      // A failed status read is not worth an error banner; the card just shows
      // the disconnected state and the user can try connecting.
    } finally {
      setLoading(false);
    }
  }, [initial]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    const value = token.trim();
    if (!value) {
      setError("Notionのインテグレーション トークンを貼り付けてください。");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/notion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: value }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "Notionの接続に失敗しました。");
        return;
      }
      setSummary(body.data.integration as Summary);
      setToken("");
      setNotice("Notionを接続しました。取り込み画面からデータベースを選べます。");
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await ask({
      title: "Notionとの接続を解除しますか？",
      body: "保存してあるインテグレーショントークンを削除します。取り込み画面でNotionのデータベースを選べなくなり、ダッシュボードをNotionへ送ることもできなくなります。",
      keeps:
        "すでに取り込み済みのデータと、Notion側のページはどちらも消えません。新しいトークンを入れ直せば、また接続できます。",
      confirmLabel: "接続を解除",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/notion", { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "接続の解除に失敗しました。");
        return;
      }
      setSummary(body.data.integration as Summary);
      setNotice("Notionとの接続を解除しました。");
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  const connected = summary?.connected === true;

  return (
    <Card>
      {confirmDialog}
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Notion連携</CardTitle>
        {!loading && (
          <Badge tone={connected ? "success" : "neutral"} variant="soft">
            {connected ? "接続済み" : "未接続"}
          </Badge>
        )}
      </CardHeader>

      <CardBody className="space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {error}
          </div>
        )}
        {notice && (
          <p className="rounded border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
            {notice}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-ink-muted">読み込み中…</p>
        ) : connected ? (
          <>
            <div className="flex flex-col gap-1 border-b border-ink-line py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-ink-muted">トークン</span>
              <span className="font-mono text-sm font-medium text-ink">
                {summary?.masked ?? "—"}
              </span>
            </div>
            <div className="flex flex-col gap-1 border-b border-ink-line py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-ink-muted">最終利用</span>
              <span className="text-sm font-medium text-ink">
                {formatDate(summary?.lastOkAt ?? null)}
              </span>
            </div>
            {summary?.lastError && (
              <p className="rounded border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                前回のエラー: {summary.lastError}
              </p>
            )}
            <p className="text-sm text-ink-muted">
              取り込み画面の「Notionから取り込み」で、共有済みのデータベースをスプレッドシートとして取り込めます。
            </p>
            <div className="flex justify-end">
              <Button variant="danger" size="sm" onClick={() => void disconnect()} disabled={busy}>
                {busy ? "処理中…" : "解除"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Notionのデータベースをスプレッドシートとして取り込めます。Notionで内部インテグレーションを作成し、発行されたトークン（secret_ または ntn_ で始まる文字列）を貼り付けてください。
            </p>
            <p className="text-sm">
              <a
                href="https://www.notion.so/my-integrations"
                target="_blank"
                rel="noopener noreferrer"
                className="text-khaki-700 underline underline-offset-2 hover:text-khaki-800"
              >
                Notionのインテグレーション設定を開く
              </a>
            </p>
            <div className="max-w-md">
              <Label htmlFor="notion-token">インテグレーション トークン</Label>
              <Input
                id="notion-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void connect();
                  }
                }}
                placeholder="ntn_…"
                disabled={busy}
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => void connect()} disabled={busy || !token.trim()}>
                {busy ? "接続中…" : "接続"}
              </Button>
            </div>
          </>
        )}

        <p className="rounded border border-ink-line bg-paper-sunken px-3 py-2 text-xs text-ink-muted">
          取り込みたいデータベースのページをNotionで開き、右上「…」→「接続」からこのインテグレーションを追加してください。共有していないページはトークンからは見えず、一覧にも表示されません。
        </p>
      </CardBody>
    </Card>
  );
}
