/**
 * アカウントの削除（退会）。
 * DELETE { confirm } → 200
 *
 * 個人情報保護法の観点で「消してくれ」に応えられる経路が無いのは、公開前に
 * 塞いでおく必要がある。ここで消すのは:
 *   - 自分だけが所有者のワークスペース（＝中のデータ全部）
 *   - 自分のアカウントと所属
 *
 * 他にも所有者がいるワークスペースは**消さない**。自分が抜けるだけにする。
 * 一人が辞めた拍子に、他の人が使っている場所ごと消えるのは事故でしかない。
 */
import { z } from "zod";
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { clearSessionCookie } from "@/lib/auth";
import { ACCOUNT_DELETE_PHRASE } from "@/lib/account";

const schema = z.object({
  /** 確認のために打ってもらう文字列。取り違えて消せないようにする。 */
  confirm: z.string(),
});

/*
 * 打ってもらう合言葉。画面（DangerZone）にも同じ文字列を出す。
 * ルートファイルからは HTTP ハンドラ以外を export できない（Next の型検査で
 * 弾かれる）ので、共有したい定数は lib 側に置く。
 */
const CONFIRM_PHRASE = ACCOUNT_DELETE_PHRASE;

export const DELETE = withAuth(async (req, { user }) => {
  const { confirm } = await readJson(req, schema);
  if (confirm.trim() !== CONFIRM_PHRASE) {
    throw new ApiError(
      `確認のため「${CONFIRM_PHRASE}」と入力してください。`,
      400,
    );
  }

  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    select: { id: true, role: true, workspaceId: true },
  });

  /*
   * 自分だけが所有者のワークスペースを見つける。
   * 他に所有者がいるなら、その場所は残して自分が抜けるだけ。
   */
  const soleOwned: string[] = [];
  for (const m of memberships) {
    if (m.role !== "owner") continue;
    const otherOwners = await db.membership.count({
      where: {
        workspaceId: m.workspaceId,
        role: "owner",
        userId: { not: user.id },
      },
    });
    if (otherOwners === 0) soleOwned.push(m.workspaceId);
  }

  /*
   * 順序に意味がある。ワークスペースを先に消すと、その中のコレクション・
   * ダッシュボード・連携情報がカスケードで消える。利用者を先に消すと
   * Membership だけが消えて、ワークスペースは持ち主のいないまま残る。
   */
  await db.$transaction([
    ...(soleOwned.length > 0
      ? [db.workspace.deleteMany({ where: { id: { in: soleOwned } } })]
      : []),
    db.user.delete({ where: { id: user.id } }),
  ]);

  await clearSessionCookie();

  return ok({
    deletedWorkspaces: soleOwned.length,
    // 他に所有者がいて残した場所の数。何が残ったかを黙らない。
    leftWorkspaces: memberships.length - soleOwned.length,
  });
});
