/**
 * ファイル（Workbook）の削除。
 * DELETE — 取り込んだExcel1つぶんを、中のシートごと消す。
 *
 * 順序が大事。Collection.workbookId は SetNull なので、ファイルだけ先に消すと
 * 中のシートが**親の無い状態で一覧に残る**（利用者から見れば「消したのに
 * 残っている」）。必ずシートから消す。
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import {
  collectDeleteImpact,
  deleteCollections,
  deleteEmptiedDashboards,
} from "@/lib/data-delete";
import { logActivity } from "@/lib/workspace";

export const DELETE = withAuth(async (req, { user, params }) => {
  const workspaceId = user.workspace.id;

  const workbook = await db.workbook.findFirst({
    where: { id: params.id, workspaceId },
    include: { collections: { select: { id: true, name: true, slug: true } } },
  });
  if (!workbook) throw new ApiError("ファイルが見つかりません。", 404);

  const ids = workbook.collections.map((c) => c.id);
  const impact = await collectDeleteImpact(
    workspaceId,
    ids,
    workbook.collections.map((c) => c.slug),
  );

  await deleteCollections(workspaceId, ids);
  await db.workbook.delete({ where: { id: workbook.id } });

  /*
   * 見るものが1つも無くなるダッシュボードを、一緒に片付けるかどうか。
   * 既定では消さない——利用者が作ったものなので、明示的に選ばれたときだけ。
   */
  const alsoDashboards =
    new URL(req.url).searchParams.get("dashboards") === "delete";
  const removedDashboards = alsoDashboards
    ? await deleteEmptiedDashboards(
        workspaceId,
        impact.emptiedDashboards.map((d) => d.id),
      )
    : 0;

  await logActivity(workspaceId, "collection.deleted", {
    workbookId: workbook.id,
    name: workbook.name,
    sheets: workbook.collections.map((c) => c.name),
    rows: impact.recordCount,
    dashboards: removedDashboards,
  });

  return ok({
    deleted: workbook.name,
    sheets: workbook.collections.length,
    rows: impact.recordCount,
    affectedDashboards: impact.affectedDashboards,
    removedDashboards,
  });
});
