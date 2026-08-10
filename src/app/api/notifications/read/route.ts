/**
 * Mark notifications read.
 * POST { id? } — mark one (by id, scoped) read, or ALL unread when no id given.
 */
import { z } from "zod";
import { withAuth, ok } from "@/lib/api";
import { db } from "@/lib/db";

const readSchema = z.object({ id: z.string().min(1).optional() });

export const POST = withAuth(async (req, { user }) => {
  let id: string | undefined;
  try {
    const body = await req.json();
    id = readSchema.parse(body).id;
  } catch {
    // Empty / invalid body → treat as "mark all".
    id = undefined;
  }

  if (id) {
    await db.notification.updateMany({
      where: { id, workspaceId: user.workspace.id },
      data: { read: true },
    });
  } else {
    await db.notification.updateMany({
      where: { workspaceId: user.workspace.id, read: false },
      data: { read: true },
    });
  }

  return ok({ ok: true });
});
