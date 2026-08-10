/**
 * Link-picker options for a relation field.
 * GET /api/collections/[id]/link-options?q=…
 *   -> { collectionName, displayFieldKey, options: [{ id, label }] }
 * `id` is the TARGET collection (the one being linked to). Tenant-scoped.
 */
import { withAuth, ok } from "@/lib/api";
import { getLinkOptions } from "@/lib/relations";

export const GET = withAuth(async (req, { user, params }) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const result = await getLinkOptions(user.workspace.id, params.id, q);
  return ok(result);
});
