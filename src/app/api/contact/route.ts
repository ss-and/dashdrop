/**
 * サイトからのお問い合わせ。POST { name, company, email, topic, message }。
 *
 * ## 設計の要点
 *
 * - **応答を待たせない。** 送信は `after()` に回す。SMTP が詰まると
 *   nodemailer の上限（接続10秒・挨拶10秒・通信15秒）ぶん待たされ、
 *   書き終えた人が最大25秒 白い画面を見ることになる。サインアップで
 *   同じ穴を踏んでいる（src/app/api/auth/signup/route.ts）。
 * - **送れなかったことを利用者のせいにしない。** 送信手段が無いときは、
 *   受け付けたふりをせず、その場で別の連絡先を出す。「送った」と言って
 *   届いていないのが一番悪い。
 * - **控えに本文を載せない。** 載せると、送信元を詐称した第三者宛の
 *   迷惑メール送信に使われうる（src/lib/email.ts の contactAckMail）。
 * - **上限を置く。** 守るのは受信箱。埋まると本物の問い合わせが埋もれる。
 */
import { ZodError, z } from "zod";
import { after } from "next/server";
import { ok, fail } from "@/lib/api";
import {
  sendMail,
  emailConfigured,
  contactNoticeMail,
  contactAckMail,
} from "@/lib/email";
import { CONTACT_EMAIL } from "@/lib/legal";
import { reportError } from "@/lib/observability";
import { consumeOptional, ipKey, retryMessage, CONTACT_RULE } from "@/lib/rate-limit";
import { CONTACT_TOPICS } from "@/lib/contact-topics";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(1, "お名前をご記入ください").max(80),
  company: z.string().trim().max(120).optional().default(""),
  email: z.string().trim().toLowerCase().email("メールアドレスの形式が正しくありません"),
  topic: z.enum(CONTACT_TOPICS),
  /*
   * 下限を置くのは、誤送信を防ぐため。「テスト」の2文字だけで送られると、
   * 運営者は返信の宛先も用件も分からないまま1通を読むことになる。
   */
  message: z.string().trim().min(10, "お問い合わせ内容を10文字以上でご記入ください").max(4000),
});

const RECEIVED =
  "お問い合わせを受け付けました。2営業日以内に、ご記入のメールアドレス宛にご返信いたします。";

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail("リクエストの形式が正しくありません", 400);
    }

    const input = schema.parse(body);

    const limit = await consumeOptional(ipKey(req, "contact"), CONTACT_RULE);
    if (!limit.allowed) {
      return fail(
        `お問い合わせの送信が続いています。${retryMessage(limit.retryAt)}`,
        429,
      );
    }

    /*
     * 送る手段が無いなら、受け付けたふりをしない。
     * ここで 200 を返すと、書いた人は届いたと思って待ち続ける。
     */
    if (!emailConfigured()) {
      return fail(
        `ただいまフォームからの送信ができません。こちらの不具合です。お手数ですが ${CONTACT_EMAIL} 宛に直接お送りください。`,
        503,
      );
    }

    after(async () => {
      try {
        const notice = await sendMail({
          to: CONTACT_EMAIL,
          ...contactNoticeMail(input),
        });
        if (!notice.ok) {
          // 届かなかったのは運営者の側。書いた人には既に受付を返している。
          reportError(new Error("Contact notice mail failed"), {
            where: "api:/api/contact",
            extra: { topic: input.topic },
          });
        }
        // 控えは best-effort。落ちても本体（運営者への通知）には影響しない。
        await sendMail({ to: input.email, ...contactAckMail(input.name) });
      } catch (err) {
        reportError(err, { where: "api:/api/contact" });
      }
    });

    return ok({ message: RECEIVED });
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0]?.message ?? "入力内容をご確認ください";
      return fail(first, 422, { issues: err.flatten().fieldErrors });
    }
    reportError(err, { where: "api:/api/contact" });
    return fail("送信に失敗しました。しばらくして再度お試しください。", 500);
  }
}
