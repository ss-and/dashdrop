import { ok } from "@/lib/api";
import { clearSessionCookie } from "@/lib/auth";

/** Clear the session cookie and point the client back to the login page. */
export async function POST() {
  await clearSessionCookie();
  return ok({ redirect: "/login" });
}
