/**
 * Edit-existing dashboard — the drag-and-drop builder in "edit" mode.
 *
 * Loads the same workspace sheets as the create page, plus the dashboard being
 * edited (tenant-scoped). Its stored `collectionSlugs` (Json) and `layout`
 * (Json → WidgetSpec[]) seed the builder's `initial` prop.
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import type { WidgetSpec } from "@/lib/widgets";
import { Topbar } from "@/components/app/Topbar";
import { DashboardBuilder } from "@/components/dashboard/DashboardBuilder";

export default async function DashboardEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const workspaceId = user.workspace.id;
  const { id } = await params;

  const dashboard = await db.dashboard.findFirst({
    where: { id, workspaceId },
  });
  if (!dashboard) redirect("/dashboards");

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

  const collectionSlugs = Array.isArray(dashboard.collectionSlugs)
    ? dashboard.collectionSlugs.filter(
        (s): s is string => typeof s === "string",
      )
    : [];
  const layout = (dashboard.layout as WidgetSpec[]) ?? [];

  return (
    <>
      <Topbar user={user} title="ダッシュボードを編集" />
      <main className="flex-1 overflow-y-auto p-6">
        <DashboardBuilder
          collections={collections}
          workbooks={workbooks}
          initial={{
            id: dashboard.id,
            name: dashboard.name,
            description: dashboard.description ?? "",
            collectionSlugs,
            layout,
          }}
        />
      </main>
    </>
  );
}
