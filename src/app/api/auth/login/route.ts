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

// A valid cost-12 bcrypt hash of a throwaway string. When the email doesn't
// exist we still run a comparison against this so the response time matches the
// "wrong password" path — preventing user-enumeration via timing.
const DUMMY_HASH = "$2a$12$xZrwqwBSJd/3pGc6sIUFUeu.3y0YQ4gPkewpcKvRM6s5PcMgrAW8W";

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

    // Always run a bcrypt comparison (against a dummy hash when the user is
    // missing) so both failure paths take the same time — no timing oracle.
    const passwordOk = await verifyPassword(
      password,
      user?.passwordHash ?? DUMMY_HASH,
    );
    if (!user || !passwordOk) {
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
