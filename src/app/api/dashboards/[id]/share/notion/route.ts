/**
 * Notionへ共有。
 * POST { parentPageId } → 選んだページの下に、要約1枚を作る。
 *
 * Notionに送る意味は「その時点の数字を残す」こと（Slackは流れて消える）。
 * なので日時を必ず書き、元のダッシュボードへのリンクも添える。
 */
import { z } from "zod";
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { getSecret, getIntegration, recordResult } from "@/lib/integrations";
import {
  createPage,
  headingBlock,
  paragraphBlock,
  bulletBlock,
  linkBlock,
  type NotionBlock,
} from "@/lib/notion";
import { breakdownLines, isEmptyDigest } from "@/lib/dashboard-digest";
import { loadShareSubject, stampedAt } from "../digest";

const bodySchema = z.object({
  parentPageId: z.string().min(1, "作成先のNotionページを選択してください。"),
});

export const POST = withAuth(async (req, { user, params }) => {
  const workspaceId = user.workspace.id;

  const integration = await getIntegration(workspaceId, "notion");
  if (!integration?.connected || !integration.enabled) {
    throw new ApiError(
      "Notionが接続されていません。設定 › 連携 でインテグレーショントークンを登録してください。",
      409,
    );
  }
  const token = await getSecret(workspaceId, "notion");
  if (!token) {
    throw new ApiError(
      "Notionのトークンを読み取れませんでした。設定 › 連携 で登録し直してください。",
      409,
    );
  }

  const { parentPageId } = await readJson(req, bodySchema);
  const subject = await loadShareSubject(workspaceId, params.id);

  const blocks: NotionBlock[] = [];
  if (subject.description) blocks.push(paragraphBlock(subject.description));
  blocks.push(paragraphBlock(`${stampedAt()} 時点のスナップショット`));
  blocks.push(linkBlock("DashDropで開く", subject.url));

  if (subject.digest.kpis.length > 0) {
    blocks.push(headingBlock("主要な数字", 2));
    for (const k of subject.digest.kpis) {
      blocks.push(bulletBlock(`${k.label}: ${k.value}`));
    }
  }
  for (const b of subject.digest.breakdowns) {
    blocks.push(headingBlock(b.title, 3));
    for (const line of breakdownLines(b)) blocks.push(bulletBlock(line));
  }
  if (isEmptyDigest(subject.digest)) {
    // 白紙のページを作って「共有しました」と言わない。
    blocks.push(
      paragraphBlock("このダッシュボードにはまだ集計できる数字がありません。"),
    );
  }

  let page: { id: string; url: string };
  try {
    page = await createPage(token, parentPageId, subject.name, blocks);
  } catch (err) {
    // 失敗も設定画面に残す。次に開いたときに理由が見えるように。
    await recordResult(
      workspaceId,
      "notion",
      false,
      err instanceof Error ? err.message : "ページの作成に失敗しました",
    );
    throw err;
  }
  await recordResult(workspaceId, "notion", true);

  return ok({
    delivered: "notion" as const,
    url: page.url,
    publicLink: subject.publicLink,
  });
});
