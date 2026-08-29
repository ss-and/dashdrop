/**
 * Create-new dashboard — the drag-and-drop builder in "new" mode.
 *
 * Loads the workspace's sheets (with fields) grouped by file/workbook, then
 * hands off to the client <DashboardBuilder/>. `searchParams` can preselect a
 * data source: `sheet` selects one collection by slug, `file` selects every
 * sheet of that workbook.
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Topbar } from "@/components/app/Topbar";
import { DashboardBuilder } from "@/components/dashboard/DashboardBuilder";

export default async function DashboardBuildPage({
  searchParams,
}: {
  searchParams: Promise<{ file?: string; sheet?: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const workspaceId = user.workspace.id;
  const { file, sheet } = await searchParams;

  const collections = await db.collection.findMany({
    where: { workspaceId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      icon: true,
      workbookId: true,
      fields: {
        orderBy: { position: "asc" },
        select: { key: true, name: true, type: true },
      },
    },
  });

  const workbooks = await db.workbook.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  let preselectSlugs: string[] = [];
  if (sheet) {
    // `sheet` may be a collection id (from the sheet-grid link) or a slug.
    const match = collections.find(
      (c) => c.id === sheet || c.slug === sheet,
    );
    if (match) preselectSlugs = [match.slug];
  } else if (file) {
    preselectSlugs = collections
      .filter((c) => c.workbookId === file)
      .map((c) => c.slug);
  }

  return (
    <>
      <Topbar user={user} title="ダッシュボードを作成" />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <DashboardBuilder
          collections={collections}
          workbooks={workbooks}
          preselectSlugs={preselectSlugs}
        />
      </main>
    </>
  );
}
