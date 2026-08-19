/**
 * GET /api/integrations/notion/databases
 *
 * The databases this workspace's Notion token can see. Notion only returns
 * pages that were explicitly shared with the integration, so an empty list is a
 * normal (and very common) outcome — the message says what to do about it.
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { getSecret, recordResult } from "@/lib/integrations";
import { listDatabases } from "@/lib/notion";

// Next.js のルートファイルは決められた名前しか export できないため、
// ここは export しないこと（export するとビルドが落ちる）。
const NOT_CONNECTED =
  "Notionが接続されていません。設定画面でインテグレーション トークンを登録してください。";

export const GET = withAuth(async (_req, { user }) => {
  const token = await getSecret(user.workspace.id, "notion");
  if (!token) throw new ApiError(NOT_CONNECTED, 400);

  try {
    const databases = await listDatabases(token);
    await recordResult(user.workspace.id, "notion", true);
    return ok({ databases });
  } catch (err) {
    const message =
      err instanceof ApiError
        ? err.message
        : "Notionとの通信に失敗しました。";
    await recordResult(user.workspace.id, "notion", false, message);
    throw err instanceof ApiError ? err : new ApiError(message, 502);
  }
});
