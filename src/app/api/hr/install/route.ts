/**
 * Install the HR core objects (部署 / 社員 / 勤怠 / 休暇申請 / 評価) into the
 * caller's workspace. POST { withSampleData?: boolean }
 *   → { created, skipped, seededRows }
 *
 * Idempotent: objects that already exist are reported in `skipped` rather than
 * duplicated, so the button is safe to press twice.
 */
import { z } from "zod";
import { withAuth, ok, readJson } from "@/lib/api";
import { installHr } from "@/lib/install-hr";
import { assertCapability } from "@/lib/workspace";

const bodySchema = z.object({ withSampleData: z.boolean().optional() });

export const POST = withAuth(async (req, { user }) => {
  // databases は有料プランの機能。判定は assertCapability に一本化する。
  assertCapability(user, "databases");
  const { withSampleData } = await readJson(req, bodySchema);
  const result = await installHr(user, { withSampleData });
  return ok(result);
});
