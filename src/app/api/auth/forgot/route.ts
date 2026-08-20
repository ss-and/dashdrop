/**
 * パスワード再設定の申し込み。
 * POST { email } → 常に 200。
 *
 * 「そのメールアドレスは登録されていません」と返してはいけない。誰が登録して
 * いるかを、ログインせずに総当たりで調べられてしまう（利用者名簿の流出と
 * 同じ意味を持つ）。登録の有無に関わらず同じ応答にする。
 */
import { ZodError, z } from "zod";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { env } from "@/lib/env";
import { issueToken, PASSWORD_RESET_TTL_MIN } from "@/lib/auth-tokens";
import { sendMail, passwordResetMail } from "@/lib/email";
import {
  consume,
  consumeOptional,
  ipKey,
  retryMessage,
  EMAIL_SEND_RULE,
} from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("メールアドレスの形式が正しくありません"),
});

/** 登録の有無に関わらず返す文面。 */
const ALWAYS = "ご登録のメールアドレス宛に、再設定のご案内をお送りしました。数分待っても届かない場合は、迷惑メールフォルダをご確認ください。";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const { email } = schema.parse(body);

    // メール爆撃に使われないよう、宛先とIPの両方で数える。
    const [byId, byIp] = await Promise.all([
      consume(`forgot:id:${email}`, EMAIL_SEND_RULE),
      consumeOptional(ipKey(req, "forgot"), EMAIL_SEND_RULE),
    ]);
    if (!byId.allowed || !byIp.allowed) {
      const retryAt = byId.retryAt ?? byIp.retryAt;
      return fail(`送信の回数が多すぎます。${retryMessage(retryAt)}`, 429);
    }

    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      const { token } = await issueToken(user.id, "password_reset");
      const url = `${env.APP_URL.replace(/\/$/, "")}/reset?token=${encodeURIComponent(token)}`;
      const res = await sendMail({ to: user.email, ...passwordResetMail(url, PASSWORD_RESET_TTL_MIN) });
      if (!res.ok) {
        /*
         * ここは伝える。送れていないのに「送りました」と言うと、利用者は
         * 届かないメールを待ち続けることになる。誰宛かは明かさないので、
         * 利用者名簿は漏れない。
         */
        console.error("Password reset mail failed for a user");
        return fail(res.error, 502);
      }
    }

    return ok({ message: ALWAYS });
  } catch (err) {
    if (err instanceof ZodError) {
      return fail("メールアドレスの形式が正しくありません", 422);
    }
    console.error("Forgot password failed:", err);
    return fail("処理に失敗しました。しばらくして再度お試しください。", 500);
  }
}
