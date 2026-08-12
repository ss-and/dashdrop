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
import { retailTemplates } from "./retail";
import { manufacturingTemplates } from "./manufacturing";
import { constructionTemplates } from "./construction";
import { restaurantTemplates } from "./restaurant";
import { logisticsTemplates } from "./logistics";
import { realestateTemplates } from "./realestate";
import { clinicTemplates } from "./clinic";
import { educationTemplates } from "./education";
import { projectTemplates } from "./project";

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
  ...retailTemplates,
  ...manufacturingTemplates,
  ...constructionTemplates,
  ...restaurantTemplates,
  ...logisticsTemplates,
  ...realestateTemplates,
  ...clinicTemplates,
  ...educationTemplates,
  ...projectTemplates,
];

/**
 * The raw, unfiltered template list — including any entry that would fail
 * schema validation. Exported so tests can assert that nothing is silently
 * dropped by `getAllTemplates()`. Application code should use
 * `getAllTemplates()` instead.
 */
export const ALL_TEMPLATES_RAW: readonly DashboardTemplate[] = ALL;

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
