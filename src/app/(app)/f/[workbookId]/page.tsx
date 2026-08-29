/**
 * Workbook (file) overview — the parent of the sheets imported from one file.
 * Server component: loads the tenant-scoped workbook, its sheets (Collections)
 * and per-sheet row/column counts, then shows them as a Salesforce-style list
 * of related objects. Each sheet links to its spreadsheet grid.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Topbar } from "@/components/app/Topbar";
import { CollectionIcon, NavIcon } from "@/components/app/icons";
import { HelpTip } from "@/components/ui/HelpTip";
import { AutoDashboardButton } from "@/components/dashboard/AutoDashboardButton";
import { DeleteDataButton } from "@/components/data/DeleteDataButton";
import { collectDeleteImpact } from "@/lib/data-delete";
import { RememberVisit } from "@/components/app/RememberVisit";

const SOURCE_LABEL: Record<string, string> = {
  excel: "Excel",
  csv: "CSV",
  gsheets: "Google スプレッドシート",
};

export default async function WorkbookPage({
  params,
}: {
  params: Promise<{ workbookId: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const { workbookId } = await params;

  const workbook = await db.workbook.findFirst({
    where: { id: workbookId, workspaceId: user.workspace.id },
    include: {
      collections: {
        orderBy: { position: "asc" },
        include: {
          _count: { select: { records: true, fields: true } },
        },
      },
    },
  });
  if (!workbook) redirect("/dashboard");

  const sheets = workbook.collections;
  const totalRows = sheets.reduce((a, c) => a + c._count.records, 0);
  const sourceLabel = SOURCE_LABEL[workbook.source] ?? "ファイル";

  /*
   * 消したときに巻き添えになるものを、押す前に見せるために先に数えておく。
   * 消した後では「どのダッシュボードが空になったか」は分からない。
   */
  const impact = await collectDeleteImpact(
    user.workspace.id,
    sheets.map((c) => c.id),
    sheets.map((c) => c.slug),
  );

  return (
    <>
      <Topbar user={user} title={workbook.name} />
      <RememberVisit
        workspaceId={user.workspace.id}
        kind="file"
        href={`/f/${workbook.id}`}
        name={workbook.name}
      />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-5xl space-y-5">
          {/* File header */}
          {/* 狭い画面では縦に積む。理由はシート画面のヘッダーと同じ。 */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md border border-ink-line bg-paper-raised">
                <NavIcon name="folder" className="h-5 w-5 text-khaki-500" />
              </span>
              <div className="min-w-0">
                <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                  ファイル（{sourceLabel}）
                </p>
                <div className="flex items-center gap-1.5">
                  <h2 className="truncate text-lg font-semibold text-ink">
                    {workbook.name}
                  </h2>
                  <HelpTip label="ファイルとシートについて">
                    取り込んだExcel / スプレッドシートは「ファイル」として保持され、
                    その中の各タブが「シート」になります。左のシート名をクリックすると、
                    Excelのように編集できる表が開きます。
                  </HelpTip>
                </div>
                <p className="text-sm text-ink-muted">
                  {sheets.length} シート・合計 {totalRows.toLocaleString()} 行
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-start gap-2 sm:shrink-0">
              {sheets.length > 0 && (
                <>
                  <AutoDashboardButton workbookId={workbook.id} />
                  <Link
                    href={`/dashboards/build?file=${workbook.id}`}
                    className="inline-flex h-9 items-center gap-2 rounded border border-ink-line bg-paper-raised px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-sunken"
                  >
                    <NavIcon name="dashboard" className="h-4 w-4" />
                    自分で作る
                  </Link>
                </>
              )}
              {/* 取り込んだものを取り消せるように。中身が空のファイルも消せる。 */}
              <DeleteDataButton
                kind="file"
                id={workbook.id}
                name={workbook.name}
                rowCount={totalRows}
                sheetNames={sheets.map((c) => c.name)}
                affectedDashboards={impact.affectedDashboards}
                emptiedDashboards={impact.emptiedDashboards}
                redirectTo="/home"
              />
            </div>
          </div>

          {/* Sheets — Salesforce-style related list */}
          <div className="overflow-hidden rounded-md border border-ink-line bg-paper-raised shadow-card">
            <div className="flex items-center justify-between border-b border-ink-line px-4 py-2.5">
              <p className="text-sm font-semibold text-ink">シート一覧</p>
              <span className="text-2xs font-medium text-ink-faint">
                {sheets.length} 件
              </span>
            </div>
            <ul className="divide-y divide-ink-line">
              {sheets.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/c/${c.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-paper-sunken"
                  >
                    <CollectionIcon
                      name={c.icon}
                      className="h-4 w-4 shrink-0 text-khaki-500"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {c.name}
                    </span>
                    <span className="hidden shrink-0 text-xs text-ink-muted sm:inline">
                      {c._count.fields} 項目
                    </span>
                    <span className="shrink-0 tabular-nums text-xs text-ink-muted">
                      {c._count.records.toLocaleString()} 行
                    </span>
                    <NavIcon
                      name="chevron"
                      className="h-4 w-4 shrink-0 text-ink-faint"
                    />
                  </Link>
                </li>
              ))}
              {sheets.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-ink-faint">
                  このファイルにはシートがありません
                </li>
              )}
            </ul>
          </div>
        </div>
      </main>
    </>
  );
}
