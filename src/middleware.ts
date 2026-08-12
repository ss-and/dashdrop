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

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/c/:path*",
    "/import/:path*",
    "/settings/:path*",
    "/login",
    "/signup",
  ],
};
