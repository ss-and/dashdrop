/**
 * Navigation payload for the Salesforce-style app launcher.
 * GET → {
 *   crm:        [{ id, slug, name, icon, recordCount }],   // 顧客/担当者/商談/活動
 *   workbooks:  [{ id, name, sheets: [{ id, name, icon, recordCount }] }],
 *   looseSheets:[{ id, name, icon, recordCount }],
 *   dashboards: [{ id, name, icon }]
 * }
 *
 * Everything is workspace-scoped. The launcher renders ホーム first, then the CRM
 * objects (the master database), then the imported files and their sheets.
 */
import { withAuth, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { CRM_SLUGS } from "@/lib/crm-objects";

export const GET = withAuth(async (_req, { user }) => {
  const workspaceId = user.workspace.id;

  const [collections, workbooks, dashboards] = await Promise.all([
    db.collection.findMany({
      where: { workspaceId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        icon: true,
        workbookId: true,
        _count: { select: { records: true } },
      },
    }),
    db.workbook.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    db.dashboard.findMany({
      where: { workspaceId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, icon: true },
    }),
  ]);

  const shape = (c: (typeof collections)[number]) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    icon: c.icon,
    recordCount: c._count.records,
  });

  // CRM objects first, in the canonical order.
  const crm = CRM_SLUGS.map((slug) =>
    collections.find((c) => c.slug === slug),
  )
    .filter((c): c is (typeof collections)[number] => Boolean(c))
    .map(shape);

  const crmIds = new Set(crm.map((c) => c.id));
  const rest = collections.filter((c) => !crmIds.has(c.id));

  const grouped = workbooks
    .map((wb) => ({
      id: wb.id,
      name: wb.name,
      sheets: rest.filter((c) => c.workbookId === wb.id).map(shape),
    }))
    .filter((g) => g.sheets.length > 0);

  const looseSheets = rest.filter((c) => !c.workbookId).map(shape);

  return ok({ crm, workbooks: grouped, looseSheets, dashboards });
});
