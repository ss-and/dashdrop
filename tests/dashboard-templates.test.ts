import { describe, it, expect } from "vitest";
import {
  ALL_TEMPLATES_RAW,
  CATEGORIES,
  getAllTemplates,
  getCategory,
  getTemplate,
  getTemplatesByCategory,
  templateCounts,
} from "@/lib/dashboard-templates";
import {
  dashboardTemplateSchema,
  type DashboardTemplate,
  type Filter,
  type WidgetSpec,
} from "@/lib/widgets";
import { FIELD_TYPES } from "@/lib/field-types";

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

/** Every field key referenced by a widget, paired with where it came from. */
function fieldRefs(w: WidgetSpec): Array<{ key: string; where: string }> {
  const refs: Array<{ key: string; where: string }> = [];
  const pushFilters = (filters: Filter[] | undefined, where: string) => {
    for (const f of filters ?? []) refs.push({ key: f.field, where });
  };

  pushFilters(w.filters, "filters");

  switch (w.type) {
    case "kpi": {
      if (w.measure.kind !== "count") {
        refs.push({ key: w.measure.field, where: "measure" });
      }
      pushFilters(w.rateNumerator, "rateNumerator");
      if (w.delta?.dateField) {
        refs.push({ key: w.delta.dateField, where: "delta.dateField" });
      }
      break;
    }
    case "line":
    case "area":
    case "bar": {
      if (w.dateField) refs.push({ key: w.dateField, where: "dateField" });
      for (const m of w.measures) {
        if (m.measure.kind !== "count") {
          refs.push({ key: m.measure.field, where: `measures[${m.label}]` });
        }
        pushFilters(m.filters, `measures[${m.label}].filters`);
      }
      break;
    }
    case "donut":
    case "hbar": {
      refs.push({ key: w.groupBy, where: "groupBy" });
      if (w.measure.kind !== "count") {
        refs.push({ key: w.measure.field, where: "measure" });
      }
      break;
    }
    case "table": {
      for (const c of w.columns) refs.push({ key: c, where: "columns" });
      if (w.sort) refs.push({ key: w.sort.field, where: "sort.field" });
      break;
    }
  }
  return refs;
}

