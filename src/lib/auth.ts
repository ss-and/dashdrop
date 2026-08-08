/**
 * Authentication & session core.
 *
 * - Passwords hashed with bcrypt.
 * - Sessions are stateless JWTs (jose) stored in an httpOnly, SameSite=Lax,
 *   Secure-in-prod cookie.
 * - `getSession()` reads and verifies the cookie on the server.
 *
 * The JWT carries only the userId; everything else is loaded from the DB so
 * revocation/role changes take effect immediately.
 */
import "server-only";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "./env";
import { db } from "./db";

export const SESSION_COOKIE = "dashdrop_session";

const secretKey = new TextEncoder().encode(env.AUTH_SECRET);

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface SessionPayload {
  userId: string;
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${env.SESSION_MAX_AGE}s`)
    .sign(secretKey);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });
    if (typeof payload.userId === "string") {
      return { userId: payload.userId };
    }
    return null;
  } catch {
    return null;
  }
}

/** Write the session cookie (call from a Server Action / Route Handler). */
export async function setSessionCookie(userId: string): Promise<void> {
  const token = await createSessionToken(userId);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: env.SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    role: string;
  };
}

/**
 * Resolve the current authenticated user and their primary workspace.
 * Returns null when unauthenticated. Cached per-request would be ideal;
 * kept simple here.
 */
export async function getSession(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const user = await db.user.findUnique({
    where: { id: payload.userId },
    include: {
      memberships: {
        include: { workspace: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  if (!user || user.memberships.length === 0) return null;

  const membership = user.memberships[0];
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    workspace: {
      id: membership.workspace.id,
      name: membership.workspace.name,
      slug: membership.workspace.slug,
      plan: membership.workspace.plan,
      role: membership.role,
    },
  };
}

/** Like getSession but throws — use inside guaranteed-protected handlers. */
export async function requireSession(): Promise<CurrentUser> {
  const session = await getSession();
  if (!session) throw new AuthError("Not authenticated");
  return session;
}

export class AuthError extends Error {}
