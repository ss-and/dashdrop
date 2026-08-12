"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { NavIcon } from "@/components/app/icons";

export interface ReportRow {
  id: string;
  dashboardName: string;
  frequency: string;
  recipients: string[];
  enabled: boolean;
  lastSentAt: string | null;
}

const FREQ_LABEL: Record<string, string> = {
  daily: "日次",
  weekly: "週次",
  monthly: "月次",
};

function formatDate(iso: string | null): string {
  if (!iso) return "未送信";
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(
    d.getHours(),
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function Row({ report }: { report: ReportRow }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendNow() {
    setSending(true);
    setError(null);
    setToast(null);
    try {
      const res = await fetch(`/api/reports/${report.id}/send`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.ok)
        throw new Error(json.error ?? "送信に失敗しました");
      const { channel, recipients } = json.data as {
        channel: "email" | "inapp";
        recipients: number;
      };
      setToast(
        channel === "email"
          ? `メールで送信しました（宛先 ${recipients} 件）`
          : "アプリ内通知で送信しました",
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setSending(false);
    }
  }

  async function remove() {
    if (!confirm("このレポートを削除します。よろしいですか？")) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${report.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok)
        throw new Error(json.error ?? "削除に失敗しました");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ink-line bg-paper-raised p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <NavIcon name="report" className="h-4 w-4 shrink-0 text-khaki-500" />
          <h3 className="truncate font-medium text-ink">
            {report.dashboardName}
          </h3>
          {report.enabled ? (
            <Badge tone="success">有効</Badge>
          ) : (
            <Badge tone="neutral">停止中</Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          頻度: {FREQ_LABEL[report.frequency] ?? report.frequency} ・ 宛先{" "}
          {report.recipients.length} 件 ・ 最終送信: {formatDate(report.lastSentAt)}
        </p>
        {toast && (
          <p className="mt-1 text-xs text-success" role="status">
            {toast}
          </p>
        )}
        {error && (
          <p className="mt-1 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={sendNow} disabled={sending}>
          {sending ? "送信中…" : "今すぐ送信"}
        </Button>
        <Link
          href={`/reports/print/${report.id}`}
          className={buttonStyles({ variant: "secondary", size: "sm" })}
        >
          <NavIcon name="download" className="h-4 w-4" />
          印刷 / PDF
        </Link>
        <Button
          size="sm"
          variant="ghost"
          onClick={remove}
          disabled={deleting}
          className="text-danger hover:bg-danger-soft"
        >
          {deleting ? "削除中…" : "削除"}
        </Button>
      </div>
    </div>
  );
}

export function ReportList({ reports }: { reports: ReportRow[] }) {
  if (reports.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-ink-line px-4 py-8 text-center text-sm text-ink-muted">
        まだレポートがありません。下のフォームから作成してください。
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {reports.map((r) => (
        <Row key={r.id} report={r} />
      ))}
    </div>
  );
}
