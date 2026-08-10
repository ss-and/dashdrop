/**
 * Dashboard sharing.
 * POST   — enable a read-only public link (generates an unguessable token).
 * DELETE — revoke the link.
 * Tenant-scoped: only a dashboard in the caller's workspace can be shared.
 */
import { randomBytes } from "node:crypto";
import { withAuth, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

function shareUrl(token: string): string {
  return `${env.APP_URL.replace(/\/$/, "")}/share/d/${token}`;
}

export const POST = withAuth(async (_req, { user, params }) => {
  const dash = await db.dashboard.findFirst({
    where: { id: params.id, workspaceId: user.workspace.id },
    select: { id: true, shareToken: true },
  });
  if (!dash) throw new ApiError("ダッシュボードが見つかりません。", 404);

  const token = dash.shareToken ?? randomBytes(24).toString("base64url");
  if (!dash.shareToken) {
    await db.dashboard.update({
      where: { id: dash.id },
      data: { shareToken: token, sharedAt: new Date() },
    });
  }
  return ok({ shareToken: token, url: shareUrl(token) });
});

export const DELETE = withAuth(async (_req, { user, params }) => {
  const dash = await db.dashboard.findFirst({
    where: { id: params.id, workspaceId: user.workspace.id },
    select: { id: true },
  });
  if (!dash) throw new ApiError("ダッシュボードが見つかりません。", 404);

  await db.dashboard.update({
    where: { id: dash.id },
    data: { shareToken: null, sharedAt: null },
  });
  return ok({ revoked: true });
});
