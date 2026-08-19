/**
 * ホーム — the workspace's front door, in three blocks:
 *
 *   1. 今日の数字 — at most four KPIs, the first one the band's subject,
 *   2. スプレッドシート — 顧客データベース と 取り込んだファイル を、同じ「行」で,
 *   3. ダッシュボード — 保存済みダッシュボードへのリンク一覧。
 *
 * 中身（表・分析）はすべて 1 クリック先にあるので、ホームは入口に徹する。
 * Server component: everything is loaded with workspace-scoped Prisma queries.
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { CRM_OBJECTS, CRM_SLUGS } from "@/lib/crm-objects";
import { HR_OBJECTS, HR_SLUGS } from "@/lib/hr-objects";
import type { SelectOption } from "@/lib/field-types";
import { Topbar } from "@/components/app/Topbar";
import { GettingStarted } from "@/components/help/GettingStarted";
import { SummaryBand, type SummaryTile } from "@/components/home/SummaryBand";
import {
  RevenueSummary,
  type RevenueStatusRow,
  type RevenueStep,
} from "@/components/home/RevenueSummary";
import {
  SpreadsheetSection,
  type SheetEntry,
  type SheetGroup,
} from "@/components/home/SpreadsheetSection";
import { DashboardSection } from "@/components/home/DashboardSection";
import { SetupCrmButton } from "@/components/home/SetupCrmButton";

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

export default async function HomePage() {
  const user = await getSession();
  if (!user) redirect("/login");

  const workspaceId = user.workspace.id;

  /** 顧客データベース + 人事データベース — ホームでは「マスター」として一括で扱う。 */
  const MASTER_SLUGS: string[] = [...CRM_SLUGS, ...HR_SLUGS];

  /* ------------------------------ base loading ----------------------------- */

  const [masterCollections, otherCollections, dashboards, workbooks] =
    await Promise.all([
      db.collection.findMany({
        where: { workspaceId, slug: { in: MASTER_SLUGS } },
        include: {
          fields: { orderBy: { position: "asc" } },
          _count: { select: { records: true } },
        },
      }),
      db.collection.findMany({
        where: { workspaceId, slug: { notIn: MASTER_SLUGS } },
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          icon: true,
          workbookId: true,
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

  type MasterCollection = (typeof masterCollections)[number];
  const bySlug = new Map<string, MasterCollection>(
    masterCollections.map((c) => [c.slug, c]),
  );

  const accounts = bySlug.get("accounts");
  const opportunities = bySlug.get("opportunities");
  const invoices = bySlug.get("invoices");

  /* --------------------------------- 商談 ---------------------------------- */

  // 金額はレコードの JSON に入っているため、行を読んでアプリ側で集計する。
  const oppRecords = opportunities
    ? await db.record.findMany({
        where: { collectionId: opportunities.id },
        select: { data: true },
      })
    : [];

  let openAmount = 0;
  let wonAmount = 0;
  let openCount = 0;
  let wonCount = 0;
  for (const r of oppRecords) {
    const d = (r.data as Record<string, unknown>) ?? {};
    const amount = toNumber(d.amount);
    const stage = typeof d.stage === "string" ? d.stage : "";
    if (stage === "won") {
      wonAmount += amount;
      wonCount += 1;
    } else if (stage !== "lost") {
      openAmount += amount;
      openCount += 1;
    }
  }

  /* ----------------------- 請求書 — 請求と入金の集計 ------------------------ */

  const invoiceRecords = invoices
    ? await db.record.findMany({
        where: { collectionId: invoices.id },
        select: { data: true },
      })
    : [];

  let invoicedTotal = 0;
  const invoiceStats = new Map<string, { count: number; amount: number }>();
  for (const r of invoiceRecords) {
    const d = (r.data as Record<string, unknown>) ?? {};
    const amount = toNumber(d.amount);
    const status = typeof d.status === "string" ? d.status : "";
    invoicedTotal += amount;
    const cur = invoiceStats.get(status) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += amount;
    invoiceStats.set(status, cur);
  }

  const statOf = (status: string) =>
    invoiceStats.get(status) ?? { count: 0, amount: 0 };
  const paidStat = statOf("paid");
  const issuedStat = statOf("issued");
  const overdueStat = statOf("overdue");
  /** 未入金 — 送付済みで、まだ入金されていない分（下書きは含めない）。 */
  const unpaidAmount = issuedStat.amount + overdueStat.amount;
  const unpaidCount = issuedStat.count + overdueStat.count;

  const invoiceStatusOptions: SelectOption[] = (() => {
    const stored = invoices?.fields.find((f) => f.key === "status");
    const fromStored = (stored?.options as SelectOption[] | null) ?? null;
    if (fromStored && fromStored.length > 0) return fromStored;
    const def = CRM_OBJECTS.find((o) => o.slug === "invoices");
    return def?.fields.find((f) => f.key === "status")?.options ?? [];
  })();

  const revenueSteps: RevenueStep[] = [];
  if (opportunities) {
    revenueSteps.push({
      key: "won",
      label: "受注金額（商談）",
      amount: wonAmount,
      count: wonCount,
      href: `/c/${opportunities.id}`,
    });
  }
  if (invoices) {
    revenueSteps.push({
      key: "invoiced",
      label: "請求金額",
      amount: invoicedTotal,
      count: invoiceRecords.length,
      href: `/c/${invoices.id}`,
    });
    revenueSteps.push({
      key: "paid",
      label: "入金済み",
      amount: paidStat.amount,
      count: paidStat.count,
      href: `/c/${invoices.id}`,
    });
  }

  const revenueStatuses: RevenueStatusRow[] = invoiceStatusOptions
    .map((o) => {
      const s = statOf(String(o.value));
      return {
        value: String(o.value),
        label: o.label,
        color: o.color,
        count: s.count,
        amount: s.amount,
      };
    })
    .filter((r) => r.count > 0);

  /* ------------------------------ A) 今日の数字 ----------------------------- */

  // オーナーがアプリを開く理由になる数字だけ。存在するものから最大 4 つ、
  // 先頭がヒーロー（幅も文字も大きい）。
  const candidates: SummaryTile[] = [];
  if (opportunities) {
    candidates.push({
      key: "pipeline",
      label: "進行中の商談金額",
      value: yen(openAmount),
      hint: `${openCount.toLocaleString()} 件`,
      href: `/c/${opportunities.id}`,
    });
    candidates.push({
      key: "won",
      label: "受注金額",
      value: yen(wonAmount),
      hint: `${wonCount.toLocaleString()} 件`,
      href: `/c/${opportunities.id}`,
    });
  }
  if (invoices) {
    candidates.push({
      key: "unpaid",
      label: "未入金",
      value: yen(unpaidAmount),
      hint:
        overdueStat.count > 0
          ? `うち期限超過 ${overdueStat.count.toLocaleString()} 件`
          : `${unpaidCount.toLocaleString()} 件`,
      href: `/c/${invoices.id}`,
    });
  }
  if (accounts) {
    candidates.push({
      key: "accounts",
      label: "顧客数",
      value: accounts._count.records.toLocaleString(),
      href: `/c/${accounts.id}`,
    });
  }
  const tiles = candidates.slice(0, 4);

  /* --------------------------- B) スプレッドシート -------------------------- */

  const crmEntries: SheetEntry[] = CRM_OBJECTS.flatMap((obj) => {
    const c = bySlug.get(obj.slug);
    if (!c) return [];
    return [
      {
        id: c.id,
        name: c.name,
        icon: c.icon,
        meta: `${c._count.records.toLocaleString()} 件`,
        href: `/c/${c.id}`,
      },
    ];
  });

  const fileEntries: SheetEntry[] = workbooks.map((w) => ({
    id: w.id,
    name: w.name,
    meta: `${w._count.collections.toLocaleString()} シート`,
    href: `/f/${w.id}`,
    folder: true,
  }));

  const hrEntries: SheetEntry[] = HR_OBJECTS.flatMap((obj) => {
    const c = bySlug.get(obj.slug);
    if (!c) return [];
    return [
      {
        id: c.id,
        name: c.name,
        icon: c.icon,
        meta: `${c._count.records.toLocaleString()} 件`,
        href: `/c/${c.id}`,
      },
    ];
  });

  const looseEntries: SheetEntry[] = otherCollections
    .filter((c) => !c.workbookId)
    .map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      meta: `${c._count.records.toLocaleString()} 件`,
      href: `/c/${c.id}`,
    }));

  const groups: SheetGroup[] = [
    { key: "crm", label: "顧客データベース", entries: crmEntries },
    { key: "hr", label: "人事データベース", entries: hrEntries },
    { key: "files", label: "取り込んだファイル", entries: fileEntries },
    { key: "loose", label: "その他", entries: looseEntries },
  ];

  /* --------------------------------- render -------------------------------- */

  const crmHref = accounts ? `/c/${accounts.id}` : null;
  const masterRecords = masterCollections.reduce(
    (sum, c) => sum + c._count.records,
    0,
  );
  /** 本当に新しいワークスペース — マスターのデータも、取り込んだファイルも無い。 */
  const isNewWorkspace =
    masterRecords === 0 &&
    workbooks.length === 0 &&
    otherCollections.length === 0;

  return (
    <>
      <Topbar user={user} title="ホーム" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-8">
          <h2 className="text-xl font-semibold text-ink">
            {user.workspace.name}
          </h2>

          {/* A) 今日の数字 */}
          {tiles.length > 0 && (
            <div className="space-y-3">
              <h2 className="section-title">今日の数字</h2>
              <SummaryBand tiles={tiles} />
              {/* 売上サマリーは、請求書に実データがあるときだけ。空の枠は置かない。 */}
              {invoices && invoiceRecords.length > 0 && (
                <RevenueSummary
                  steps={revenueSteps}
                  statuses={revenueStatuses}
                  invoicesHref={`/c/${invoices.id}`}
                />
              )}
            </div>
          )}

          {/* B) スプレッドシート */}
          <SpreadsheetSection groups={groups} />

          {/* C) ダッシュボード */}
          <DashboardSection dashboards={dashboards} />

          {/* はじめかた — 何も無いワークスペースのときだけ。 */}
          {isNewWorkspace && (
            <GettingStarted
              crmHref={crmHref}
              crmAction={<SetupCrmButton size="sm" variant="secondary" />}
            />
          )}
        </div>
      </main>
    </>
  );
}
