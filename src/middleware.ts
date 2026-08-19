import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Edge middleware: gate protected routes on a valid session JWT.
 *
 * Runs in the Edge runtime, so it must NOT import @/lib/auth, Prisma, or any
 * Node-only module. The JWT is verified inline with jose — the same HS256
 * secret the session layer signs with. We only check validity here; the full
 * user/workspace is resolved server-side by getSession().
 */

const SESSION_COOKIE = "dashdrop_session";

const PROTECTED_PREFIXES = [
  "/home",
  "/dashboard",
  "/dashboards",
  "/c", // spreadsheet grid
  "/r", // record detail
  "/f", // file (workbook) overview
  "/d", // dashboard renderer
  "/import",
  "/alerts",
  "/reports",
  "/settings",
  "/samples",
  "/logs",
];
const AUTH_PAGES = ["/login", "/signup"];

async function hasValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
    await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = await hasValidSession(token);

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAuthPage = AUTH_PAGES.includes(pathname);

  // Unauthenticated user hitting a protected route -> login (with return path).
  if (isProtected && !valid) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Already-authenticated user hitting login/signup -> straight to Home.
  if (isAuthPage && valid) {
    const url = req.nextUrl.clone();
    url.pathname = "/home";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

/**
 * matcher は PROTECTED_PREFIXES と必ず一致させること。
 *
 * 以前はここに 6 本しか無く、`/home` `/dashboards` `/r` `/f` `/d` `/alerts`
 * `/reports` ではミドルウェアが一度も動いていなかった。今は (app) グループの
 * layout が getSession() で守っているので実害は無かったが、「このリストに
 * 書いてあるから守られている」と読める状態のまま、グループ外にページを
 * 1 枚足した瞬間に認証なしで公開される。多層防御が黙って抜けている状態を
 * 残さない。
 *
 * 公開したままにするもの（意図的にここへ入れない）:
 *   /                     … LP
 *   /pricing              … 料金
 *   /share/d/[token]      … 共有リンク。ログイン不要で開けるのが仕様
 *   /api/**               … withAuth と CRON_SECRET が個別に守る
 */
export const config = {
  matcher: [
    "/home/:path*",
    "/dashboard/:path*",
    "/dashboards/:path*",
    "/c/:path*",
    "/r/:path*",
    "/f/:path*",
    "/d/:path*",
    "/import/:path*",
    "/samples/:path*",
    "/logs/:path*",
    "/alerts/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/login",
    "/signup",
  ],
};
