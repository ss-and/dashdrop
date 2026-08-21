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
import { assertCapability } from "@/lib/workspace";

const bodySchema = z.object({ withSampleData: z.boolean().optional() });

export const POST = withAuth(async (req, { user }) => {
  // databases は有料プランの機能。判定は assertCapability に一本化する。
  assertCapability(user, "databases");
  const { withSampleData } = await readJson(req, bodySchema);
  const result = await installCrm(user, { withSampleData });
  return ok(result);
});
