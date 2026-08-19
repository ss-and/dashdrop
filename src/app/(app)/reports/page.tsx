/**
 * 定期レポート — ダッシュボードのスナップショットを受け取る画面。
 *
 * 配信手段はアプリ内通知（＋通知から開ける印刷 / PDF ページ）だけ。メールは
 * 送らない。以前はここに「メール送信は SMTP 設定時に有効」と書いてあったが、
 * 送信処理はどこにも実装されておらず、SMTP を設定すると「メールで送信しました」
 * と嘘を表示するだけだった。
 *
 * 自動配信は外部のスケジューラが `/api/reports/dispatch` を叩いたときに動く。
 * `CRON_SECRET` が未設定ならそのエンドポイントは必ず断るので、自動配信は
 * 確実に動かない。その場合は「動きません」と言い切る（黙って動くふりをしない）。
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { cronSecret } from "@/lib/cron";
import { scheduledNextRun } from "@/app/api/reports/schedule";
import { Topbar } from "@/components/app/Topbar";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import { ReportForm } from "@/components/reports/ReportForm";
import { ReportList, type ReportRow } from "@/components/reports/ReportList";

export default async function ReportsPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  const workspaceId = user.workspace.id;

  const [dashboards, schedules] = await Promise.all([
    db.dashboard.findMany({
      where: { workspaceId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    }),
    db.reportSchedule.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const nameById = new Map(dashboards.map((d) => [d.id, d.name]));

  // 自動配信の受け口が有効かどうか。共有シークレットが無ければ
  // `/api/reports/dispatch` は 503 を返すので、自動では一度も配信されない。
  const autoDeliveryPossible = (cronSecret() ?? "").trim().length > 0;

  const reports: ReportRow[] = schedules.map((s) => ({
    id: s.id,
    dashboardName: nameById.get(s.dashboardId) ?? "(削除されたダッシュボード)",
    frequency: s.frequency,
    enabled: s.enabled,
    lastSentAt: s.lastSentAt ? s.lastSentAt.toISOString() : null,
    nextRunAt: scheduledNextRun(s).toISOString(),
  }));

  return (
    <>
      <Topbar user={user} title="レポート" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-ink">定期レポート</h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              ダッシュボードのスナップショットを、アプリ内通知でお届けします。
              通知を開くとそのまま印刷・PDF 保存ができます。
            </p>
          </div>

          <ReportList
            reports={reports}
            autoDeliveryPossible={autoDeliveryPossible}
          />

          <Card>
            <CardHeader>
              <CardTitle>レポートを作成</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <ReportForm dashboards={dashboards} />
              <div className="space-y-1 text-xs leading-relaxed text-ink-muted">
                <p>
                  {autoDeliveryPossible
                    ? "自動配信は、定期実行（cron）が /api/reports/dispatch を呼び出したときに動きます。呼び出しが設定されていない環境では「今すぐ受け取る」だけが動きます。"
                    : "この環境では自動配信は動きません（CRON_SECRET が未設定のため、定期実行の受け口が無効です）。「今すぐ受け取る」でいつでも受け取れます。"}
                </p>
                <p>
                  メールでの配信には対応していません。受け取り方はアプリ内通知と、
                  そこから開く印刷 / PDF ページです。
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      </main>
    </>
  );
}
