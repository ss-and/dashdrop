/**
 * 共有できる先の一覧。
 * GET → { slack: {...}, notion: {...} }
 *
 * 共有ボタンを押した時点で、押せる先と押せない先が分かるようにするためのもの。
 * 押してから「接続されていません」と言われるより、最初から理由が見えている方が早い。
 */
import { withAuth, ok } from "@/lib/api";
import { listIntegrations, getSecret, readChannelHint } from "@/lib/integrations";
import { listPages } from "@/lib/notion";

export const GET = withAuth(async (_req, { user }) => {
  const workspaceId = user.workspace.id;
  const integrations = await listIntegrations(workspaceId);
  const slack = integrations.find((i) => i.provider === "slack");
  const notion = integrations.find((i) => i.provider === "notion");

  const notionReady = Boolean(notion?.connected && notion.enabled);

  /*
   * Notionは「どのページの下に作るか」を選ばないと送れない。接続済みのときだけ
   * 候補を取りに行く。ここでNotionが落ちても共有ボタン自体は開けるべきなので、
   * 失敗は空一覧として扱い、理由を添える。
   */
  let pages: Array<{ id: string; title: string }> = [];
  let notionError: string | null = null;
  if (notionReady) {
    try {
      const token = await getSecret(workspaceId, "notion");
      if (token) {
        pages = (await listPages(token)).map((p) => ({ id: p.id, title: p.title }));
      }
    } catch (err) {
      notionError =
        err instanceof Error
          ? err.message
          : "Notionのページ一覧を取得できませんでした。";
    }
  }

  return ok({
    slack: {
      connected: Boolean(slack?.connected && slack.enabled),
      hint: slack ? readChannelHint(slack.config) : null,
    },
    notion: {
      connected: notionReady,
      pages,
      error: notionError,
    },
  });
});
