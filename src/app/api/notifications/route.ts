/**
 * Notifications feed endpoint.
 * GET — latest 30 notifications for the workspace (newest first) + unread count.
 */
import { withAuth, ok } from "@/lib/api";
import { db } from "@/lib/db";

export const GET = withAuth(async (_req, { user }) => {
  const [notifications, unread] = await Promise.all([
    db.notification.findMany({
      where: { workspaceId: user.workspace.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.notification.count({
      where: { workspaceId: user.workspace.id, read: false },
    }),
  ]);

  return ok({ notifications, unread });
});
