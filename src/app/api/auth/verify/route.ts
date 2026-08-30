/**
 * メールアドレスの確認。
 * GET /api/auth/verify?token=… → 確認して /verified へ送る。
 *
 * メールの中のリンクは GET で開かれる。ここだけは画面遷移を返す。
 *
 * 【回帰】以前は `/home?verify=done` へ送っていたが、**その値を読む画面が
 * 1つも無かった**ので、成功も失敗も画面に出なかった。加えて `/home` は
 * 保護対象なので、メールをスマホで開いた人（その端末ではログインしていない）は
 * `/login?next=/home` へ弾かれ、結果はそこで消えていた。
 * 送り先をログイン不要のページにして、どちらの経路でも結果が出るようにする。
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { consumeToken } from "@/lib/auth-tokens";

function to(path: string): NextResponse {
  return NextResponse.redirect(`${env.APP_URL.replace(/\/$/, "")}${path}`);
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const claimed = await consumeToken(token, "email_verify");
  if (!claimed) {
    // 理由は分けない（無効・期限切れ・使用済みの区別は攻撃側にしか役立たない）。
    return to("/verified?ok=0");
  }

  await db.user.update({
    where: { id: claimed.userId },
    data: { emailVerifiedAt: new Date() },
  });
  return to("/verified?ok=1");
}
