import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWeeklyMetrics } from "@/lib/metrics";
import { Topbar } from "@/components/app/Topbar";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import { NavIcon } from "@/components/app/icons";
import { StatTile } from "@/components/dashboard/StatTile";
import {
  RecentActivity,
  type RecentActivityItem,
} from "@/components/dashboard/RecentActivity";
import { WeeklyChart } from "@/components/charts/WeeklyChart";
import { TaskDonut } from "@/components/charts/TaskDonut";

/** Best-effort human name for a record, based on its collection template. */
function recordPrimary(
  data: unknown,
  template: string,
): string {
  const d = (data ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = d[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };
  if (template === "inquiry") {
    return pick("customer", "subject", "email") ?? "（無題）";
  }
  if (template === "task") {
    return pick("title", "assignee") ?? "（無題）";
  }
  // Custom collection: first non-empty string value.
  const first = Object.values(d).find(
    (v) => typeof v === "string" && v.trim(),
  );
  return typeof first === "string" ? first.trim() : "（無題）";
}

export default async function DashboardPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  const workspaceId = user.workspace.id;
  const [metrics, recentRecords] = await Promise.all([
    getWeeklyMetrics(workspaceId),
    db.record.findMany({
      where: { collection: { workspaceId } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        data: true,
        createdAt: true,
        collection: {
          select: { name: true, icon: true, template: true },
        },
      },
    }),
  ]);

  const recentItems: RecentActivityItem[] = recentRecords.map((r) => ({
    id: r.id,
    template: r.collection.template,
    icon: r.collection.icon,
    collectionName: r.collection.name,
    primary: recordPrimary(r.data, r.collection.template),
    createdAt: r.createdAt.toISOString(),
  }));

  const { totals } = metrics;
  const isEmpty = metrics.totalRecords === 0;

  return (
    <>
      <Topbar user={user} title="ダッシュボード" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          {isEmpty ? (
            <Card className="animate-fade-in">
              <CardBody className="flex flex-col items-center gap-4 px-6 py-14 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-khaki-100 text-khaki-700">
                  <NavIcon name="sparkles" className="h-7 w-7" />
                </span>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-ink">
                    ようこそ、DashDrop へ
                  </h2>
                  <p className="max-w-md text-sm text-ink-muted">
                    まだデータがありません。Excel を取り込むか、テーブルを追加すると、
                    週間パフォーマンスの推移がここに表示されます。
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-3">
                  <Link
                    href="/import"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded border border-transparent bg-khaki-500 px-4 text-sm font-medium text-white shadow-card transition-colors hover:bg-khaki-600"
                  >
                    <NavIcon name="upload" className="h-4 w-4" />
                    Excel を取り込む
                  </Link>
                  <Link
                    href="/c/new"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded border border-khaki-300 px-4 text-sm font-medium text-khaki-700 transition-colors hover:bg-khaki-50"
                  >
                    <NavIcon name="plus" className="h-4 w-4" />
                    テーブルを追加
                  </Link>
                </div>
              </CardBody>
            </Card>
          ) : (
            <>
              {/* KPI row */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatTile
                  label="今週の新規問い合わせ"
                  value={totals.newInquiries.value}
                  delta={totals.newInquiries.deltaPercent}
                  deltaLabel="前週比"
                />
                <StatTile
                  label="対応済み"
                  value={totals.resolvedInquiries.value}
                  delta={totals.resolvedInquiries.deltaPercent}
                  deltaLabel="前週比"
                />
                <StatTile
                  label="未対応"
                  value={metrics.openInquiries}
                  deltaLabel="現在の未対応件数"
                />
                <StatTile
                  label="タスク完了"
                  value={totals.tasksCompleted.value}
                  delta={totals.tasksCompleted.deltaPercent}
                  deltaLabel="前週比"
                />
              </div>

              {/* Weekly performance chart */}
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <CardTitle>週間パフォーマンス</CardTitle>
                  <span className="text-xs text-ink-faint">直近7日間</span>
                </CardHeader>
                <CardBody>
                  <WeeklyChart data={metrics.series} />
                </CardBody>
              </Card>

              {/* Task donut + recent activity */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                  <CardHeader>
                    <CardTitle>タスクの状況</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <TaskDonut data={metrics.taskBreakdown} />
                  </CardBody>
                </Card>

                <Card className="lg:col-span-2">
                  <CardHeader className="flex items-center justify-between">
                    <CardTitle>最近の追加</CardTitle>
                    <span className="text-xs text-ink-faint">
                      問い合わせ解決率 {metrics.resolutionRate}%
                    </span>
                  </CardHeader>
                  <RecentActivity items={recentItems} />
                </Card>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
