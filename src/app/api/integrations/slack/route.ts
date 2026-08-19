/**
 * Per-workspace Slack connection.
 *
 * POST   — store an incoming-webhook URL for the caller's workspace.
 * DELETE — disconnect.
 * GET    — the (masked) status the settings screen renders.
 *
 * The webhook URL is a live credential: it is sealed before storage and only
 * ever returned masked. Nothing here echoes the raw value back to the client.
 */
import { z } from "zod";
import { withAuth, ok, readJson } from "@/lib/api";
import {
  saveIntegration,
  deleteIntegration,
  getIntegration,
  type IntegrationSummary,
} from "@/lib/integrations";

const connectSchema = z.object({
  webhookUrl: z.string().min(1, "Webhook URL を入力してください。"),
});

function notConnected(): IntegrationSummary {
  return {
    provider: "slack",
    connected: false,
    enabled: false,
    masked: null,
    config: {},
    lastOkAt: null,
    lastError: null,
  };
}

export const GET = withAuth(async (_req, { user }) => {
  const summary = await getIntegration(user.workspace.id, "slack");
  return ok(summary ?? notConnected());
});

export const POST = withAuth(async (req, { user }) => {
  const { webhookUrl } = await readJson(req, connectSchema);
  // validateSecret (inside saveIntegration) enforces https://hooks.slack.com,
  // which is what keeps this endpoint from becoming an SSRF gadget.
  const summary = await saveIntegration(user.workspace.id, "slack", webhookUrl);
  return ok(summary);
});

export const DELETE = withAuth(async (_req, { user }) => {
  await deleteIntegration(user.workspace.id, "slack");
  return ok({ ok: true });
});
