/**
 * 「同じ名前のファイルが既に入っていないか」を引く、サーバ専用のヘルパ。
 *
 * /api/import/analyze が同じ問い合わせを持っており、/api/import/preview には
 * 無かった。そのせいで /import の画面は同名を知らず、毎回「新規追加」しか
 * できなかった（同じ台帳を毎月入れる人のファイルが増え続けていた）。
 * 返す形は analyze と**同じ**（src/lib/import-mode.ts の ExistingWorkbook）。
 *
 * db を import するのでサーバからのみ。画面側と共有したい型・文言は
 * src/lib/import-mode.ts に置いてある。
 */
import { db } from "./db";
import { workbookBaseName, type ExistingWorkbook } from "./import-mode";

/**
 * 同名のファイルのうち、いちばん新しいものを1つ返す。無ければ null。
 *
 * **workspaceId で必ず絞ること。** 名前だけで引くと、他社のブック名と
 * シート名・行数が「同名のファイルがあります」の形で見えてしまう。
 * ここは認証済みの利用者の workspace しか渡らない前提で、呼び出し側が
 * user.workspace.id 以外を渡さないこと。
 */
export async function findExistingWorkbook(
  workspaceId: string,
  fileName: string,
): Promise<ExistingWorkbook | null> {
  const fileBase = workbookBaseName(fileName);
  // 拡張子だけのファイル名など、名前が空になるものは照合しない
  // （空文字で引くと関係ないブックに当たりうる）。
  if (!fileBase) return null;

  const found = await db.workbook.findFirst({
    where: { workspaceId, name: fileBase },
    // 同名が複数あるときは最新のものが「入れ替えたい相手」。
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      collections: {
        orderBy: { position: "asc" },
        select: {
          name: true,
          slug: true,
          _count: { select: { records: true } },
        },
      },
    },
  });
  if (!found) return null;

  return {
    workbookId: found.id,
    name: found.name,
    importedAt: found.createdAt.toISOString(),
    sheets: found.collections.map((c) => ({
      name: c.name,
      slug: c.slug,
      rowCount: c._count.records,
    })),
  };
}
