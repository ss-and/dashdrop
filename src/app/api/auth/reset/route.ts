/**
 * パスワードの再設定。
 * POST { token, password } → 200 / 400
 *
 * 成功したら、そのアカウントの再設定トークンをすべて無効にする。1通のメールが
 * 漏れていた場合に、変更後もそこから入れる状態を残さないため。
 */
import { ZodError, z } from "zod";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { consumeToken } from "@/lib/auth-tokens";

const schema = z.object({
  token: z.string().min(1, "再設定用のリンクが正しくありません"),
  password: z
    .string()
    .min(8, "パスワードは8文字以上にしてください")
    .max(200),
});

const INVALID =
  "この再設定リンクは無効か、有効期限が切れています。もう一度やり直してください。";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const { token, password } = schema.parse(body);

    const claimed = await consumeToken(token, "password_reset");
    if (!claimed) return fail(INVALID, 400);

    const passwordHash = await hashPassword(password);
    await db.$transaction([
      db.user.update({
        where: { id: claimed.userId },
        data: {
          passwordHash,
          /*
           * 再設定できた＝そのメールを受け取れる本人。ここで確認済みにする。
           * わざわざ確認メールをもう1通送らせる必要は無い。
           */
          emailVerifiedAt: new Date(),
        },
      }),
      // 残っている再設定トークンを全部閉じる。
      db.authToken.updateMany({
        where: { userId: claimed.userId, purpose: "password_reset", usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    // そのままログイン状態にする。変えた直後にもう一度入力させる意味がない。
    await setSessionCookie(claimed.userId);
    return ok({ redirect: "/home" });
  } catch (err) {
    if (err instanceof ZodError) {
      return fail(err.issues[0]?.message ?? "入力内容をご確認ください", 422);
    }
    console.error("Password reset failed:", err);
    return fail("処理に失敗しました。しばらくして再度お試しください。", 500);
  }
}
