/**
 * Collection (table) view — one spreadsheet, with its data and its analysis.
 *
 * Two tabs live here, driven by `?view=`:
 *   表   — the client <DataGrid/> (default)
 *   分析 — <AnalyzeView/>, charts for THIS sheet, built the moment you open it
 * Server component: loads the tenant-scoped collection, and only the records
 * the active tab actually needs.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getCollectionForUser } from "@/lib/workspace";
import {
  resolveCollectionRecords,
  type EngineCollection,
} from "@/lib/relations";
import type { SelectOption } from "@/lib/field-types";
import { Topbar } from "@/components/app/Topbar";
import { CollectionIcon, NavIcon } from "@/components/app/icons";
import { HelpTip } from "@/components/ui/HelpTip";
import { DataGrid } from "@/components/grid/DataGrid";
import { AutoDashboardButton } from "@/components/dashboard/AutoDashboardButton";
import { SheetTabs } from "@/components/sheet/SheetTabs";
import { DeleteDataButton } from "@/components/data/DeleteDataButton";
import { collectDeleteImpact } from "@/lib/data-delete";
import { AnalyzeView } from "@/components/sheet/AnalyzeView";

/** 絞り込み時に読む最大行数。全件読みにしないための上限。 */
const DRILL_SCAN_LIMIT = 5000;

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ collectionId: string }>;
  searchParams: Promise<{ view?: string; f?: string; v?: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const { collectionId } = await params;
  const { view, f: filterField, v: filterValue } = await searchParams;
  const isAnalyze = view === "analyze";
  /**
   * ダッシュボードからの絞り込み（?f=列キー&v=値）。
   *
   * グラフのひと切れを押したときに、その内訳の行だけを開くための入口。これが
   * 無いと「フェーズBが3,600万」で終わってしまい、どの案件なのかに辿り着けない。
   */
  const drill =
    filterField && filterValue !== undefined
      ? { field: filterField, value: filterValue }
      : null;

  let collection: Awaited<ReturnType<typeof getCollectionForUser>>;
  try {
    collection = await getCollectionForUser(user, collectionId);
  } catch {
    redirect("/dashboard"); // returns never — collection is assigned past here
  }

  // Parent file (workbook), if this sheet was imported as part of one.
  const workbook = collection.workbookId
    ? await db.workbook.findFirst({
        where: { id: collection.workbookId, workspaceId: user.workspace.id },
        select: { id: true, name: true },
      })
    : null;

  /*
   * 消したときに巻き添えになるものを、押す前に見せるために先に数えておく。
   * 消した後では「どのダッシュボードが空になったか」は分からない。
   */
  const deleteImpact = await collectDeleteImpact(
    user.workspace.id,
    [collection.id],
    [collection.slug],
  );

  /** Everything only the 表 tab needs — skipped entirely on the 分析 tab. */
  async function loadGrid() {
    /*
     * 絞り込み中は多めに読んでからアプリ側で突き合わせる。値は JSON の中にあり、
     * SQLite では Prisma の JSON パス検索が使えないため、DB 側では絞れない。
     * 上限つきなので、巨大なシートでも読み切りにはならない。
     */
    const records = await db.record.findMany({
      where: { collectionId: collection.id },
      orderBy: { createdAt: "desc" },
      take: drill ? DRILL_SCAN_LIMIT : 100,
      select: { id: true, data: true },
    });

    const matched = drill
      ? records.filter((r) => {
          const v = (r.data as Record<string, unknown>)?.[drill.field];
          return v !== null && v !== undefined && String(v) === drill.value;
        })
      : records;

    // Resolve cross-spreadsheet lookup/rollup values + relation labels.
    const resolved = await resolveCollectionRecords(
      user!.workspace.id,
      collection as unknown as EngineCollection,
      matched.slice(0, 200).map((r) => ({
        id: r.id,
        data: (r.data as Record<string, unknown>) ?? {},
      })),
    );

    // Other spreadsheets in this workspace — used by the field editor to
    // configure relation / lookup / rollup targets.
    const workspaceCollections = await db.collection.findMany({
      where: { workspaceId: user!.workspace.id },
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        fields: {
          orderBy: { position: "asc" },
          select: { key: true, name: true, type: true, config: true },
        },
      },
    });

    return { resolved, workspaceCollections };
  }

  const gridData = isAnalyze ? null : await loadGrid();

  return (
    <>
      <Topbar user={user} title={collection.name} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md border border-ink-line bg-paper-raised">
                <CollectionIcon
                  name={collection.icon}
                  className="h-5 w-5 text-khaki-500"
                />
              </span>
              <div>
                {workbook ? (
                  <Link
                    href={`/f/${workbook.id}`}
                    className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-ink-faint hover:text-khaki-600"
                  >
                    <NavIcon name="folder" className="h-3 w-3" />
                    <span className="truncate">{workbook.name}</span>
                  </Link>
                ) : (
                  <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                    スプレッドシート
                  </p>
                )}
                <div className="flex items-center gap-1.5">
                  <h2 className="text-lg font-semibold text-ink">
                    {collection.name}
                  </h2>
                  <HelpTip label="スプレッドシートの使い方">
                    セルをクリックすると直接編集できます（Enterで確定 / Escで取消）。
                    一番下の行から新規追加、列見出しの「…」から項目の追加・変更、
                    右上からExcel書き出しができます。「分析」タブでは、このシートの
                    グラフをそのまま開けます。
                  </HelpTip>
                </div>
                {collection.description && (
                  <p className="text-sm text-ink-muted">
                    {collection.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-start gap-2">
              {/* Redundant on the 分析 tab — the analysis is already on screen. */}
              {!isAnalyze && (
                <AutoDashboardButton
                  collectionId={collection.id}
                  label="ダッシュボード自動作成"
                />
              )}
              <Link
                href={`/dashboards/build?sheet=${collection.id}`}
                className="inline-flex h-9 items-center gap-2 rounded border border-ink-line bg-paper-raised px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-sunken"
              >
                <NavIcon name="dashboard" className="h-4 w-4" />
                自分で作る
              </Link>
              <Link
                href={`/api/export/${collection.id}`}
                className="inline-flex h-9 items-center gap-2 rounded border border-ink-line bg-paper-raised px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-sunken"
              >
                <NavIcon name="download" className="h-4 w-4" />
                Excelで書き出し
              </Link>
              {/* 間違えて入れた表を、その場で取り消せるように。 */}
              <DeleteDataButton
                kind="sheet"
                id={collection.id}
                name={collection.name}
                rowCount={deleteImpact.recordCount}
                affectedDashboards={deleteImpact.affectedDashboards}
                emptiedDashboards={deleteImpact.emptiedDashboards}
                exportHref={`/api/export/${collection.id}`}
                redirectTo={workbook ? `/f/${workbook.id}` : "/home"}
              />
            </div>
          </div>

          <SheetTabs
            collectionId={collection.id}
            active={isAnalyze ? "analyze" : "table"}
          />

          {/*
            シート結合（vlookup）の突合先が上限を超えていた場合の注意書き。
            これを出さないと「突合できなかった」のか「該当が無かった」のかが
            画面上まったく区別できず、大きなマスターに対して大半の行が黙って
            空欄になる。
          */}
          {gridData &&
            Object.entries(gridData.resolved.vlookupWarnings).length > 0 && (
              <div
                role="status"
                className="space-y-1 rounded border border-warning/30 bg-warning-soft px-3 py-2.5"
              >
                {Object.entries(gridData.resolved.vlookupWarnings).map(
                  ([key, warning]) => {
                    const field = collection.fields.find((f) => f.key === key);
                    return (
                      <p key={key} className="text-sm text-warning">
                        「{field?.name ?? key}」: {warning}
                      </p>
                    );
                  },
                )}
              </div>
            )}

          {/*
            ダッシュボードから飛んできたときの絞り込み表示。何で絞られているのかと、
            解除の導線を必ず出す。出さないと「行が少ない表」に見えてしまう。
          */}
          {drill && gridData && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-khaki-300 bg-khaki-50 px-3 py-2 text-sm">
              <span className="text-ink-soft">絞り込み中:</span>
              <span className="font-medium text-ink">
                {collection.fields.find((f) => f.key === drill.field)?.name ??
                  drill.field}
                {" = "}
                {drill.value}
              </span>
              <span className="text-ink-muted">
                {gridData.resolved.records.length} 件
              </span>
              <Link
                href={`/c/${collection.id}`}
                className="ml-auto font-medium text-khaki-700 hover:underline"
              >
                絞り込みを解除
              </Link>
            </div>
          )}

          {gridData ? (
            <DataGrid
              collection={{ id: collection.id, template: collection.template }}
              fields={collection.fields}
              initialRecords={gridData.resolved.records}
              relationLabels={gridData.resolved.relationLabels}
              lookupLabels={gridData.resolved.lookupLabels}
              workspaceCollections={gridData.workspaceCollections}
            />
          ) : (
            <AnalyzeView
              sheet={{
                id: collection.id,
                slug: collection.slug,
                name: collection.name,
              }}
              fields={collection.fields.map((f) => ({
                key: f.key,
                name: f.name,
                type: f.type,
                options: (f.options as unknown as SelectOption[] | null) ?? null,
              }))}
            />
          )}
        </div>
      </main>
    </>
  );
}
