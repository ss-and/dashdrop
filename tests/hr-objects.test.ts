import { describe, it, expect } from "vitest";
import {
  HR_OBJECTS,
  HR_SLUGS,
  getHrObject,
  isHrSlug,
  type HrObject,
} from "@/lib/hr-objects";
import { CRM_SLUGS } from "@/lib/crm-objects";
import { SAMPLE_SHEETS } from "@/lib/sample-sheets";
import { FIELD_TYPES, isComputedField } from "@/lib/field-types";
import { parseFormula, evaluateFormula } from "@/lib/formula";
import type { FormulaValue } from "@/lib/formula";

const bySlug = new Map(HR_OBJECTS.map((o) => [o.slug, o]));

describe("HR object definitions", () => {
  it("exposes the core objects in a stable order", () => {
    expect(HR_SLUGS).toEqual([
      "hr-departments",
      "hr-employees",
      "hr-attendance",
      "hr-leave-requests",
      "hr-reviews",
    ]);
    expect(HR_OBJECTS).toHaveLength(5);
  });

  it("isHrSlug / getHrObject agree with the list", () => {
    for (const slug of HR_SLUGS) {
      expect(isHrSlug(slug)).toBe(true);
      expect(getHrObject(slug)?.slug).toBe(slug);
    }
    expect(isHrSlug("inquiries")).toBe(false);
    expect(isHrSlug("accounts")).toBe(false);
    expect(getHrObject("nope")).toBeUndefined();
  });

  for (const obj of HR_OBJECTS) {
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
        // The primary field is first, so it labels the record everywhere.
        expect(obj.fields[0].key).toBe(required[0].key);
      });

      it("listColumns reference real, non-computed fields", () => {
        expect(obj.listColumns.length).toBeGreaterThan(0);
        for (const key of obj.listColumns) {
          const f = obj.fields.find((x) => x.key === key);
          expect(f, `${obj.slug}.listColumns → ${key}`).toBeDefined();
          expect(isComputedField(f!.type)).toBe(false);
        }
      });

      it("relation fields point at a real HR object", () => {
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
          // The looked-up target field must exist on the related object, and
          // must not itself be computed (raw stored data is what is pulled).
          const target = bySlug.get(via!.relation!.to)!;
          const tf = target.fields.find((x) => x.key === cfg.target);
          expect(
            tf,
            `${obj.slug}.${f.key} → ${via!.relation!.to}.${cfg.target}`,
          ).toBeDefined();
          expect(isComputedField(tf!.type)).toBe(false);
        }
      });

      it("rollup fields declare a supported aggregation", () => {
        for (const f of obj.fields) {
          if (f.type !== "rollup") continue;
          expect(f.rollup, `${obj.slug}.${f.key} needs rollup config`).toBeDefined();
          expect(["sum", "count", "avg", "min", "max"]).toContain(f.rollup!.op);
        }
      });

      it("formula fields parse and only reference fields on this object", () => {
        const keys = new Set(obj.fields.map((f) => f.key));
        for (const f of obj.fields) {
          if (f.type !== "formula") continue;
          expect(f.formula, `${obj.slug}.${f.key} needs formula config`).toBeDefined();
          const src = f.formula!.expression;
          expect(src.trim().length).toBeGreaterThan(0);
          const parsed = parseFormula(src);
          expect(
            parsed.ok,
            `${obj.slug}.${f.key}: ${parsed.ok ? "" : parsed.error}`,
          ).toBe(true);
          if (!parsed.ok) continue;
          for (const ref of parsed.refs) {
            expect(keys.has(ref), `${obj.slug}.${f.key} → {${ref}}`).toBe(true);
            // A formula must not reference itself (direct cycle).
            expect(ref).not.toBe(f.key);
          }
        }
      });

      it("relation targets are declared before this object (install order)", () => {
        const myIndex = HR_OBJECTS.indexOf(obj);
        for (const f of obj.fields) {
          if (f.type !== "relation") continue;
          const targetIndex = HR_OBJECTS.findIndex(
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

      it("primary values are unique across the sample rows", () => {
        const primary = obj.fields.find((f) => f.required)!.key;
        const labels = obj.samples.map((s) => String(s[primary]));
        // The installer indexes samples by this value to resolve relations, so
        // duplicates would silently drop links.
        expect(new Set(labels).size).toBe(labels.length);
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

describe("the HR core shows off the computed-column engine", () => {
  it("declares at least one lookup, one rollup and one formula", () => {
    const types = HR_OBJECTS.flatMap((o) => o.fields.map((f) => f.type));
    expect(types).toContain("lookup");
    expect(types).toContain("rollup");
    expect(types).toContain("formula");
  });

  it("links every object except 部署 back into the employee master", () => {
    for (const obj of HR_OBJECTS.slice(1)) {
      expect(
        obj.fields.some((f) => f.type === "relation"),
        `${obj.slug} has no relation field`,
      ).toBe(true);
    }
  });
});

describe("HR slugs never collide with anything already installable", () => {
  it("does not reuse the built-in template slugs", () => {
    const reserved = ["inquiries", "tasks"];
    for (const o of HR_OBJECTS) expect(reserved).not.toContain(o.slug);
  });

  it("does not reuse a CRM slug", () => {
    for (const o of HR_OBJECTS) {
      expect(CRM_SLUGS as string[]).not.toContain(o.slug);
    }
  });

  it("does not reuse a sample-sheet key or name", () => {
    // The sample-sheet installer derives a collection slug from its key, and
    // installHr is idempotent *by slug* — a collision would make it skip a real
    // HR object because an unrelated sample sheet already claimed the slug.
    const keys = new Set(SAMPLE_SHEETS.map((s) => s.key));
    const names = new Set(SAMPLE_SHEETS.map((s) => s.name));
    for (const o of HR_OBJECTS) {
      expect(keys.has(o.slug), `${o.slug} collides with a sample sheet key`).toBe(false);
      expect(names.has(o.name), `${o.name} collides with a sample sheet name`).toBe(false);
    }
  });

  it("HR slugs are unique among themselves", () => {
    expect(new Set(HR_SLUGS).size).toBe(HR_SLUGS.length);
  });
});

describe("HR sample data is substantial enough to demo", () => {
  it("has a realistic employee roster spread over the departments", () => {
    const employees = getHrObject("hr-employees")!;
    const departments = getHrObject("hr-departments")!;
    expect(employees.samples.length).toBeGreaterThanOrEqual(8);
    expect(departments.samples.length).toBeGreaterThanOrEqual(3);
    const used = new Set(employees.samples.map((s) => String(s.department)));
    expect(used.size).toBe(departments.samples.length);
  });

  it("has attendance covering more than one week and several employees", () => {
    const attendance = getHrObject("hr-attendance")!;
    const dates = new Set(attendance.samples.map((s) => String(s.date)));
    expect(dates.size).toBeGreaterThanOrEqual(10);
    const people = new Set(attendance.samples.map((s) => String(s.employee)));
    expect(people.size).toBeGreaterThanOrEqual(3);
  });

  it("has leave requests and reviews to link against", () => {
    expect(getHrObject("hr-leave-requests")!.samples.length).toBeGreaterThanOrEqual(3);
    expect(getHrObject("hr-reviews")!.samples.length).toBeGreaterThanOrEqual(3);
  });
});

describe("object shape sanity", () => {
  it("every object has name/description/icon/color", () => {
    for (const o of HR_OBJECTS as HrObject[]) {
      expect(o.name.length).toBeGreaterThan(0);
      expect(o.description.length).toBeGreaterThan(0);
      expect(o.icon.length).toBeGreaterThan(0);
      expect(o.color.length).toBeGreaterThan(0);
    }
  });
});

describe("HR definitions never carry 特定個人情報 / 要配慮個人情報", () => {
  it("has no マイナンバー or health/creed/nationality fields", () => {
    // 番号法（マイナンバー）と個人情報保護法の要配慮個人情報は、この製品が
    // 実装していない管理義務を伴う。定義に紛れ込ませないこと。
    const banned = [
      "マイナンバー",
      "個人番号",
      "健康診断",
      "病歴",
      "障害",
      "国籍",
      "信条",
      "本籍",
      "犯罪歴",
    ];
    const bannedKeys = [
      "mynumber",
      "myNumber",
      "my_number",
      "individualNumber",
      "healthCheck",
      "medicalHistory",
      "disability",
      "nationality",
      "creed",
    ];
    for (const o of HR_OBJECTS) {
      for (const f of o.fields) {
        for (const word of banned) {
          expect(f.name.includes(word), `${o.slug}.${f.key} → ${f.name}`).toBe(false);
        }
        expect(bannedKeys, `${o.slug}.${f.key}`).not.toContain(f.key);
      }
    }
  });
});

describe("HR の計算列 — 空欄の扱い", () => {
  /** 定義から式を取り出して、その場で評価する。 */
  function evalField(
    slug: string,
    key: string,
    row: Record<string, FormulaValue>,
  ) {
    const obj = HR_OBJECTS.find((o) => o.slug === slug);
    if (!obj) throw new Error(`no object ${slug}`);
    const field = obj.fields.find((f) => f.key === key);
    if (!field?.formula) throw new Error(`no formula on ${slug}.${key}`);
    const parsed = parseFormula(field.formula.expression);
    if (!parsed.ok) throw new Error(`parse failed: ${field.formula.expression}`);
    return evaluateFormula(parsed.ast, row);
  }

  describe("勤怠 — 残業時間", () => {
    /**
     * 回帰テスト: MAX は空欄を読み飛ばすので、MAX({workHours} - 8, 0) だと
     * 勤務時間が未入力の日（有給・欠勤）まで「0」と表示されていた。
     * 働いていない日と、ちょうど8時間働いた日が同じ見た目になるのは誤り。
     */
    it("勤務時間が未入力なら空欄", () => {
      expect(evalField("hr-attendance", "overtimeHours", {})).toBe("");
      expect(
        evalField("hr-attendance", "overtimeHours", { workHours: null }),
      ).toBe("");
      expect(
        evalField("hr-attendance", "overtimeHours", { workHours: "" }),
      ).toBe("");
    });

    it("8時間以下なら 0、超えた分だけ残業になる", () => {
      expect(evalField("hr-attendance", "overtimeHours", { workHours: 8 })).toBe(0);
      expect(evalField("hr-attendance", "overtimeHours", { workHours: 6 })).toBe(0);
      expect(
        evalField("hr-attendance", "overtimeHours", { workHours: 10.5 }),
      ).toBe(2.5);
    });
  });

  describe("評価 — 達成度区分", () => {
    /**
     * 回帰テスト: 比較の片側が null だと結果も null（偽）になるため、
     * 未入力の行がすべて「未達」と表示されていた。まだ評価していない行を
     * 本人に「未達」と見せてしまうのは事実誤認。
     */
    it("目標達成率が未入力なら空欄（「未達」にしない）", () => {
      expect(evalField("hr-reviews", "achievementBand", {})).toBe("");
      expect(
        evalField("hr-reviews", "achievementBand", { achievement: null }),
      ).toBe("");
    });

    it("境界値がそれぞれ正しい区分になる", () => {
      const band = (achievement: number) =>
        evalField("hr-reviews", "achievementBand", { achievement });
      expect(band(0)).toBe("未達");
      expect(band(79.9)).toBe("未達");
      expect(band(80)).toBe("一部未達");
      expect(band(99.9)).toBe("一部未達");
      expect(band(100)).toBe("達成");
      expect(band(119.9)).toBe("達成");
      expect(band(120)).toBe("大幅達成");
      expect(band(300)).toBe("大幅達成");
    });
  });

  describe("休暇申請 — 日数", () => {
    it("同日なら 1 日、3日間なら 3 日", () => {
      expect(
        evalField("hr-leave-requests", "days", {
          startDate: "2026-07-13",
          endDate: "2026-07-13",
        }),
      ).toBe(1);
      expect(
        evalField("hr-leave-requests", "days", {
          startDate: "2026-07-13",
          endDate: "2026-07-15",
        }),
      ).toBe(3);
    });
  });
});
