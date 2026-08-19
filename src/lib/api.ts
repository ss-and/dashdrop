/**
 * Route Handler helpers: consistent JSON envelopes, auth guarding, and
 * per-request access to the caller's user + workspace. Every API route should
 * go through `withAuth` so tenant isolation is enforced in one place.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { installJapaneseZodMessages, fieldLabelForPath } from "./zod-ja";

// すべてのAPIルートがこのモジュールを通るので、ここで一度だけ差し替えれば
// アプリ全体の入力エラーが日本語になる。
installJapaneseZodMessages();
import { getSession, type CurrentUser } from "./auth";
import { ApiError } from "./errors";

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

// Defined in ./errors (framework-free) and re-exported here so every existing
// `import { ApiError } from "@/lib/api"` keeps working.
export { ApiError } from "./errors";

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
      return fail("ログインの確認に失敗しました。もう一度ログインしてください。", 401);
    }
    if (!user) return fail("ログインが必要です。もう一度ログインしてください。", 401);

    const params = context?.params ? await context.params : {};

    try {
      return await handler(req, { user, params });
    } catch (err) {
      if (err instanceof ApiError) return fail(err.message, err.status);
      if (err instanceof ZodError) {
        // Surface the first concrete reason so the user knows what to fix.
        const first = err.issues[0];
        const reason = first?.message ?? "入力内容が正しくありません";
        // 見出しは日本語に訳せるものだけ付ける。内部キー（`collectionId` など）を
        // そのまま出すと、日本語の文面の中でそこだけ英語になってしまう。
        const label = first ? fieldLabelForPath(first.path) : null;
        return fail(label ? `${label}: ${reason}` : reason, 422, {
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
    throw new ApiError(
      "送信内容を読み取れませんでした。入力をご確認のうえ、もう一度お試しください。",
      400,
    );
  }
  return schema.parse(body);
}
