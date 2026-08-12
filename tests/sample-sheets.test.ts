import { describe, it, expect } from "vitest";
import {
  SAMPLE_SHEETS,
  SAMPLE_CATEGORIES,
  getSampleSheet,
  getSampleSheetsByCategory,
  getSampleCategory,
  sampleSheetCounts,
  type SampleSheet,
} from "@/lib/sample-sheets";
import { FIELD_TYPES, coerceValue, isComputedField } from "@/lib/field-types";

const CATEGORY_IDS = new Set(SAMPLE_CATEGORIES.map((c) => c.id));

describe("sample sheet library", () => {
  it("ships a meaningful number of sheets", () => {
    expect(SAMPLE_SHEETS.length).toBeGreaterThanOrEqual(12);
  });

  it("has unique keys across the library", () => {
    const keys = SAMPLE_SHEETS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has unique display names across the library", () => {
    const names = SAMPLE_SHEETS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("getSampleSheet resolves every key and nothing else", () => {
    for (const s of SAMPLE_SHEETS) {
      expect(getSampleSheet(s.key)?.key).toBe(s.key);
    }
    expect(getSampleSheet("does-not-exist")).toBeUndefined();
  });

  it("category helpers agree with the library", () => {
    const counts = sampleSheetCounts();
    let seen = 0;
    for (const c of SAMPLE_CATEGORIES) {
      const sheets = getSampleSheetsByCategory(c.id);
      expect(counts[c.id]).toBe(sheets.length);
      expect(getSampleCategory(c.id)?.id).toBe(c.id);
      seen += sheets.length;
    }
    expect(seen).toBe(SAMPLE_SHEETS.length);
    expect(getSampleCategory("nope")).toBeUndefined();
  });

  it("every category is non-empty and described", () => {
    for (const c of SAMPLE_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
      expect(getSampleSheetsByCategory(c.id).length).toBeGreaterThan(0);
    }
  });
});

for (const sheet of SAMPLE_SHEETS as SampleSheet[]) {
  describe(`${sheet.name} (${sheet.key})`, () => {
    it("carries the descriptive metadata the gallery renders", () => {
      expect(sheet.key.length).toBeGreaterThan(0);
      expect(sheet.name.length).toBeGreaterThan(0);
      expect(sheet.description.length).toBeGreaterThan(0);
      expect(sheet.useCase.length).toBeGreaterThan(0);
      expect(sheet.icon.length).toBeGreaterThan(0);
    });

    it("belongs to a declared category", () => {
      expect(CATEGORY_IDS.has(sheet.category)).toBe(true);
    });

    it("has a sane width with unique field keys and valid types", () => {
      expect(sheet.fields.length).toBeGreaterThanOrEqual(6);
      expect(sheet.fields.length).toBeLessThanOrEqual(10);
      const keys = sheet.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const f of sheet.fields) {
        expect(FIELD_TYPES, `${sheet.key}.${f.key}`).toContain(f.type);
        expect(f.name.length).toBeGreaterThan(0);
      }
    });

    it("listColumns reference real, non-computed fields", () => {
      expect(sheet.listColumns.length).toBeGreaterThan(0);
      expect(new Set(sheet.listColumns).size).toBe(sheet.listColumns.length);
      for (const key of sheet.listColumns) {
        const f = sheet.fields.find((x) => x.key === key);
        expect(f, `${sheet.key}.listColumns → ${key}`).toBeDefined();
        expect(isComputedField(f!.type)).toBe(false);
      }
    });

    it("has at least one required field", () => {
      expect(sheet.fields.some((f) => f.required)).toBe(true);
    });

    it("select / multiselect fields declare options", () => {
      for (const f of sheet.fields) {
        if (f.type !== "select" && f.type !== "multiselect") continue;
        expect(f.options?.length, `${sheet.key}.${f.key} options`).toBeGreaterThan(0);
        const values = f.options!.map((o) => o.value);
        expect(new Set(values).size, `${sheet.key}.${f.key} option values`).toBe(
          values.length,
        );
        for (const o of f.options!) {
          expect(o.label.length).toBeGreaterThan(0);
          expect(o.value.length).toBeGreaterThan(0);
        }
      }
    });

    it("holds enough demo rows to be useful", () => {
      expect(sheet.rows.length).toBeGreaterThanOrEqual(8);
      expect(sheet.rows.length).toBeLessThanOrEqual(20);
    });

    it("rows only use declared field keys", () => {
      const keys = new Set(sheet.fields.map((f) => f.key));
      for (const [i, row] of sheet.rows.entries()) {
        for (const k of Object.keys(row)) {
          expect(keys.has(k), `${sheet.key} row ${i} key ${k}`).toBe(true);
        }
      }
    });

    it("required fields are filled in every row", () => {
      const required = sheet.fields.filter((f) => f.required);
      for (const [i, row] of sheet.rows.entries()) {
        for (const f of required) {
          const v = row[f.key];
          expect(v, `${sheet.key} row ${i} missing ${f.key}`).toBeDefined();
          expect(
            String(v ?? "").trim().length,
            `${sheet.key} row ${i} empty ${f.key}`,
          ).toBeGreaterThan(0);
        }
      }
    });

    it("select / multiselect row values are declared option values", () => {
      for (const f of sheet.fields) {
        if (f.type !== "select" && f.type !== "multiselect") continue;
        const valid = new Set(f.options!.map((o) => o.value));
        for (const [i, row] of sheet.rows.entries()) {
          const v = row[f.key];
          if (v === undefined || v === null || v === "") continue;
          const values = Array.isArray(v) ? v : [v];
          expect(values.length, `${sheet.key} row ${i} ${f.key} empty`).toBeGreaterThan(0);
          for (const one of values) {
            expect(
              valid.has(String(one)),
              `${sheet.key} row ${i} ${f.key} = ${String(one)}`,
            ).toBe(true);
          }
        }
      }
    });

    it("every populated cell coerces cleanly for its field type", () => {
      for (const [i, row] of sheet.rows.entries()) {
        for (const f of sheet.fields) {
          const raw = row[f.key];
          if (raw === undefined || raw === null || raw === "") continue;
          const res = coerceValue(f.type, raw, f.options);
          expect(
            res.ok,
            `${sheet.key} row ${i} ${f.key} (${f.type}) = ${JSON.stringify(raw)}: ${res.error ?? ""}`,
          ).toBe(true);
        }
      }
    });

    it("numeric fields hold real numbers, dates hold ISO dates", () => {
      for (const [i, row] of sheet.rows.entries()) {
        for (const f of sheet.fields) {
          const raw = row[f.key];
          if (raw === undefined || raw === null || raw === "") continue;
          if (f.type === "number" || f.type === "currency") {
            expect(
              typeof raw,
              `${sheet.key} row ${i} ${f.key} should be a number`,
            ).toBe("number");
          }
          if (f.type === "date") {
            expect(
              String(raw),
              `${sheet.key} row ${i} ${f.key} should be YYYY-MM-DD`,
            ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          }
          if (f.type === "checkbox") {
            expect(
              typeof raw,
              `${sheet.key} row ${i} ${f.key} should be a boolean`,
            ).toBe("boolean");
          }
        }
      }
    });

    it("declares no computed (lookup/rollup) fields", () => {
      for (const f of sheet.fields) {
        expect(isComputedField(f.type), `${sheet.key}.${f.key}`).toBe(false);
      }
    });
  });
}
