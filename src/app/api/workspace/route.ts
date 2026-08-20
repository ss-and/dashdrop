/**
 * ワークスペースの設定。
 * PATCH { aiEnabled? } → 200
 *
 * いまのところ扱うのは AI の可否ひとつ。取り込み時に列名とサンプル値が
 * 外部（Anthropic）へ渡るので、社内規程で外に出せない会社が必ずある。
 */
import { z } from "zod";
import { withAuth, ok, readJson, ApiError } from "@/lib/api";
import { db } from "@/lib/db";

const schema = z.object({
  aiEnabled: z.boolean().optional(),
});

export const PATCH = withAuth(async (req, { user }) => {
  // 設定はワークスペース全体に効くので、所有者・管理者だけが変えられる。
  if (user.workspace.role !== "owner" && user.workspace.role !== "admin") {
    throw new ApiError("この設定を変更できるのは管理者のみです。", 403);
  }

  const input = await readJson(req, schema);
  const data: Record<string, unknown> = {};
  if (typeof input.aiEnabled === "boolean") data.aiEnabled = input.aiEnabled;
  if (Object.keys(data).length === 0) {
    throw new ApiError("変更する項目がありません。", 400);
  }

  const updated = await db.workspace.update({
    where: { id: user.workspace.id },
    data,
    select: { aiEnabled: true },
  });
  return ok(updated);
});
