"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import type { IntegrationSummary, IntegrationStatus } from "@/lib/integrations";

/** "2026/08/19 14:05" — the format used across the app's timestamps. */
function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * config に控えた通知先チャンネル名を読む。
 *
 * `@/lib/integrations` の readChannelHint と同じ判定だが、あちらを import すると
 * Prisma クライアントごとブラウザのバンドルに入ってしまうため、ここでは型だけを
 * 借りて読み出しは手元に置く。
 */
function channelHintOf(summary: IntegrationSummary | null): string | null {
  const value = summary?.config?.channelHint;
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s.length > 0 ? s : null;
}

/** サーバから来た summary から、画面が分岐する4状態を取り出す。 */
function statusOf(summary: IntegrationSummary | null): IntegrationStatus {
  if (!summary) return "disconnected";
  if (summary.status) return summary.status;
  return summary.connected ? "connected" : "disconnected";
}

/**
 * 復号できない／無効化されている場合の説明。どちらも「接続済みに見えるのに
 * 届かない」状態なので、原因と次にやることを日本語で言い切る。
 */
const BLOCKED_REASON: Partial<Record<IntegrationStatus, string>> = {
  unreadable:
    "保存済みの Webhook URL を読み取れなくなったため、Slackへの通知を停止しています。サーバーの暗号鍵が入れ替わったときに起こります。下の手順で Webhook URL をもう一度貼り付けると、通知を再開できます。",
  disabled:
    "この連携は無効になっているため、Slackへは通知されません。下の手順で Webhook URL をもう一度貼り付けると、通知を再開できます。",
};

/** 実行中の操作。同時に走らせない（走らせると結果が捨てられる）ので1つだけ持つ。 */
type Pending = "connect" | "test" | "remove" | null;

/**
 * Slack connection card. The webhook URL is a live credential, so it is typed
 * into a password field, sent once, and only ever displayed masked afterwards.
 */
