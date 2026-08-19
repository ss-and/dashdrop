/**
 * Validate every registered dashboard template against the Zod schema, and
 * sanity-check each one by generating sample data and computing all its widgets.
 * Run with:  npx tsx scripts/validate-templates.ts
 */
import { getAllTemplates, CATEGORIES } from "../src/lib/dashboard-templates";
import { dashboardTemplateSchema } from "../src/lib/widgets";
import { generateSampleRows } from "../src/lib/sample-data";
import {
  computeDashboard,
  type AggCollection,
  type CollectionMap,
} from "../src/lib/aggregate";

let invalid = 0;
const all = getAllTemplates();
const byCat: Record<string, number> = {};

for (const t of all) {
  const parsed = dashboardTemplateSchema.safeParse(t);
  if (!parsed.success) {
    invalid++;
    console.log(`❌ ${t.key}:`, JSON.stringify(parsed.error.issues[0]));
    continue;
  }
  byCat[t.category] = (byCat[t.category] ?? 0) + 1;

  // Cross-check that every widget points at a collection this template owns.
  // The exhaustive field-key check (measure.field / groupBy / dateField /
  // columns / sort / filters) lives in tests/dashboard-templates.test.ts.
  const slugs = new Set(t.collections.map((c) => c.slug));
  for (const w of t.widgets) {
    if (!slugs.has(w.collection)) {
      invalid++;
      console.log(`❌ ${t.key}: widget "${w.id}" references unknown collection "${w.collection}"`);
    }
  }

  // Compute all widgets against generated sample data (must not throw).
  const map: CollectionMap = new Map();
  for (const c of t.collections) {
    const rows = generateSampleRows(c, Math.min(c.sampleRows, 40));
    const agg: AggCollection = {
      slug: c.slug,
      name: c.name,
      fields: c.fields.map((f) => ({ key: f.key, name: f.name, type: f.type, options: f.options ?? null })),
      records: rows.map((r, i) => ({ id: "r" + i, data: r.data, createdAt: r.createdAt })),
    };
    map.set(c.slug, agg);
  }
  try {
    computeDashboard(t.widgets, map);
  } catch (e) {
    invalid++;
    console.log(`❌ ${t.key}: compute threw`, e);
  }
}

console.log("\n— summary —");
for (const c of CATEGORIES) {
  console.log(`  ${c.id.padEnd(11)} ${byCat[c.id] ?? 0} templates`);
}
console.log(`\n${all.length} templates total, ${invalid} problem(s).`);
if (invalid > 0) process.exit(1);
