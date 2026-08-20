/**
 * 確認メールの再送。
 * POST → 200
 *
 * ログイン済みの本人にしか送らないので、宛先はセッションから取る
 * （送信先を入力させると、他人のアドレスへ送りつける踏み台になる）。
 */
import { withAuth, ok, fail } from "@/lib/api";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { issueToken, EMAIL_VERIFY_TTL_HOURS } from "@/lib/auth-tokens";
import { sendMail, emailVerifyMail } from "@/lib/email";
import { consume, retryMessage, EMAIL_SEND_RULE } from "@/lib/rate-limit";

export const POST = withAuth(async (_req, { user }) => {
  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, emailVerifiedAt: true },
  });
  if (!row) return fail("アカウントが見つかりません。", 404);
  if (row.emailVerifiedAt) return ok({ alreadyVerified: true });

  const limit = await consume(`verify:${row.id}`, EMAIL_SEND_RULE);
  if (!limit.allowed) {
    return fail(`送信の回数が多すぎます。${retryMessage(limit.retryAt)}`, 429);
  }

  const { token } = await issueToken(row.id, "email_verify");
  const url = `${env.APP_URL.replace(/\/$/, "")}/api/auth/verify?token=${encodeURIComponent(token)}`;
  const res = await sendMail({
    to: row.email,
    ...emailVerifyMail(url, EMAIL_VERIFY_TTL_HOURS),
  });
  if (!res.ok) return fail(res.error, 502);
  return ok({ sent: true });
});
