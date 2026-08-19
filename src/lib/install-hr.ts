/**
 * Install the HR core (部署 / 社員 / 勤怠 / 休暇申請 / 評価) into a workspace.
 *
 * The sibling of `installCrm()`: where that makes DashDrop the master record
 * for customers, this makes it the master record for people. All of the
 * mechanics — creation order, relation wiring, demo-row seeding, rollback —
 * live in `installMasterObjects()`, so both master databases behave identically
 * and a fix to one is a fix to both.
 */
import { db } from "./db";
import {
  installMasterObjects,
  type InstallMasterResult,
} from "./install-master";
import { HR_OBJECTS } from "./hr-objects";
import type { CurrentUser } from "./auth";

export type InstallHrResult = InstallMasterResult;

export async function installHr(
  user: CurrentUser,
  opts: { withSampleData?: boolean } = {},
): Promise<InstallHrResult> {
  return installMasterObjects(user, HR_OBJECTS, {
    withSampleData: opts.withSampleData,
    source: "hr",
    label: "人事データベース",
  });
}

/**
 * Which HR objects a workspace currently has, as slug -> collection id.
 * Used by the home page / launcher to link straight to 社員・勤怠・休暇申請.
 */
export async function getHrCollections(workspaceId: string) {
  const rows = await db.collection.findMany({
    where: {
      workspaceId,
      slug: { in: HR_OBJECTS.map((o) => o.slug) },
    },
    select: { id: true, slug: true, name: true, icon: true },
  });
  return rows;
}
