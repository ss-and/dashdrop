"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { NavIcon } from "@/components/app/icons";

/**
 * 作成済みレポートの一覧。
 *
 * 表示できるのは「実際に起きたこと」だけ。以前はここで
 * 「メールで送信しました（宛先 N 件）」と出していたが、メールを送る処理は
 * 製品のどこにも無く、SMTP を設定した環境ほど届いていないものを届いたと
 * 表示していた。届け先はアプリ内通知（＋印刷 / PDF）だけなので、そう書く。
 */

export interface ReportRow {
  id: string;
  dashboardName: string;
  frequency: string;
  enabled: boolean;
  lastSentAt: string | null;
  /** 次回の自動配信予定（ISO）。自動配信が動く環境でのみ意味を持つ。 */
  nextRunAt: string;
}

const FREQ_LABEL: Record<string, string> = {
  daily: "日次",
  weekly: "週次",
  monthly: "月次",
};

function formatDate(iso: string | null): string {
  if (!iso) return "まだ受け取っていません";
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(
    d.getHours(),
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function Row({
  report,
  autoDeliveryPossible,
}: {
  report: ReportRow;
  autoDeliveryPossible: boolean;
}) {
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
        throw new Error(json.error ?? "レポートを作成できませんでした");
      // API は通知を作れたときだけ成功を返す。だからここで初めて
      //「届きました」と言える。
      setToast("アプリ内通知に届きました（右上のベルから開けます）");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "レポートを作成できませんでした",
      );
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

  // バッジは「この環境で実際に何が起きるか」を表す。cron が無い環境で
  //「自動配信」と出すのは、押さない限り何も起きないのに動いていると
  // 思わせることになる。
  const badge = !report.enabled
    ? { tone: "neutral" as const, label: "停止中" }
    : autoDeliveryPossible
      ? { tone: "success" as const, label: "自動配信" }
      : { tone: "neutral" as const, label: "手動のみ" };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ink-line bg-paper-raised p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <NavIcon name="report" className="h-4 w-4 shrink-0 text-khaki-500" />
          <h3 className="truncate font-medium text-ink">
            {report.dashboardName}
          </h3>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          頻度: {FREQ_LABEL[report.frequency] ?? report.frequency} ・ 前回:{" "}
          {formatDate(report.lastSentAt)}
          {report.enabled && autoDeliveryPossible
            ? ` ・ 次回予定: ${formatDate(report.nextRunAt)} 以降`
            : ""}
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
          {sending ? "作成中…" : "今すぐ受け取る"}
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

export function ReportList({
  reports,
  autoDeliveryPossible,
}: {
  reports: ReportRow[];
  /** この環境で定期実行の受け口が有効か（未設定なら自動では配信されない）。 */
  autoDeliveryPossible: boolean;
}) {
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
        <Row
          key={r.id}
          report={r}
          autoDeliveryPossible={autoDeliveryPossible}
        />
      ))}
    </div>
  );
}
