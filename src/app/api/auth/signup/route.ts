import { ZodError } from "zod";
import { after } from "next/server";
import { db, toJson } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { signupSchema } from "@/lib/validation";
import { slugify } from "@/lib/utils";
import { TEMPLATES, type CollectionTemplate } from "@/lib/templates";
import { logActivity } from "@/lib/workspace";
import { env } from "@/lib/env";
import { issueToken, EMAIL_VERIFY_TTL_HOURS } from "@/lib/auth-tokens";
import { sendMail, emailVerifyMail, emailConfigured } from "@/lib/email";
import {
  consumeOptional,
  ipKey,
  retryMessage,
  SIGNUP_RULE,
} from "@/lib/rate-limit";
import { installCrm } from "@/lib/install-crm";
import type { Prisma } from "@prisma/client";
import { can } from "@/lib/plans";
import { reportError } from "@/lib/observability";

/**
 * Pre-auth signup endpoint. Creates the User, their first Workspace + owner
 * Membership, and bootstraps the workspace with the two built-in template
 * collections so a fresh account is never empty. Plain handler (no withAuth,
 * since the caller is not yet authenticated).
 */

/** Find a globally-unique workspace slug derived from `name`. */
async function uniqueWorkspaceSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let n = 2;
  // Workspace.slug is globally unique — loop until we find a free one.
  while (await db.workspace.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

/** Seed one template collection (with its fields) inside a transaction. */
async function createTemplateCollection(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  slug: string,
  position: number,
  template: CollectionTemplate,
): Promise<void> {
  await tx.collection.create({
    data: {
      workspaceId,
      name: template.name,
      slug,
      description: template.description,
      icon: template.icon,
      color: template.color,
      template: template.id,
      position,
      fields: {
        create: template.fields.map((f, i) => ({
          key: f.key,
          name: f.name,
          type: f.type,
          required: f.required ?? false,
          options: f.options ? toJson(f.options) : undefined,
          position: i,
        })),
      },
    },
  });
}

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail("リクエストの形式が正しくありません", 400);
    }

    const input = signupSchema.parse(body);

    /*
     * 1つのIPからの大量作成を止める。捨てアドで無限にワークスペースを
     * 作られると、無料枠の計算も、あとで消す手間も成り立たなくなる。
     */
    const limit = await consumeOptional(ipKey(req, "signup"), SIGNUP_RULE);
    if (!limit.allowed) {
      return fail(
        `登録の試行回数が多すぎます。${retryMessage(limit.retryAt)}`,
        429,
      );
    }
    // Schema already lowercases, but be explicit and defensive.
    const email = input.email.toLowerCase();

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return fail("このメールアドレスは既に登録されています", 409);
    }

    const passwordHash = await hashPassword(input.password);
    const workspaceName =
      input.workspaceName?.trim() || `${input.name}のワークスペース`;
    const slug = await uniqueWorkspaceSlug(workspaceName);

    const { user, workspaceId } = await db.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { email, name: input.name, passwordHash },
      });

      const workspace = await tx.workspace.create({
        data: { name: workspaceName, slug, plan: "free" },
      });

      await tx.membership.create({
        data: {
          userId: createdUser.id,
          workspaceId: workspace.id,
          role: "owner",
        },
      });

      // Bootstrap both built-in templates so the account starts populated.
      await createTemplateCollection(
        tx,
        workspace.id,
        "inquiries",
        0,
        TEMPLATES.inquiry,
      );
      await createTemplateCollection(
        tx,
        workspace.id,
        "tasks",
        1,
        TEMPLATES.task,
      );

      return { user: createdUser, workspaceId: workspace.id };
    });

    // Activity logging is best-effort and lives outside the transaction.
    await logActivity(workspaceId, "collection.created", {
      template: "inquiry",
    });
    await logActivity(workspaceId, "collection.created", { template: "task" });

    /*
     * 顧客データベースは有料プランの機能なので、登録直後には入れない。
     *
     * 以前は必ず入れていた。Free の約束を「Excelを1つ置いたらダッシュボードが
     * 出る」に絞った以上、登録した瞬間に顧客・担当者・商談・請求書・活動の
     * 5つが並ぶのは、その約束と食い違う——しかも全部0件で並ぶ。
     * （制限を効かせていない間は今までどおり入る。src/lib/plans.ts）
     */
    if (can("free", "databases")) {
      try {
        await installCrm(
          {
            id: user.id,
            email,
            name: input.name,
            emailVerified: true,
            workspace: {
              id: workspaceId,
              name: workspaceName,
              slug,
              plan: "free",
              role: "owner",
              aiEnabled: true,
            },
          },
          { withSampleData: false },
        );
      } catch (err) {
        // 失敗しても登録自体は止めない（サイドバーの「追加」から作れる）。
        console.error("CRM bootstrap failed for new workspace:", err);
      }
    }

    await setSessionCookie(user.id);

    /*
     * 確認メール。送れなくても登録は止めない——SMTP が未設定の環境でも
     * 使い始められる方が良く、未確認でも中は使えるようにしてある
     * （止めるのは公開リンクの作成だけ）。
     *
     * ## なぜ応答を返してから送るのか
     *
     * 以前はここで `await` していた。SMTP が健康なら数百ミリ秒なので、
     * 手元でも少人数でも気づかない。気づくのは**向こうが遅いとき**で、
     * nodemailer の待ち時間は接続10秒・挨拶10秒・通信15秒（src/lib/email.ts）。
     * つまり送信側が詰まると、**登録した人は最大25秒、白い画面を見る**。
     * アカウントもワークスペースもとっくにできているのに、本人には
     * 「固まった」としか見えないので、たいてい途中で再読み込みして
     * もう一度登録し、今度は「既に登録されています」と言われる。
     *
     * 1,000人が同じ日に登録する状況で、送信元が少しでも詰まれば全員が踏む。
     * `after()` は応答を返したあとで走る（Vercel が関数を生かしておく）ので、
     * 待ち時間は利用者から見えなくなる。
     *
     * ## なぜ戻り値を見るのか
     *
     * `sendMail` は失敗しても**例外を投げず** `{ ok: false }` を返す。
     * 以前は戻り値を捨てていたので try/catch には何も入らず、
     * **送れていないのに証跡が1行も残らなかった**。運用者が気づく手段が
     * 「お客さまに言われる」しか無い状態だった。
     */
    if (emailConfigured()) {
      after(async () => {
        try {
          const { token } = await issueToken(user.id, "email_verify");
          const url = `${env.APP_URL.replace(/\/$/, "")}/api/auth/verify?token=${encodeURIComponent(token)}`;
          const res = await sendMail({
            to: email,
            ...emailVerifyMail(url, EMAIL_VERIFY_TTL_HOURS),
          });
          if (!res.ok) {
            // 宛先そのものは載せない（監視の宛先に個人情報を流さない）。
            reportError(new Error("Verification mail failed for new user"), {
              where: "api:/api/auth/signup",
            });
          }
        } catch (err) {
          reportError(err, { where: "api:/api/auth/signup" });
        }
      });
    }

    return ok({ redirect: "/home" });
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0]?.message ?? "入力内容を確認してください";
      return fail(first, 422, { issues: err.flatten().fieldErrors });
    }
    console.error("Signup failed:", err);
    return fail(
      "アカウントの作成に失敗しました。しばらくして再度お試しください。",
      500,
    );
  }
}
