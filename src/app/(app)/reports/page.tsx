/**
 * Scheduled reports — schedule recurring (daily/weekly/monthly) snapshots of a
 * dashboard, sent by in-app notification (and email when SMTP is configured).
 * From here you can send a report now or open its printable / PDF view.
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
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

  const reports: ReportRow[] = schedules.map((s) => ({
    id: s.id,
    dashboardName: nameById.get(s.dashboardId) ?? "(削除されたダッシュボード)",
    frequency: s.frequency,
    recipients: Array.isArray(s.recipients)
      ? (s.recipients as unknown[]).filter((r): r is string => typeof r === "string")
      : [],
    enabled: s.enabled,
    lastSentAt: s.lastSentAt ? s.lastSentAt.toISOString() : null,
  }));

  return (
    <>
      <Topbar user={user} title="レポート" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-ink">定期レポート</h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              ダッシュボードのスナップショットを日次・週次・月次で受け取れます。
            </p>
          </div>

          <ReportList reports={reports} />

          <Card>
            <CardHeader>
              <CardTitle>レポートを作成</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <ReportForm dashboards={dashboards} />
              <p className="text-xs leading-relaxed text-ink-muted">
                メール送信は SMTP 設定時に有効。未設定でもアプリ内通知＋印刷リンクで受け取れます。
              </p>
            </CardBody>
          </Card>
        </div>
      </main>
    </>
  );
}
