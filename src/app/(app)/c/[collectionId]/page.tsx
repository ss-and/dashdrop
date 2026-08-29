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
import { RememberVisit } from "@/components/app/RememberVisit";
import {
  drillHref,
  drillHrefWithout,
  drillLabel,
  parseDrill,
  parseLegacyDrill,
  recordMatchesDrill,
  needsComputedResolution,
  drillLookup,
  type DrillFilter,
} from "@/lib/drill";

/** 絞り込み時に読む最大行数。全件読みにしないための上限。 */
const DRILL_SCAN_LIMIT = 5000;

/** 一度に画面へ渡す行数。DataGrid が続きをカーソルで取りに行く。 */
const PAGE_ROWS = 200;

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ collectionId: string }>;
  searchParams: Promise<{
    view?: string;
    /** 旧形式（共有済みURL）。単一の eq として読む。 */
    f?: string;
    v?: string;
    /** 新形式。条件1つにつき d が1個。 */
    d?: string | string[];
    /** どのダッシュボードから来たか。着いた先に戻り道を出すために使う。 */
    from?: string;
  }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const { collectionId } = await params;
  const {
    view,
    f: filterField,
    v: filterValue,
    d: drillParam,
    from: fromDashboardId,
  } = await searchParams;
  const isAnalyze = view === "analyze";

  /**
   * ダッシュボードからの絞り込み。
   *
   * グラフのひと切れを押したときに、その内訳の行だけを開くための入口。これが
   * 無いと「フェーズBが3,600万」で終わってしまい、どの案件なのかに辿り着けない。
   *
   * 形式は `?d=<json>` の繰り返し（src/lib/drill.ts）。1条件1パラメータなので、
   * チップの ✕ が「その条件だけ抜いたURL」を指せる。
   *
   * 旧い `?f=&v=` も読む。すでに共有されたURLと、まだ直していないウィジェットの
   * ため。単一の eq に正規化して同じ道に合流させる。
   */
  const drillRaw = drillParam === undefined ? [] : ([] as string[]).concat(drillParam);
  const parsedDrill = parseDrill(drillRaw);
  const drills: DrillFilter[] = [
    ...parsedDrill.filters,
    ...parseLegacyDrill(filterField, filterValue),
  ];

  /*
   * 来た場所。
   *
   * ドリルダウンは「ダッシュボード → グラフのひと切れ → その裏の行」という
   * 一続きの動きなのに、着いた先に帰る手段が無かった。ブラウザの戻るは効くが、
   * 押した本人はもう表を触っていて（並べ替え・列の編集・別の行を開く）、
   * 何回戻ればいいのか分からない。
   *
   * 題名はURLに載せずidだけを持ち歩き、ここで引き直す。長いURLにならないし、
   * ダッシュボードが改名されても古い名前が残らない。**必ずワークスペースで
   * 絞る**——他人のダッシュボードのidを入れて題名を覗けてはいけない。
   * 見つからなければ黙って戻り道を出さない（消された後の共有URL）。
   */
  const origin = fromDashboardId
    ? await db.dashboard.findFirst({
        where: { id: fromDashboardId, workspaceId: user.workspace.id },
        select: { id: true, name: true },
      })
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
    const active = drills.length > 0;
    const records = await db.record.findMany({
      where: { collectionId: collection.id },
      orderBy: { createdAt: "desc" },
      take: active ? DRILL_SCAN_LIMIT : PAGE_ROWS / 2,
      select: { id: true, data: true },
    });
    // 走査が上限に当たったか。当たっていたら「これで全部」とは言えない。
    const scanTruncated = active && records.length === DRILL_SCAN_LIMIT;

    const asRow = (r: (typeof records)[number]) => ({
      id: r.id,
      data: (r.data as Record<string, unknown>) ?? {},
    });

    /*
     * 計算列（数式・VLOOKUP・ルックアップ・ロールアップ）で絞るときは、
     * **解決してから絞る**。
     *
     * 元の不具合: 計算列は保存されず読み取り時に評価されるので、生の data には
     * 存在しない。ダッシュボード側は computed を data にマージしてから集計する
     * （src/lib/apply-template.ts）のに、ここは生の data だけを見ていた。結果、
     * 数式で作った円グラフのスライスを押すと**静かに0件の表**が出ていた。
     * エラーも警告も出ないので、何が起きたのか誰にも分からない。
     *
     * 生の列だけで絞れるときは今までどおり「絞ってから解決」でよい。解決は
     * 行数ぶんのクエリを投げるわけではない（関連1本あたり2クエリ）が、行数が
     * 増えるほど JS の仕事は増えるので、要らないときは走らせない。
     */
    const needsComputed = needsComputedResolution(collection.fields, drills);

    let resolved;
    let matchedCount: number;

    if (active && needsComputed) {
      const all = await resolveCollectionRecords(
        user!.workspace.id,
        collection as unknown as EngineCollection,
        records.map(asRow),
      );
      const hits = all.records.filter((r) =>
        recordMatchesDrill(drillLookup(r), drills),
      );
      matchedCount = hits.length;
      resolved = { ...all, records: hits.slice(0, PAGE_ROWS) };
    } else {
      const matched = active
        ? records.filter((r) =>
            recordMatchesDrill(
              (key) => (r.data as Record<string, unknown>)?.[key],
              drills,
            ),
          )
        : records;
      matchedCount = matched.length;
      // Resolve cross-spreadsheet lookup/rollup values + relation labels.
      resolved = await resolveCollectionRecords(
        user!.workspace.id,
        collection as unknown as EngineCollection,
        matched.slice(0, PAGE_ROWS).map(asRow),
      );
    }

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

    return { resolved, workspaceCollections, matchedCount, scanTruncated };
  }

  const gridData = isAnalyze ? null : await loadGrid();

  return (
    <>
      <Topbar user={user} title={collection.name} />
      <RememberVisit
        workspaceId={user.workspace.id}
        kind="sheet"
        href={`/c/${collection.id}`}
        name={collection.name}
      />
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
          {/*
            ダッシュボードから飛んできたときの絞り込み表示。何で絞られているのかと、
            解除の導線を必ず出す。出さないと「行が少ない表」に見えてしまう。

            条件は1つずつチップにして、それぞれに解除を付ける。まとめて1つの
            チップにすると「部門とフェーズで絞ったが、部門だけ外したい」ができない。
          */}
          {/*
            来た場所へ戻る1行。グラフを押して行に辿り着いた人が、元の絵に
            帰れるようにする。ブラウザの戻るでも帰れるが、着いた先で表を
            触ったあとでは何回押せばいいのか分からない。
          */}
          {origin && (
            <Link
              href={`/d/${origin.id}`}
              className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors duration-fast hover:text-ink"
            >
              <span aria-hidden="true">←</span>
              <span className="font-medium">{origin.name}</span>に戻る
            </Link>
          )}

          {drills.length > 0 && gridData && (
            <div className="space-y-2 rounded-md border border-khaki-300 bg-khaki-50 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="shrink-0 text-ink-soft">絞り込み中:</span>
                {drills.map((d, i) => (
                  <span
                    key={`${d.op}:${d.field}:${i}`}
                    className="inline-flex items-center gap-1.5 rounded border border-khaki-300 bg-paper-raised px-2 py-0.5"
                  >
                    <span className="font-medium text-ink">
                      {drillLabel(
                        d,
                        collection.fields.find((f) => f.key === d.field)?.name,
                      )}
                    </span>
                    <Link
                      href={drillHrefWithout(collection.id, drills, i, { from: origin?.id })}
                      aria-label={`${drillLabel(d)} の絞り込みを外す`}
                      className="text-ink-muted hover:text-ink"
                    >
                      ×
                    </Link>
                  </span>
                ))}
                {drills.length > 1 && (
                  <Link
                    href={drillHref(collection.id, [], { from: origin?.id })}
                    className="ml-auto shrink-0 font-medium text-khaki-700 hover:underline"
                  >
                    すべて解除
                  </Link>
                )}
              </div>
              {/*
                件数。以前は画面に渡した行数（200で頭打ち）をそのまま「N件」と
                出していたので、201件以上あるときは必ず「200件」と嘘をついていた。
                一致した数と、表示している数を分けて出す。

                走査の上限（5000行）に当たったときは、その先にも一致があるかも
                しれないと必ず言う。この製品は「打ち切りを黙って行わない」を
                徹底しているので、ここだけ例外にはしない。
              */}
              <p className="text-xs text-ink-muted">
                {gridData.matchedCount.toLocaleString("ja-JP")} 件が一致
                {gridData.matchedCount > PAGE_ROWS &&
                  `（先頭 ${PAGE_ROWS} 件を表示中）`}
                {gridData.scanTruncated &&
                  `。新しい順 ${DRILL_SCAN_LIMIT.toLocaleString("ja-JP")} 行だけを対象に数えているため、これより古い行に一致があっても含まれていません。`}
              </p>
              {parsedDrill.dropped > 0 && (
                <p className="text-xs text-warning">
                  読めない絞り込み条件が {parsedDrill.dropped} 件ありました（項目が
                  削除された可能性があります）。その条件は無視しています。
                </p>
              )}
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