export function SlackCard({ initial }: { initial: IntegrationSummary | null }) {
  const [summary, setSummary] = useState<IntegrationSummary | null>(initial);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [channelHint, setChannelHint] = useState(channelHintOf(initial) ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const status = statusOf(summary);
  const connected = status === "connected";
  // 送信中はどの操作も受け付けない。テスト送信の最中に解除できると、
  // 消えた Webhook に投げたテストの結果だけが宙に浮く。
  const busy = pending !== null;
  const showForm = !connected || editing;
  const savedHint = channelHintOf(summary);

  // 直近の操作エラーとサーバが記録した lastError は同じ文言になることが多い
  // （テスト送信の失敗は両方に入る）ので、出すのは新しい方だけにする。
  const problem =
    error ?? (summary?.lastError ? `前回のエラー: ${summary.lastError}` : null);

  /** 操作の前に、前回の結果表示を片付ける。 */
  function begin(next: Exclude<Pending, null>): void {
    setPending(next);
    setError(null);
    setNotice(null);
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const url = webhookUrl.trim();
    if (!url) {
      setNotice(null);
      setError("Webhook URL を貼り付けてください。");
      return;
    }
    begin("connect");
    try {
      const res = await fetch("/api/integrations/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: url, channelHint }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        data?: IntegrationSummary;
      } | null;
      if (!res.ok || !json?.ok || !json.data) {
        // 保存されなかったときは入力をそのまま残す。貼り直しの手間を
        // もう一度かけさせない。
        setError(json?.error ?? "接続に失敗しました。");
        return;
      }
      setSummary(json.data);
      setWebhookUrl("");
      setChannelHint(channelHintOf(json.data) ?? "");
      setEditing(false);
      setNotice(
        "Slackに接続しました。確認のテストメッセージを1件送信済みです。チャンネルに届いているかご確認ください。",
      );
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setPending(null);
    }
  }

  async function sendTest() {
    if (busy) return;
    begin("test");
    try {
      const res = await fetch("/api/integrations/slack/test", {
        method: "POST",
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        data?: { sentAt?: string };
      } | null;
      if (!res.ok || !json?.ok) {
        // Slack が受け取りを断った場合だけ、サーバも同じ理由を記録している。
        // 認証切れ(401)やこちら側の不具合(400/500)まで「前回のエラー」として
        // 画面に書き込むと、サーバが記録していない文言（"Not authenticated"）を
        // 連携のエラーとして見せることになり、再読み込みで消える幽霊になる。
        const rejectedBySlack = res.status === 502;
        const message =
          rejectedBySlack && json?.error
            ? json.error
            : res.status === 401
              ? "ログインの有効期限が切れています。画面を再読み込みしてください。"
              : (json?.error ?? "テスト送信に失敗しました。");
        setError(message);
        if (rejectedBySlack) {
          setSummary((s) => (s ? { ...s, lastError: message } : s));
        }
        return;
      }
      const sentAt = json.data?.sentAt ?? new Date().toISOString();
      setSummary((s) => (s ? { ...s, lastOkAt: sentAt, lastError: null } : s));
      setNotice("テストメッセージを送信しました。Slackのチャンネルをご確認ください。");
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setPending(null);
    }
  }

  async function disconnect() {
    if (busy) return;
    if (
      !window.confirm(
        "Slack連携を解除します。以降、アラートはSlackに通知されません（アプリ内の通知は続きます）。よろしいですか？",
      )
    ) {
      return;
    }
    begin("remove");
    try {
      const res = await fetch("/api/integrations/slack", { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "解除に失敗しました。");
        return;
      }
      setSummary(null);
      setEditing(false);
      setWebhookUrl("");
      setChannelHint("");
      setNotice("Slack連携を解除しました。");
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setPending(null);
    }
  }

  function cancelEdit() {
    setEditing(false);
    setWebhookUrl("");
    setChannelHint(savedHint ?? "");
    setError(null);
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Slack連携</CardTitle>
        <Badge tone={connected ? "success" : "neutral"} variant="soft">
          {connected ? "接続済み" : "未接続"}
        </Badge>
      </CardHeader>

      <CardBody className="space-y-4">
        {/*
          読み上げソフトは「あとから現れた要素」の中身を読み落とすことがある。
          エラーと結果の入れ物は中身が空でも常に置いておき、文字だけを差し替える。
          入力欄の aria-describedby もこの id を指す。
        */}
        <div id="slack-error" role="alert" aria-live="assertive">
          {problem && (
            <p className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {problem}
            </p>
          )}
        </div>
        <div role="status" aria-live="polite">
          {notice && (
            <p className="rounded border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
              {notice}
            </p>
          )}
        </div>

        <p className="text-sm leading-relaxed text-ink-muted">
          アラートの通知先としてSlackを使えます。通知先を「Slack」にしたアラートが条件を満たしたとき、下のWebhookのチャンネルにメッセージが届きます。アプリ内の通知（右上のベル）は設定に関わらず必ず届き、Slackはそれに追加して送られます。レポートはSlackには送信されません。
        </p>

        {connected && (
          <>
            <div className="rounded border border-ink-line bg-paper-sunken px-4 py-3">
              <dl className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-ink-muted">Webhook URL</dt>
                  <dd className="font-mono text-sm text-ink">
                    {summary?.masked ?? "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-ink-muted">通知先チャンネル</dt>
                  <dd className="text-sm text-ink">
                    {savedHint ?? "未記入"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-ink-muted">最終送信</dt>
                  <dd className="text-sm text-ink">
                    {formatDateTime(summary?.lastOkAt ?? null)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void sendTest()}
                disabled={busy}
              >
                {pending === "test" ? "送信中…" : "テスト送信"}
              </Button>
              {/* 変更中はフォーム側の「キャンセル」が戻り道になるので出さない。 */}
              {!editing && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(true);
                    setError(null);
                    setNotice(null);
                    setWebhookUrl("");
                  }}
                  disabled={busy}
                >
                  Webhook を変更
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void disconnect()}
                disabled={busy}
                className="text-danger hover:bg-danger-soft"
              >
                {pending === "remove" ? "解除中…" : "解除"}
              </Button>
            </div>
          </>
        )}

        {!connected && BLOCKED_REASON[status] && (
          <div className="space-y-2 rounded border border-warning/30 bg-warning-soft px-3 py-2">
            <p className="text-sm text-warning">{BLOCKED_REASON[status]}</p>
            {/* 使えない行を消す唯一の出口。これが無いと詰む。 */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void disconnect()}
              disabled={busy}
              className="text-danger hover:bg-danger-soft"
            >
              {pending === "remove" ? "解除中…" : "この接続を削除する"}
            </Button>
          </div>
        )}

        {showForm && (
          <form onSubmit={connect} className="space-y-3">
            <div className="space-y-2 rounded border border-ink-line bg-paper-sunken px-4 py-3">
              <p className="text-sm font-medium text-ink">
                Webhook URL の取得手順
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-ink-muted">
                <li>
                  Slackの{" "}
                  <a
                    href="https://api.slack.com/apps"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-khaki-700 underline underline-offset-2 hover:text-khaki-800"
                  >
                    アプリ管理ページ
                  </a>
                  を開き、「Create New App」→「From scratch」でアプリを作成します（名前は「DashDrop」など任意、通知したいSlackワークスペースを選びます）。
                </li>
                <li>
                  左メニューの「Incoming Webhooks」を開き、スイッチを「On」にします。
                </li>
                <li>
                  同じ画面の下にある「Add New Webhook to Workspace」を押し、通知先のチャンネルを選んで「許可する」を押します。
                </li>
                <li>
                  発行された「https://hooks.slack.com/services/…」をコピーし、下の欄に貼り付けます。
                </li>
              </ol>
              <p className="text-xs leading-relaxed text-ink-muted">
                接続時に確認のテストメッセージを1件送信します。届かないURLは保存しません。
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="slack-webhook-url">Webhook URL</Label>
              <Input
                id="slack-webhook-url"
                type="password"
                autoComplete="off"
                placeholder="https://hooks.slack.com/services/..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                // 送信中に入力できると、返ってきた結果で入力欄が書き換わり、
                // その間に打った文字が消える。
                disabled={busy}
                aria-invalid={problem ? true : undefined}
                aria-describedby="slack-error slack-webhook-help"
              />
              <p id="slack-webhook-help" className="text-xs text-ink-muted">
                貼り付けたURLは暗号化して保存し、画面には先頭と末尾だけを表示します。
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="slack-channel-hint">
                通知先チャンネル名（任意）
              </Label>
              <Input
                id="slack-channel-hint"
                type="text"
                autoComplete="off"
                placeholder="#売上アラート"
                value={channelHint}
                onChange={(e) => setChannelHint(e.target.value)}
                disabled={busy}
                maxLength={60}
                aria-describedby="slack-channel-hint-help"
              />
              <p id="slack-channel-hint-help" className="text-xs text-ink-muted">
                手順3で選んだチャンネル名を控えておくと、どのチャンネルに届く設定なのかを後から確認できます。通知先そのものはWebhook URLが決めます。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={busy || webhookUrl.trim().length === 0}
              >
                {pending === "connect"
                  ? "確認中…"
                  : connected
                    ? "変更して接続"
                    : "接続"}
              </Button>
              {editing && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={cancelEdit}
                  disabled={busy}
                >
                  キャンセル
                </Button>
              )}
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