describe("dashboard template registry", () => {
  it("every raw template passes the schema (nothing is silently filtered)", () => {
    for (const t of ALL_TEMPLATES_RAW) {
      const parsed = dashboardTemplateSchema.safeParse(t);
      expect(
        parsed.success,
        `${(t as DashboardTemplate).key}: ${
          parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2)
        }`,
      ).toBe(true);
    }
    expect(getAllTemplates()).toHaveLength(ALL_TEMPLATES_RAW.length);
  });

  it("ships the full gallery", () => {
    expect(ALL_TEMPLATES_RAW.length).toBeGreaterThanOrEqual(46);
  });

  it("template keys are unique and kebab-case", () => {
    const keys = ALL_TEMPLATES_RAW.map((t) => t.key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes, `duplicate keys: ${dupes.join(", ")}`).toHaveLength(0);
    for (const k of keys) {
      expect(k, `${k} is not kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("categories are known ids and every category has templates", () => {
    for (const t of ALL_TEMPLATES_RAW) {
      expect(CATEGORY_IDS.has(t.category), `${t.key} → ${t.category}`).toBe(true);
    }
    for (const c of CATEGORIES) {
      expect(getTemplatesByCategory(c.id).length, `${c.id} has no templates`)
        .toBeGreaterThan(0);
      expect(getCategory(c.id)?.label).toBe(c.label);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.icon.length).toBeGreaterThan(0);
      expect(c.color.length).toBeGreaterThan(0);
    }
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
  });

  it("getTemplate(key) round-trips and templateCounts() sums to the total", () => {
    for (const t of ALL_TEMPLATES_RAW) {
      expect(getTemplate(t.key)?.key, t.key).toBe(t.key);
    }
    expect(getTemplate("does-not-exist")).toBeUndefined();
    const counts = templateCounts();
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(getAllTemplates().length);
  });
});

for (const template of ALL_TEMPLATES_RAW as DashboardTemplate[]) {
  describe(`${template.name} (${template.key})`, () => {
    const slugs = new Set(template.collections.map((c) => c.slug));
    const fieldsBySlug = new Map(
      template.collections.map((c) => [
        c.slug,
        new Map(c.fields.map((f) => [f.key, f])),
      ]),
    );

    it("has Japanese-facing metadata and a description", () => {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.icon.length).toBeGreaterThan(0);
      expect(template.color.length).toBeGreaterThan(0);
    });

    it("collections have unique slugs, unique field keys and valid types", () => {
      expect(slugs.size).toBe(template.collections.length);
      for (const c of template.collections) {
        expect(c.fields.length, `${c.slug} fields`).toBeGreaterThan(0);
        const keys = c.fields.map((f) => f.key);
        expect(new Set(keys).size, `${c.slug} duplicate field keys`).toBe(
          keys.length,
        );
        for (const f of c.fields) {
          expect(FIELD_TYPES, `${c.slug}.${f.key}`).toContain(f.type);
        }
        expect(c.sampleRows ?? 60).toBeGreaterThan(0);
      }
    });

    it("select fields carry options, and weights line up with them", () => {
      for (const c of template.collections) {
        for (const f of c.fields) {
          if (f.type !== "select" && f.type !== "multiselect") continue;
          expect(f.options?.length, `${c.slug}.${f.key} options`).toBeGreaterThan(0);
          const values = f.options!.map((o) => o.value);
          expect(
            new Set(values).size,
            `${c.slug}.${f.key} duplicate option values`,
          ).toBe(values.length);
          if (f.sample?.weights) {
            expect(
              f.sample.weights.length,
              `${c.slug}.${f.key} weights/options mismatch`,
            ).toBe(f.options!.length);
          }
        }
      }
    });

    it("widget ids are unique and every widget targets a real collection", () => {
      const ids = template.widgets.map((w) => w.id);
      expect(new Set(ids).size, `${template.key} duplicate widget ids`).toBe(
        ids.length,
      );
      for (const w of template.widgets) {
        expect(
          slugs.has(w.collection),
          `${template.key}.${w.id} → collection "${w.collection}"`,
        ).toBe(true);
      }
    });

    it("every referenced field key exists on the widget's collection", () => {
      for (const w of template.widgets) {
        const fields = fieldsBySlug.get(w.collection);
        expect(fields, `${template.key}.${w.id} collection missing`).toBeDefined();
        for (const ref of fieldRefs(w)) {
          expect(
            fields!.has(ref.key),
            `${template.key}.${w.id} (${ref.where}) → "${ref.key}" not on "${w.collection}"`,
          ).toBe(true);
        }
      }
    });

    it("date-bucketed widgets point at a real date field", () => {
      for (const w of template.widgets) {
        if (w.type !== "line" && w.type !== "area" && w.type !== "bar") continue;
        if (!w.dateField) continue;
        const f = fieldsBySlug.get(w.collection)!.get(w.dateField)!;
        expect(f.type, `${template.key}.${w.id} dateField ${w.dateField}`).toBe(
          "date",
        );
      }
      for (const w of template.widgets) {
        if (w.type !== "kpi" || !w.delta?.dateField) continue;
        const f = fieldsBySlug.get(w.collection)!.get(w.delta.dateField)!;
        expect(
          f.type,
          `${template.key}.${w.id} delta.dateField ${w.delta.dateField}`,
        ).toBe("date");
      }
    });

    it("numeric measures reference numeric fields", () => {
      const numeric = new Set(["number", "currency"]);
      for (const w of template.widgets) {
        const fields = fieldsBySlug.get(w.collection)!;
        const check = (key: string, where: string) => {
          const f = fields.get(key)!;
          expect(
            numeric.has(f.type),
            `${template.key}.${w.id} ${where} → ${key} is ${f.type}`,
          ).toBe(true);
        };
        if (w.type === "kpi" && w.measure.kind !== "count") {
          check(w.measure.field, "measure");
        }
        if (w.type === "donut" || w.type === "hbar") {
          if (w.measure.kind !== "count") check(w.measure.field, "measure");
        }
        if (w.type === "line" || w.type === "area" || w.type === "bar") {
          for (const m of w.measures) {
            if (m.measure.kind !== "count") check(m.measure.field, m.label);
          }
        }
      }
    });

    it("leads with KPI tiles and closes with a table", () => {
      const kpis = template.widgets.filter((w) => w.type === "kpi");
      expect(kpis.length, `${template.key} kpi tiles`).toBeGreaterThanOrEqual(3);
      for (const k of kpis) expect(k.span, `${template.key}.${k.id} span`).toBe(1);
      // The gallery convention: the KPI row comes first, one detail table last.
      const firstNonKpi = template.widgets.findIndex((w) => w.type !== "kpi");
      expect(firstNonKpi, `${template.key} starts with a KPI row`)
        .toBeGreaterThanOrEqual(3);
      const tables = template.widgets.filter((w) => w.type === "table");
      expect(tables.length, `${template.key} table count`).toBe(1);
      expect(
        template.widgets[template.widgets.length - 1].type,
        `${template.key} last widget`,
      ).toBe("table");
      expect(template.widgets.length).toBeGreaterThanOrEqual(6);
      expect(template.widgets.length).toBeLessThanOrEqual(10);
    });

    it("percent KPIs are rates or averages, never sums/raw counts", () => {
      for (const w of template.widgets) {
        if (w.type !== "kpi" || w.unit !== "percent") continue;
        const ok =
          Boolean(w.rateNumerator) ||
          w.measure.kind === "avg" ||
          w.measure.kind === "min" ||
          w.measure.kind === "max";
        expect(
          ok,
          `${template.key}.${w.id} percent KPI needs rateNumerator or an average`,
        ).toBe(true);
      }
    });
  });
}
