/**
 * ホーム — Excel を置く場所。
 *
 * 利用者の指摘でここまで削った:
 * 「文字や見る機能が多すぎて、わかりづらくなっている気がするし、
 *   結局Excelをもっと複雑化したみたいな印象かな」
 * 「最初のホームはExcelをドロップしよう！みたいなのでもいいのかな」
 *
 * 以前は「今日の数字 / 売上サマリー / スプレッドシート / ダッシュボード」の
 * 4段積みで、この製品の入口である「Excelを入れる」がどこにも無かった。
 * 数字もシート一覧も、中身がある人には要るが、無い人には空の枠でしかない。
 *
 * 今の構成:
 *   1. Excel を置く場所（常に最上段・常に主役）
 *   2. 以下は「中身があるときだけ」出す — 無いものは枠ごと出さない
 *        ダッシュボード → スプレッドシート → 今日の数字
 *
 * 順番も入れ替えてある。取り込んだ人がまず見たいのはグラフで、数字の帯は
 * 顧客データベースを使っている人にしか意味が無いため最後に置く。
 *
 * Server component: everything is loaded with workspace-scoped Prisma queries.
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { CRM_OBJECTS } from "@/lib/crm-objects";
import { HR_OBJECTS } from "@/lib/hr-objects";
import { MASTER_SLUGS } from "@/lib/master-objects";
import type { SelectOption } from "@/lib/field-types";
import { Topbar } from "@/components/app/Topbar";
import { ExcelDropZone } from "@/components/home/ExcelDropZone";
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
      rawValue: openAmount,
      hint: `${openCount.toLocaleString()} 件`,
      href: `/c/${opportunities.id}`,
    });
    candidates.push({
      key: "won",
      label: "受注金額",
      value: yen(wonAmount),
      rawValue: wonAmount,
      hint: `${wonCount.toLocaleString()} 件`,
      href: `/c/${opportunities.id}`,
    });
  }
  if (invoices) {
    candidates.push({
      key: "unpaid",
      label: "未入金",
      value: yen(unpaidAmount),
      rawValue: unpaidAmount,
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
      rawValue: accounts._count.records,
      href: `/c/${accounts.id}`,
    });
  }
  // ゼロばかりの数字は情報ではなく雑音。1つでも中身のある数字があるときだけ
  // 帯ごと出す（新規ワークスペースで ¥0 ¥0 ¥0 0 が並ぶのを避ける）。
  const tiles = candidates.slice(0, 4);
  const hasRealNumbers = candidates.some((t) => t.rawValue > 0);

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
        recordCount: c._count.records,
        href: `/c/${c.id}`,
      },
    ];
  });

  const fileEntries: SheetEntry[] = workbooks.map((w) => ({
    id: w.id,
    name: w.name,
    meta: `${w._count.collections.toLocaleString()} シート`,
    recordCount: w._count.collections,
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
        recordCount: c._count.records,
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
      recordCount: c._count.records,
      href: `/c/${c.id}`,
    }));

  /**
   * ホームに出すのは「中身のあるシート」だけ。
   *
   * 登録直後は 顧客/担当者/商談/請求書/活動 と、初期作成の 顧客問い合わせ/タスク
   * が 0 件のまま並び、7 行の「0 件」が最初に見えるものになっていた。
   * ここは一覧ではなく要約なので、空のものは出さない。すべてのシートは
   * 左のサイドバーとランチャーから今までどおり辿れる。
   */
  const withRows = (entries: SheetEntry[]) =>
    entries.filter((e) => (e.recordCount ?? 0) > 0);

  const groups: SheetGroup[] = [
    { key: "crm", label: "顧客データベース", entries: withRows(crmEntries) },
    { key: "hr", label: "人事データベース", entries: withRows(hrEntries) },
    { key: "files", label: "取り込んだファイル", entries: fileEntries },
    { key: "loose", label: "その他", entries: withRows(looseEntries) },
  ];

  /* --------------------------------- render -------------------------------- */

  return (
    <>
      <Topbar user={user} title="ホーム" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-8">
          {/* 1) 主役。中身の有無に関わらず、常にここ。 */}
          <ExcelDropZone />

          {/* 2) 以下は「あるときだけ」。空の枠は、それ自体が雑音になる。 */}
          {dashboards.length > 0 && (
            <DashboardSection dashboards={dashboards} />
          )}

          {groups.some((g) => g.entries.length > 0) && (
            <SpreadsheetSection groups={groups} />
          )}

          {hasRealNumbers && tiles.length > 0 && (
            <div className="space-y-3">
              <h2 className="section-title">今日の数字</h2>
              <SummaryBand tiles={tiles} />
              {/* 売上サマリーは、請求書に実データがあるときだけ。 */}
              {invoices && invoiceRecords.length > 0 && (
                <RevenueSummary
                  steps={revenueSteps}
                  statuses={revenueStatuses}
                  invoicesHref={`/c/${invoices.id}`}
                />
              )}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
