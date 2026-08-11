/**
 * Collection (table) view — the spreadsheet grid for one Collection.
 * Server component: loads the tenant-scoped collection + its first page of
 * records, then hands off to the client <DataGrid/>.
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
import { Topbar } from "@/components/app/Topbar";
import { CollectionIcon, NavIcon } from "@/components/app/icons";
import { HelpTip } from "@/components/ui/HelpTip";
import { DataGrid } from "@/components/grid/DataGrid";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ collectionId: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const { collectionId } = await params;

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

  const records = await db.record.findMany({
    where: { collectionId: collection.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, data: true },
  });

  // Resolve cross-spreadsheet lookup/rollup values + relation labels.
  const resolved = await resolveCollectionRecords(
    user.workspace.id,
    collection as unknown as EngineCollection,
    records.map((r) => ({ id: r.id, data: (r.data as Record<string, unknown>) ?? {} })),
  );

  // Other spreadsheets in this workspace — used by the field editor to
  // configure relation / lookup / rollup targets.
  const workspaceCollections = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
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
                    右上からExcel書き出しができます。
                  </HelpTip>
                </div>
                {collection.description && (
                  <p className="text-sm text-ink-muted">
                    {collection.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/dashboards/build?sheet=${collection.id}`}
                className="inline-flex h-9 items-center gap-2 rounded border border-ink-line bg-paper-raised px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-sunken"
              >
                <NavIcon name="dashboard" className="h-4 w-4" />
                ダッシュボードを作成
              </Link>
              <Link
                href={`/api/export/${collection.id}`}
                className="inline-flex h-9 items-center gap-2 rounded border border-ink-line bg-paper-raised px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-sunken"
              >
                <NavIcon name="download" className="h-4 w-4" />
                Excelで書き出し
              </Link>
            </div>
          </div>

          <DataGrid
            collection={{ id: collection.id, template: collection.template }}
            fields={collection.fields}
            initialRecords={resolved.records}
            relationLabels={resolved.relationLabels}
            workspaceCollections={workspaceCollections}
          />
        </div>
      </main>
    </>
  );
}
