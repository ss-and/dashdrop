/**
 * パスワード再設定の申し込み。
 * POST { email } → 常に 200。
 *
 * 「そのメールアドレスは登録されていません」と返してはいけない。誰が登録して
 * いるかを、ログインせずに総当たりで調べられてしまう（利用者名簿の流出と
 * 同じ意味を持つ）。登録の有無に関わらず同じ応答にする。
 */
import { ZodError, z } from "zod";
import { after } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { env } from "@/lib/env";
import { issueToken, PASSWORD_RESET_TTL_MIN } from "@/lib/auth-tokens";
import {
  sendMail,
  passwordResetMail,
  emailConfigured,
  MAIL_UNAVAILABLE,
} from "@/lib/email";
import { reportError } from "@/lib/observability";
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

    /*
     * 送信手段そのものが無いときは、**登録の有無を調べる前に**同じことを返す。
     *
     * 順序が肝。以前は「登録があった → 送信に失敗した → 502」という形だったので、
     * 登録済みのアドレスだけがエラーになり、**そのアドレスが登録済みかどうかを
     * 外から判定できた**（このファイルが ALWAYS で防ごうとしていた、まさにそれ）。
     * しかも利用者から見ると応答が逆で、本物の顧客だけがエラー画面に当たる。
     *
     * 送信手段の有無はアカウントと関係が無いので、ここで返すぶんには漏れない。
     */
    if (!emailConfigured()) {
      return ok({ message: MAIL_UNAVAILABLE });
    }

    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      /*
       * 送信は**応答を返してから**行う。理由が2つある。
       *
       * ① 名簿の漏れが、まだ「時間」の形で残っていた。
       *    ステータスコードは揃えたが、ここで待っていると
       *      登録済み  → 送信を待つ（nodemailer の上限は接続10秒・
       *                  挨拶10秒・通信15秒。詰まれば最大25秒）
       *      未登録    → 即座に 200
       *    となり、**応答時間そのものが名簿の答えになる**。
       *    同じ文面・同じコードでも、秒数で分かれば総当たりは成立する。
       *
       * ② 本物の顧客だけが待たされる。パスワードを忘れた人は既に困っている
       *    のに、そこで25秒固まる。押し直せば同じだけまた待つ。
       *
       * `after()` なら応答を返したあとで走るので、両方の枝が同じ速さで返る。
       * 送信の失敗は今までどおり運用者にだけ知らせる。
       */
      after(async () => {
        try {
          const { token } = await issueToken(user.id, "password_reset");
          const url = `${env.APP_URL.replace(/\/$/, "")}/reset?token=${encodeURIComponent(token)}`;
          const res = await sendMail({
            to: user.email,
            ...passwordResetMail(url, PASSWORD_RESET_TTL_MIN),
          });
          if (!res.ok) {
            /*
             * 設定はあるのに1通が落ちた場合。利用者には同じ文面が既に
             * 返っている。届かなかった人は ALWAYS の「数分待っても
             * 届かない場合は」に従うことになるので、**運用者にだけ**知らせる。
             */
            reportError(new Error("Password reset mail failed"), {
              where: "api:/api/auth/forgot",
            });
          }
        } catch (err) {
          reportError(err, { where: "api:/api/auth/forgot" });
        }
      });
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
