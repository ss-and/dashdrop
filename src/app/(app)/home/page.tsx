/**
 * ホーム — the workspace's front door.
 *
 * Three layers, top to bottom:
 *   1. a KPI band summarising the customer database (顧客数 / 商談金額 …),
 *   2. a tab strip: 「サマリー」 plus every saved dashboard, driven by the URL
 *      (`/home?tab=<dashboardId>`) so tabs are shareable and only the selected
 *      dashboard is computed,
 *   3. the サマリー body — a Salesforce-style list view per CRM object with
 *      hyperlinked rows — and the imported files strip.
 *
 * Server component: everything is loaded with workspace-scoped Prisma queries.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { CRM_OBJECTS, type CrmObject } from "@/lib/crm-objects";
import {
  resolveCollectionRecords,
  type EngineCollection,
} from "@/lib/relations";
import { loadDashboardCollections } from "@/lib/apply-template";
import { computeDashboard } from "@/lib/aggregate";
import type { WidgetSpec } from "@/lib/widgets";
import type { SelectOption } from "@/lib/field-types";
import { Topbar } from "@/components/app/Topbar";
import { NavIcon } from "@/components/app/icons";
import { HelpTip } from "@/components/ui/HelpTip";
import { Card, CardBody } from "@/components/ui/Card";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { HomeTabs } from "@/components/home/HomeTabs";
import { SummaryBand, type SummaryTile } from "@/components/home/SummaryBand";
import {
  CrmSection,
  type CrmColumn,
  type CrmObjectView,
} from "@/components/home/CrmSection";
import { FilesStrip } from "@/components/home/FilesStrip";
import { SetupCrmButton } from "@/components/home/SetupCrmButton";

const LIST_ROWS = 5;

function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s¥]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

/** The field key that labels a record of this object (its 主キー). */
function primaryKeyOf(obj: CrmObject): string {
  return (obj.fields.find((f) => f.required) ?? obj.fields[0]).key;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const { tab } = await searchParams;
  const workspaceId = user.workspace.id;

  /* ------------------------------ base loading ----------------------------- */

  const [crmCollections, dashboards, workbooks] = await Promise.all([
    db.collection.findMany({
      where: { workspaceId, slug: { in: CRM_OBJECTS.map((o) => o.slug) } },
      include: {
        fields: { orderBy: { position: "asc" } },
        _count: { select: { records: true } },
      },
    }),
    db.dashboard.findMany({
      where: { workspaceId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, icon: true },
    }),
    db.workbook.findMany({
      where: { workspaceId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        _count: { select: { collections: true } },
      },
    }),
  ]);

  type CrmCollection = (typeof crmCollections)[number];
  const bySlug = new Map<string, CrmCollection>(
    crmCollections.map((c) => [c.slug, c]),
  );
  const hasCrm = crmCollections.length > 0;

  const accounts = bySlug.get("accounts");
  const contacts = bySlug.get("contacts");
  const opportunities = bySlug.get("opportunities");
  const activities = bySlug.get("activities");

  /* --------------------------------- KPIs ---------------------------------- */

  // 商談金額はレコードの JSON に入っているため、行を読んでアプリ側で集計する。
  const oppRecords = opportunities
    ? await db.record.findMany({
        where: { collectionId: opportunities.id },
        select: { data: true },
      })
    : [];

  let openAmount = 0;
  let wonAmount = 0;
  let openCount = 0;
  for (const r of oppRecords) {
    const d = (r.data as Record<string, unknown>) ?? {};
    const amount = toNumber(d.amount);
    const stage = typeof d.stage === "string" ? d.stage : "";
    if (stage === "won") {
      wonAmount += amount;
    } else if (stage !== "lost") {
      openAmount += amount;
      openCount += 1;
    }
  }

  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const activityRecords = activities
    ? await db.record.findMany({
        where: { collectionId: activities.id },
        select: { data: true, createdAt: true },
      })
    : [];
  const activitiesThisMonth = activityRecords.filter((r) => {
    const d = (r.data as Record<string, unknown>) ?? {};
    const date = d.date;
    if (typeof date === "string" && date) return date.startsWith(monthPrefix);
    return r.createdAt >= monthStart && r.createdAt < nextMonthStart;
  }).length;

  const tiles: SummaryTile[] = [];
  if (accounts) {
    tiles.push({
      key: "accounts",
      label: "顧客数",
      value: accounts._count.records.toLocaleString(),
      href: `/c/${accounts.id}`,
    });
  }
  if (opportunities) {
    tiles.push({
      key: "opportunities",
      label: "商談数",
      value: opportunities._count.records.toLocaleString(),
      href: `/c/${opportunities.id}`,
    });
    tiles.push({
      key: "pipeline",
      label: "進行中の商談金額",
      value: yen(openAmount),
      hint: `${openCount.toLocaleString()} 件`,
      href: `/c/${opportunities.id}`,
    });
    tiles.push({
      key: "won",
      label: "受注金額",
      value: yen(wonAmount),
      href: `/c/${opportunities.id}`,
    });
  }
  if (contacts) {
    tiles.push({
      key: "contacts",
      label: "担当者数",
      value: contacts._count.records.toLocaleString(),
      href: `/c/${contacts.id}`,
    });
  }
  if (activities) {
    tiles.push({
      key: "activities",
      label: "今月の活動数",
      value: activitiesThisMonth.toLocaleString(),
      href: `/c/${activities.id}`,
    });
  }

  /* ------------------------------- tab routing ----------------------------- */

  const activeDashboard =
    tab && tab !== "summary" ? dashboards.find((d) => d.id === tab) : undefined;
  const activeTab = activeDashboard ? activeDashboard.id : "summary";

  // Only the selected dashboard is computed, so the page stays fast.
  let computed: Awaited<ReturnType<typeof computeDashboard>> = [];
  if (activeDashboard) {
    const record = await db.dashboard.findFirst({
      where: { id: activeDashboard.id, workspaceId },
      select: { collectionSlugs: true, layout: true, description: true },
    });
    if (record) {
      const slugs = Array.isArray(record.collectionSlugs)
        ? record.collectionSlugs.filter((s): s is string => typeof s === "string")
        : [];
      const layout = (record.layout as WidgetSpec[]) ?? [];
      const map = await loadDashboardCollections(workspaceId, slugs);
      computed = computeDashboard(layout, map);
    }
  }

  /* --------------------------- CRM list views (サマリー) --------------------- */

  const views: CrmObjectView[] = [];
  if (!activeDashboard) {
    for (const obj of CRM_OBJECTS) {
      const collection = bySlug.get(obj.slug);
      if (!collection) continue;

      const fieldByKey = new Map(collection.fields.map((f) => [f.key, f]));
      const columns: CrmColumn[] = [];
      for (const key of obj.listColumns) {
        const f = fieldByKey.get(key);
        if (!f) continue;
        const config = (f.config ?? null) as {
          targetCollectionId?: string;
        } | null;
        columns.push({
          key: f.key,
          name: f.name,
          type: f.type,
          options: (f.options as SelectOption[] | null) ?? null,
          targetCollectionId: config?.targetCollectionId ?? null,
        });
      }

      const records = await db.record.findMany({
        where: { collectionId: collection.id },
        orderBy: { createdAt: "desc" },
        take: LIST_ROWS,
        select: { id: true, data: true },
      });

      const resolved = await resolveCollectionRecords(
        workspaceId,
        collection as unknown as EngineCollection,
        records.map((r) => ({
          id: r.id,
          data: (r.data as Record<string, unknown>) ?? {},
        })),
      );

      views.push({
        slug: obj.slug,
        name: collection.name,
        icon: collection.icon,
        description: obj.description,
        collectionId: collection.id,
        count: collection._count.records,
        primaryKey: primaryKeyOf(obj),
        columns,
        rows: resolved.records.map((r) => ({
          id: r.id,
          values: { ...r.data, ...r.computed },
        })),
        relationLabels: resolved.relationLabels,
      });
    }
  }

  /* --------------------------------- render -------------------------------- */

  return (
    <>
      <Topbar user={user} title="ホーム" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-lg font-semibold text-ink">
                  {user.workspace.name}
                </h2>
                <HelpTip label="ホームの見方">
                  上段はワークスペース全体のサマリーです。タブを切り替えると、
                  保存したダッシュボードをそのまま表示できます。
                  「サマリー」タブには顧客・商談・担当者・活動の一覧があり、
                  名前をクリックすると各レコードの詳細が開きます。
                </HelpTip>
              </div>
              <p className="mt-0.5 text-sm text-ink-muted">
                顧客データベースと、保存したダッシュボードの入口です。
              </p>
            </div>
          </div>

          {/* A) サマリー band / onboarding */}
          {hasCrm ? (
            <SummaryBand tiles={tiles} />
          ) : (
            <Card>
              <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-2xl space-y-2">
                  <h3 className="text-base font-semibold text-ink">
                    顧客データベースをはじめる
                  </h3>
                  <p className="text-sm text-ink-soft">
                    顧客・担当者・商談・活動を DashDrop
                    のマスターデータとして作成します。
                    取り込んだExcelはそのまま残したうえで、
                    会社の「顧客の正しい情報」をここに集約していけます。
                  </p>
                  <p className="text-xs text-ink-muted">
                    はじめはサンプルデータ入りで作成されます。中身は後から自由に編集・削除できます。
                  </p>
                </div>
                <div className="shrink-0">
                  <SetupCrmButton />
                </div>
              </CardBody>
            </Card>
          )}

          {/* B) タブ */}
          <div className="space-y-5">
            <HomeTabs
              tabs={dashboards.map((d) => ({
                id: d.id,
                name: d.name,
                icon: d.icon,
              }))}
              active={activeTab}
            />

            {activeDashboard ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">
                    {activeDashboard.name}
                  </h3>
                  <Link
                    href={`/d/${activeDashboard.id}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-khaki-700 hover:text-khaki-800 hover:underline"
                  >
                    このダッシュボードを開く
                    <NavIcon name="chevron" className="h-3 w-3" />
                  </Link>
                </div>
                {computed.length === 0 ? (
                  <p className="py-12 text-center text-sm text-ink-muted">
                    表示できるウィジェットがありません。
                  </p>
                ) : (
                  <DashboardGrid computed={computed} />
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {dashboards.length === 0 && (
                  <p className="rounded-md border border-ink-line bg-paper-raised px-4 py-3 text-sm text-ink-muted">
                    保存したダッシュボードはまだありません。
                    <Link
                      href="/dashboards"
                      className="ml-1 font-medium text-khaki-700 hover:text-khaki-800 hover:underline"
                    >
                      ダッシュボードを追加
                    </Link>
                    すると、ここにタブとして並びます。
                  </p>
                )}

                {/* C) 顧客データベース */}
                {views.length > 0 ? (
                  <CrmSection views={views} />
                ) : (
                  hasCrm && (
                    <p className="rounded-md border border-ink-line bg-paper-raised px-4 py-3 text-sm text-ink-muted">
                      顧客データベースのオブジェクトが見つかりませんでした。
                    </p>
                  )
                )}

                {/* D) 取り込んだファイル */}
                <FilesStrip
                  workbooks={workbooks.map((w) => ({
                    id: w.id,
                    name: w.name,
                    sheetCount: w._count.collections,
                  }))}
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
