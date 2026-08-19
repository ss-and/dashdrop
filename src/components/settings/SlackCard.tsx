"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import type { IntegrationSummary } from "@/lib/integrations";

/** "2026/08/19 14:05" — the format used across the app's timestamps. */
function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const WEBHOOK_DOCS = "https://api.slack.com/messaging/webhooks";

/**
 * Slack connection card. The webhook URL is a live credential, so it is typed
 * into a password field, sent once, and only ever displayed masked afterwards.
 */
export function SlackCard({ initial }: { initial: IntegrationSummary | null }) {
  const [summary, setSummary] = useState<IntegrationSummary | null>(initial);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    { ok: boolean; message: string } | null
  >(null);

  const connected = Boolean(summary?.connected);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/integrations/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "接続に失敗しました");
      setSummary(json.data as IntegrationSummary);
      setWebhookUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "接続に失敗しました");
    } finally {
      setConnecting(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/integrations/slack/test", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "テスト送信に失敗しました");
      const data = json.data as { ok: boolean; error?: string };
      setTestResult(
        data.ok
          ? { ok: true, message: "テストメッセージを送信しました。" }
          : { ok: false, message: data.error ?? "テスト送信に失敗しました" },
      );
      if (data.ok) {
        setSummary((s) =>
          s ? { ...s, lastOkAt: new Date().toISOString(), lastError: null } : s,
        );
      } else {
        setSummary((s) => (s ? { ...s, lastError: data.error ?? null } : s));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "テスト送信に失敗しました");
    } finally {
      setTesting(false);
    }
  }

  async function disconnect() {
    if (
      !confirm(
        "Slack連携を解除します。以降、アラートやレポートはSlackに通知されません。よろしいですか？",
      )
    )
      return;
    setRemoving(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/integrations/slack", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "解除に失敗しました");
      setSummary(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "解除に失敗しました");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>Slack</CardTitle>
        <span
          className={
            connected
              ? "text-xs font-medium text-khaki-700"
              : "text-xs font-medium text-ink-muted"
          }
        >
          {connected ? "接続済み" : "未接続"}
        </span>
      </CardHeader>

      <CardBody className="space-y-3">
        <p className="text-sm leading-relaxed text-ink-muted">
          アラートやレポートをSlackに通知します。
        </p>

        {connected ? (
          <>
            <dl className="space-y-2 rounded border border-ink-line bg-paper-sunken px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-sm text-ink-muted">Webhook URL</dt>
                <dd className="font-mono text-sm text-ink">{summary?.masked}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-sm text-ink-muted">最終送信</dt>
                <dd className="text-sm text-ink">
                  {formatDateTime(summary?.lastOkAt ?? null)}
                </dd>
              </div>
            </dl>

            {summary?.lastError && (
              <p className="text-sm text-danger" role="alert">
                直近のエラー: {summary.lastError}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={sendTest}
                disabled={testing}
              >
                {testing ? "送信中…" : "テスト送信"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={disconnect}
                disabled={removing}
                className="text-danger hover:bg-danger-soft"
              >
                {removing ? "解除中…" : "解除"}
              </Button>
            </div>

            {testResult && (
              <p
                className={
                  testResult.ok
                    ? "text-sm text-khaki-700"
                    : "text-sm text-danger"
                }
                role="status"
              >
                {testResult.message}
              </p>
            )}
          </>
        ) : (
          <form onSubmit={connect} className="space-y-3">
            <p className="text-sm leading-relaxed text-ink-muted">
              Slackの{" "}
              <a
                href={WEBHOOK_DOCS}
                target="_blank"
                rel="noopener noreferrer"
                className="text-khaki-700 underline underline-offset-2 hover:text-khaki-800"
              >
                Incoming Webhooks
              </a>{" "}
              で通知先チャンネルのWebhook URLを作成し、貼り付けてください。
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="slack-webhook-url">Webhook URL</Label>
              <Input
                id="slack-webhook-url"
                type="password"
                autoComplete="off"
                placeholder="https://hooks.slack.com/services/..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={connecting || webhookUrl.trim().length === 0}
            >
              {connecting ? "接続中…" : "接続"}
            </Button>
          </form>
        )}

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
