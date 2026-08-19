/**
 * Install the CRM core (顧客 / 担当者 / 商談 / 請求書 / 活動) into a workspace.
 *
 * This is what makes DashDrop the *master* database: the objects are created as
 * real Collections with typed Fields and resolved relations, then optionally
 * seeded with demo rows whose links are wired to actual record ids. Imported
 * spreadsheets stay untouched alongside them.
 *
 * All of the mechanics live in `installMasterObjects()`, shared with the HR
 * database, so both behave identically and a fix to one is a fix to both.
 */
import { db } from "./db";
import {
  installMasterObjects,
  type InstallMasterResult,
} from "./install-master";
import { CRM_OBJECTS } from "./crm-objects";
import type { CurrentUser } from "./auth";

export type InstallCrmResult = InstallMasterResult;

export async function installCrm(
  user: CurrentUser,
  opts: { withSampleData?: boolean } = {},
): Promise<InstallCrmResult> {
  return installMasterObjects(user, CRM_OBJECTS, {
    withSampleData: opts.withSampleData,
    source: "crm",
    label: "顧客データベース",
  });
}

/**
 * Which CRM objects a workspace currently has, as slug -> collection id.
 * Used by the home page / launcher to link straight to 顧客・商談・担当者.
 */
export async function getCrmCollections(workspaceId: string) {
  const rows = await db.collection.findMany({
    where: {
      workspaceId,
      slug: { in: CRM_OBJECTS.map((o) => o.slug) },
    },
    select: { id: true, slug: true, name: true, icon: true },
  });
  return rows;
}
