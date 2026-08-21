/**
 * 検索窓を開いた直後に出す「最近更新されたもの」。
 * GET /api/search/recent → { dashboards: [...], sheets: [...], files: [...] }
 *
 * 端末に履歴が無いとき（初めて使う人・別のPC）に、空の検索窓を見せないための
 * 受け皿。**「自分が見たもの」ではない**ので、画面では別の見出しで出す。
 *
 * 名前と更新時刻しか返さないので軽い。行数までは数えない——1打鍵ぶんの
 * 待ちも入れたくない場所で、`_count` を足すと結合が増えるだけの価値しかない。
 */
import { withAuth, ok } from "@/lib/api";
import { db } from "@/lib/db";

/** それぞれ何件出すか。合わせて9件、パネル1画面に収まる量。 */
const LIMIT = 3;

export const GET = withAuth(async (_req, { user }) => {
  const workspaceId = user.workspace.id;

  const [dashboards, sheets, files] = await Promise.all([
    db.dashboard.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
      select: { id: true, name: true },
    }),
    db.collection.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
      take: LIMIT,
      select: { id: true, name: true, icon: true },
    }),
    db.workbook.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: LIMIT,
      select: { id: true, name: true },
    }),
  ]);

  return ok({ dashboards, sheets, files });
});
