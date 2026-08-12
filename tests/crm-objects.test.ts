import { describe, it, expect } from "vitest";
import {
  CRM_OBJECTS,
  CRM_SLUGS,
  getCrmObject,
  isCrmSlug,
  type CrmObject,
} from "@/lib/crm-objects";
import { FIELD_TYPES, isComputedField } from "@/lib/field-types";

const bySlug = new Map(CRM_OBJECTS.map((o) => [o.slug, o]));

describe("CRM object definitions", () => {
  it("exposes the four core objects in a stable order", () => {
    expect(CRM_SLUGS).toEqual([
      "accounts",
      "contacts",
      "opportunities",
      "activities",
    ]);
    expect(CRM_OBJECTS).toHaveLength(4);
  });

  it("isCrmSlug / getCrmObject agree with the list", () => {
    for (const slug of CRM_SLUGS) {
      expect(isCrmSlug(slug)).toBe(true);
      expect(getCrmObject(slug)?.slug).toBe(slug);
    }
    expect(isCrmSlug("inquiries")).toBe(false);
    expect(getCrmObject("nope")).toBeUndefined();
  });

  for (const obj of CRM_OBJECTS) {
    describe(`${obj.name} (${obj.slug})`, () => {
      it("has unique field keys and valid field types", () => {
        const keys = obj.fields.map((f) => f.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const f of obj.fields) {
          expect(FIELD_TYPES).toContain(f.type);
        }
      });

      it("has exactly one required primary field", () => {
        const required = obj.fields.filter((f) => f.required);
        expect(required).toHaveLength(1);
        expect(required[0].type).toBe("text");
      });

      it("listColumns reference real, non-computed fields", () => {
        expect(obj.listColumns.length).toBeGreaterThan(0);
        for (const key of obj.listColumns) {
          const f = obj.fields.find((x) => x.key === key);
          expect(f, `${obj.slug}.listColumns → ${key}`).toBeDefined();
          expect(isComputedField(f!.type)).toBe(false);
        }
      });

      it("relation fields point at a real CRM object", () => {
        for (const f of obj.fields) {
          if (f.type !== "relation") continue;
          expect(f.relation, `${obj.slug}.${f.key} needs relation config`).toBeDefined();
          const target = bySlug.get(f.relation!.to);
          expect(target, `${obj.slug}.${f.key} → ${f.relation!.to}`).toBeDefined();
          // The display field must exist on the target.
          const dk = f.relation!.displayFieldKey ?? "name";
          expect(target!.fields.some((tf) => tf.key === dk)).toBe(true);
        }
      });

      it("lookup/rollup fields go through a relation field on this object", () => {
        for (const f of obj.fields) {
          const cfg = f.lookup ?? f.rollup;
          if (!cfg) continue;
          expect(isComputedField(f.type)).toBe(true);
          const via = obj.fields.find((x) => x.key === cfg.via);
          expect(via, `${obj.slug}.${f.key} via ${cfg.via}`).toBeDefined();
          expect(via!.type).toBe("relation");
          // The looked-up target field must exist on the related object.
          const target = bySlug.get(via!.relation!.to)!;
          expect(
            target.fields.some((tf) => tf.key === cfg.target),
            `${obj.slug}.${f.key} → ${via!.relation!.to}.${cfg.target}`,
          ).toBe(true);
        }
      });

      it("relation targets are declared before this object (install order)", () => {
        const myIndex = CRM_OBJECTS.indexOf(obj);
        for (const f of obj.fields) {
          if (f.type !== "relation") continue;
          const targetIndex = CRM_OBJECTS.findIndex(
            (o) => o.slug === f.relation!.to,
          );
          // Sample linking resolves names as objects are created in order, so a
          // relation target must not come later in the list.
          expect(
            targetIndex,
            `${obj.slug}.${f.key} → ${f.relation!.to} declared later`,
          ).toBeLessThan(myIndex);
        }
      });

      it("select fields carry options and samples use valid option values", () => {
        for (const f of obj.fields) {
          if (f.type !== "select" && f.type !== "multiselect") continue;
          expect(f.options?.length, `${obj.slug}.${f.key} options`).toBeGreaterThan(0);
          const valid = new Set(f.options!.map((o) => o.value));
          for (const s of obj.samples) {
            const v = s[f.key];
            if (v === undefined || v === null || v === "") continue;
            expect(valid.has(String(v)), `${obj.slug}.${f.key} = ${v}`).toBe(true);
          }
        }
      });

      it("sample rows only use declared keys and fill the primary field", () => {
        const keys = new Set(obj.fields.map((f) => f.key));
        const primary = obj.fields.find((f) => f.required)!.key;
        expect(obj.samples.length).toBeGreaterThan(0);
        for (const s of obj.samples) {
          for (const k of Object.keys(s)) {
            expect(keys.has(k), `${obj.slug} sample key ${k}`).toBe(true);
          }
          expect(String(s[primary] ?? "").length).toBeGreaterThan(0);
        }
      });

      it("sample relation values resolve to an existing target sample", () => {
        for (const f of obj.fields) {
          if (f.type !== "relation") continue;
          const target = bySlug.get(f.relation!.to)!;
          const dk = f.relation!.displayFieldKey ?? "name";
          const targetPrimary = target.fields.find((tf) => tf.required)!.key;
          const names = new Set(
            target.samples.map((s) => String(s[dk] ?? s[targetPrimary])),
          );
          for (const s of obj.samples) {
            const v = s[f.key];
            if (v === undefined || v === null || v === "") continue;
            expect(
              names.has(String(v)),
              `${obj.slug}.${f.key} = "${v}" has no matching ${f.relation!.to} sample`,
            ).toBe(true);
          }
        }
      });

      it("computed fields carry no sample values (they resolve on read)", () => {
        const computed = obj.fields.filter((f) => isComputedField(f.type));
        for (const f of computed) {
          for (const s of obj.samples) {
            expect(s[f.key], `${obj.slug}.${f.key}`).toBeUndefined();
          }
        }
      });
    });
  }
});

describe("CRM slugs never collide with the built-in templates", () => {
  it("does not reuse inquiries/tasks slugs", () => {
    const reserved = ["inquiries", "tasks"];
    for (const o of CRM_OBJECTS) expect(reserved).not.toContain(o.slug);
  });
});

describe("object shape sanity", () => {
  it("every object has name/description/icon/color", () => {
    for (const o of CRM_OBJECTS as CrmObject[]) {
      expect(o.name.length).toBeGreaterThan(0);
      expect(o.description.length).toBeGreaterThan(0);
      expect(o.icon.length).toBeGreaterThan(0);
      expect(o.color.length).toBeGreaterThan(0);
    }
  });
});
