/**
 * Notion connection for one workspace.
 *
 *   GET    → masked status (never the token itself)
 *   POST   { token } → store an internal integration token
 *   DELETE → disconnect
 *
 * The token is sealed by `saveIntegration` (AES-256-GCM) before it touches the
 * database, and only ever leaves again as a mask like "ntn_…9f21".
 */
import { withAuth, ok, readJson } from "@/lib/api";
import { z } from "zod";
import {
  saveIntegration,
  deleteIntegration,
  getIntegration,
  type IntegrationSummary,
} from "@/lib/integrations";

const bodySchema = z.object({
  token: z.string().min(1, "Notionのトークンを入力してください。"),
});

/** What the settings card sees when nothing is connected yet. */
const DISCONNECTED: IntegrationSummary = {
  provider: "notion",
  connected: false,
  enabled: false,
  masked: null,
  config: {},
  lastOkAt: null,
  lastError: null,
};

export const GET = withAuth(async (_req, { user }) => {
  const summary = await getIntegration(user.workspace.id, "notion");
  return ok({ integration: summary ?? DISCONNECTED });
});

export const POST = withAuth(async (req, { user }) => {
  const { token } = await readJson(req, bodySchema);
  // validateSecret (inside saveIntegration) rejects anything that is not an
  // internal integration token before it is stored.
  const summary = await saveIntegration(user.workspace.id, "notion", token);
  return ok({ integration: summary });
});

export const DELETE = withAuth(async (_req, { user }) => {
  await deleteIntegration(user.workspace.id, "notion");
  return ok({ integration: DISCONNECTED });
});
