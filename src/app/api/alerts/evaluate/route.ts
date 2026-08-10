/**
 * Alert evaluation endpoint. Runs all enabled rules for the workspace now and
 * reports how many fired (edge-triggered, so it won't re-notify unchanged rules).
 */
import { withAuth, ok } from "@/lib/api";
import { evaluateWorkspaceAlerts } from "@/lib/alerts";

export const POST = withAuth(async (_req, { user }) => {
  const result = await evaluateWorkspaceAlerts(user.workspace.id);
  return ok(result);
});
