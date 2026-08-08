import { ZodError } from "zod";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { verifyPassword, setSessionCookie } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";

/**
 * Pre-auth login endpoint. Verifies credentials and issues a session cookie.
 * Failures return a single generic 401 so we never reveal whether an email is
 * registered. Plain handler (no withAuth — the caller isn't authenticated yet).
 */

const GENERIC_401 = "メールアドレスまたはパスワードが正しくありません";

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail("リクエストの形式が正しくありません", 400);
    }

    const { email, password } = loginSchema.parse(body);

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Generic failure whether the user is missing OR the password is wrong.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return fail(GENERIC_401, 401);
    }

    // A user without a membership still authenticates; the session layer will
    // resolve their workspace later (or surface an appropriate empty state).
    await setSessionCookie(user.id);
    return ok({ redirect: "/dashboard" });
  } catch (err) {
    if (err instanceof ZodError) {
      return fail(GENERIC_401, 401);
    }
    console.error("Login failed:", err);
    return fail("ログインに失敗しました。しばらくして再度お試しください。", 500);
  }
}
