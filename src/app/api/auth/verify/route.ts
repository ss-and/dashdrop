/**
 * メールアドレスの確認。
 * GET /api/auth/verify?token=… → 確認して /home へ送る。
 *
 * メールの中のリンクは GET で開かれる。ここだけは画面遷移を返す。
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
    return to("/home?verify=invalid");
  }

  await db.user.update({
    where: { id: claimed.userId },
    data: { emailVerifiedAt: new Date() },
  });
  return to("/home?verify=done");
}
