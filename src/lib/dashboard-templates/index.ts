/**
 * Dashboard template registry. Aggregates every category file into one lookup.
 * Each category file exports a `<category>Templates: DashboardTemplate[]`.
 */
import type { DashboardTemplate } from "../widgets";
import { dashboardTemplateSchema } from "../widgets";
import { CATEGORIES, getCategory } from "./categories";
import { supportTemplates } from "./support";
import { salesTemplates } from "./sales";
import { billingTemplates } from "./billing";
import { financeTemplates } from "./finance";
import { hrTemplates } from "./hr";
import { marketingTemplates } from "./marketing";
import { operationsTemplates } from "./operations";
import { executiveTemplates } from "./executive";

export { CATEGORIES, getCategory };
export type { DashboardCategory } from "./categories";

const ALL: DashboardTemplate[] = [
  ...supportTemplates,
  ...salesTemplates,
  ...billingTemplates,
  ...financeTemplates,
  ...hrTemplates,
  ...marketingTemplates,
  ...operationsTemplates,
  ...executiveTemplates,
];

/** All templates, keeping only those that pass schema validation (defensive). */
export function getAllTemplates(): DashboardTemplate[] {
  return ALL.filter((t) => dashboardTemplateSchema.safeParse(t).success);
}

export function getTemplatesByCategory(categoryId: string): DashboardTemplate[] {
  return getAllTemplates().filter((t) => t.category === categoryId);
}

export function getTemplate(key: string): DashboardTemplate | undefined {
  return getAllTemplates().find((t) => t.key === key);
}

/** Count of valid templates per category id (for gallery badges). */
export function templateCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of getAllTemplates()) {
    counts[t.category] = (counts[t.category] ?? 0) + 1;
  }
  return counts;
}
