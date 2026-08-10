/**
 * Route Handler helpers: consistent JSON envelopes, auth guarding, and
 * per-request access to the caller's user + workspace. Every API route should
 * go through `withAuth` so tenant isolation is enforced in one place.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSession, type CurrentUser } from "./auth";

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(
  message: string,
  status = 400,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type Handler = (
  req: Request,
  ctx: { user: CurrentUser; params: Record<string, string> },
) => Promise<NextResponse> | NextResponse;

/**
 * Wrap a Route Handler so it only runs for authenticated users. The handler
 * receives the resolved `user` (with primary workspace) and route params.
 * Any thrown ApiError/ZodError is turned into a clean JSON error.
 */
export function withAuth(handler: Handler) {
  return async (
    req: Request,
    context: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    let user: CurrentUser | null;
    try {
      user = await getSession();
    } catch {
      return fail("Authentication failed", 401);
    }
    if (!user) return fail("Not authenticated", 401);

    const params = context?.params ? await context.params : {};

    try {
      return await handler(req, { user, params });
    } catch (err) {
      if (err instanceof ApiError) return fail(err.message, err.status);
      if (err instanceof ZodError) {
        // Surface the first concrete reason so the user knows what to fix.
        const first = err.issues[0];
        const path = first?.path?.filter((p) => p !== "data").join(".");
        const reason = first?.message ?? "入力内容が正しくありません";
        return fail(path ? `${path}: ${reason}` : reason, 422, {
          issues: err.flatten().fieldErrors,
        });
      }
      console.error("Unhandled API error:", err);
      return fail(
        "サーバーでエラーが発生しました。しばらくして再度お試しください。",
        500,
      );
    }
  };
}

/** Parse and validate a JSON body with a Zod schema, throwing ApiError on failure. */
export async function readJson<T>(
  req: Request,
  schema: { parse: (v: unknown) => T },
): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError("Invalid JSON body", 400);
  }
  return schema.parse(body);
}
