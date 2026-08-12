/**
 * Install the CRM core objects (顧客 / 担当者 / 商談 / 活動) into the caller's
 * workspace. POST { withSampleData?: boolean } → { created, skipped, seededRows }
 *
 * Idempotent: objects that already exist are reported in `skipped` rather than
 * duplicated, so the button is safe to press twice.
 */
import { z } from "zod";
import { withAuth, ok, readJson } from "@/lib/api";
import { installCrm } from "@/lib/install-crm";

const bodySchema = z.object({ withSampleData: z.boolean().optional() });

export const POST = withAuth(async (req, { user }) => {
  const { withSampleData } = await readJson(req, bodySchema);
  const result = await installCrm(user, { withSampleData });
  return ok(result);
});
