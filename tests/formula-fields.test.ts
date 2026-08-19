import { describe, it, expect } from "vitest";
import { orderFormulaFields } from "@/lib/formula-fields";
import { evaluateFormula, MAX_TEXT_LENGTH, TEXT_TRUNCATION_NOTE } from "@/lib/formula";

/**
 * The wiring between the formula engine and the record resolver: formulas are
 * parsed once per collection, ordered so one formula can build on another, and
 * a cycle degrades to "skipped" instead of hanging the read path.
 */

type F = { key: string; name: string; type: string; config?: unknown };
const formula = (key: string, expression: string): F => ({
  key,
  name: key,
  type: "formula",
  config: { expression },
});

function evalAll(fields: F[], data: Record<string, unknown>) {
  const computed: Record<string, unknown> = {};
  for (const pf of orderFormulaFields(fields as never)) {
    const row: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries({ ...data, ...computed })) {
      row[k] =
        v === null ||
        typeof v === "number" ||
        typeof v === "string" ||
        typeof v === "boolean"
          ? v
          : null;
    }
    computed[pf.key] = evaluateFormula(pf.ast, row);
  }
  return computed;
}

describe("orderFormulaFields", () => {
  it("ignores collections with no formula fields", () => {
    expect(orderFormulaFields([{ key: "a", name: "a", type: "number" }] as never)).toEqual([]);
  });

  it("computes the headline case: 粗利 = 売上 - 原価", () => {
    const fields = [
      { key: "sales", name: "売上", type: "currency" },
      { key: "cost", name: "原価", type: "currency" },
      formula("gross", "{sales} - {cost}"),
    ];
    expect(evalAll(fields, { sales: 1000, cost: 400 }).gross).toBe(600);
  });

  it("orders dependent formulas so one can build on another", () => {
    // margin depends on gross, declared BEFORE it — order must be corrected.
    const fields = [
      { key: "sales", name: "売上", type: "currency" },
      { key: "cost", name: "原価", type: "currency" },
      formula("margin", "ROUND({gross} / {sales} * 100, 1)"),
      formula("gross", "{sales} - {cost}"),
    ];
    const out = evalAll(fields, { sales: 1000, cost: 400 });
    expect(out.gross).toBe(600);
    expect(out.margin).toBe(60);
  });

  it("resolves a three-deep chain", () => {
    const fields = [
      { key: "a", name: "a", type: "number" },
      formula("c", "{b} * 2"),
      formula("b", "{a} + 1"),
      formula("d", "{c} + {b}"),
    ];
    const out = evalAll(fields, { a: 1 });
    expect(out.b).toBe(2);
    expect(out.c).toBe(4);
    expect(out.d).toBe(6);
  });

  it("drops a direct self-reference instead of looping", () => {
    const fields = [formula("x", "{x} + 1")];
    const ordered = orderFormulaFields(fields as never);
    expect(ordered.map((f) => f.key)).not.toContain("x");
  });

  it("drops a mutual cycle (A→B→A) instead of hanging", () => {
    const fields = [formula("a", "{b} + 1"), formula("b", "{a} + 1")];
    // Must terminate — the assertion is that this call returns at all.
    const ordered = orderFormulaFields(fields as never);
    expect(ordered.length).toBeLessThan(2);
  });

  it("keeps healthy formulas when a sibling is circular", () => {
    const fields = [
      { key: "n", name: "n", type: "number" },
      formula("bad", "{bad} * 2"),
      formula("good", "{n} * 10"),
    ];
    const out = evalAll(fields, { n: 3 });
    expect(out.good).toBe(30);
  });

  it("a formula that merely READS a circular one still computes", () => {
    // Only the cycle members drop out. `usable` sees null for {bad} and
    // resolves to null rather than disappearing from the output entirely.
    const fields = [
      { key: "n", name: "n", type: "number" },
      formula("bad", "{bad} + 1"),
      formula("usable", "{bad} + {n}"),
    ];
    const ordered = orderFormulaFields(fields as never).map((f) => f.key);
    expect(ordered).not.toContain("bad");
    expect(ordered).toContain("usable");
  });

  it("drops every member of a 3-field cycle (A→B→C→A)", () => {
    const fields = [
      formula("a", "{b} + 1"),
      formula("b", "{c} + 1"),
      formula("c", "{a} + 1"),
    ];
    expect(orderFormulaFields(fields as never)).toEqual([]);
  });

  it("skips a formula whose expression does not parse", () => {
    const fields = [formula("broken", "1 +"), formula("ok", "1 + 1")];
    const keys = orderFormulaFields(fields as never).map((f) => f.key);
    expect(keys).toContain("ok");
    expect(keys).not.toContain("broken");
  });

  it("skips blank and non-string expressions", () => {
    const fields = [
      { key: "a", name: "a", type: "formula", config: { expression: "   " } },
      { key: "b", name: "b", type: "formula", config: { expression: 42 } },
      { key: "c", name: "c", type: "formula", config: {} },
      { key: "d", name: "d", type: "formula" },
    ];
    expect(orderFormulaFields(fields as never)).toEqual([]);
  });

  it("parses each formula exactly once, not once per row", () => {
    const fields = [
      { key: "sales", name: "売上", type: "currency" },
      formula("gross", "{sales} - 100"),
    ];
    const prepared = orderFormulaFields(fields as never);
    expect(prepared).toHaveLength(1);
    // Re-evaluating the same AST across many rows must not need a re-parse.
    for (let i = 0; i < 500; i++) {
      const v = evaluateFormula(prepared[0].ast, { sales: i });
      expect(v).toBe(i - 100);
    }
  });

  it("reads a missing referenced field as null rather than throwing", () => {
    const fields = [formula("x", "{nonexistent} + 1")];
    expect(evalAll(fields, {}).x).toBeNull();
  });

  it("can build on a lookup/rollup value computed earlier in the pass", () => {
    // `total` stands in for a rollup already written into `computed`.
    const fields = [formula("half", "{total} / 2")];
    expect(evalAll(fields, { total: 50 }).half).toBe(25);
  });
});

/* -------------------------------------------------------------------------- *
 * P0-1: chained formulas must not be able to OOM the server
 * -------------------------------------------------------------------------- */

describe("chained formula fields are bounded in memory", () => {
  /** f0 = CONCAT({t},{t}), f1 = CONCAT({f0},{f0}), … — doubling per field. */
  function doublingChain(n: number): F[] {
    const fields: F[] = [{ key: "t", name: "元テキスト", type: "text" }];
    for (let i = 0; i < n; i++) {
      fields.push(formula(`f${i}`, i === 0 ? "CONCAT({t},{t})" : `CONCAT({f${i - 1}},{f${i - 1}})`));
    }
    return fields;
  }

  /**
   * Regression (P0-1): every bound in the engine was per FORMULA (2,000 source
   * characters, 32 levels, 256 args, 100,000 steps) and nothing bounded the
   * size of a VALUE. `orderFormulaFields` deliberately feeds one formula's
   * output into the next and relations.ts runs the chain for every record on
   * every sheet view, dashboard render and printed report, so CONCAT doubled
   * per field with no ceiling: 24 fields over a 10-character cell measured at
   * a 167,772,160-character string in 243 ms PER RECORD, and 28 fields reached
   * ~2.7 GB and OOM'd the process. One record was enough to kill the server.
   */
  it("holds a 24-deep doubling chain to the cap instead of 167 MB", () => {
    const started = Date.now();
    const out = evalAll(doublingChain(24), { t: "0123456789" });
    // 10 chars doubled 24 times would be 167,772,160 characters.
    for (let i = 0; i < 24; i++) {
      expect(typeof out[`f${i}`]).toBe("string");
      expect(Array.from(String(out[`f${i}`])).length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    }
    // Growth stops at the cap and stays there — it never compounds again.
    expect(Array.from(String(out.f23))).toHaveLength(MAX_TEXT_LENGTH);
    expect(String(out.f23).endsWith(TEXT_TRUNCATION_NOTE)).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("stays linear at the depth that used to OOM the process", () => {
    const out = evalAll(doublingChain(28), { t: "0123456789" });
    let total = 0;
    for (let i = 0; i < 28; i++) total += String(out[`f${i}`]).length;
    // Was ~2.7 GB; now bounded by fields × cap.
    expect(total).toBeLessThanOrEqual(28 * MAX_TEXT_LENGTH * 2);
  });

  it("still computes the small chains people actually write", () => {
    const fields = [
      { key: "姓", name: "姓", type: "text" },
      { key: "名", name: "名", type: "text" },
      formula("氏名", "CONCAT({姓}, ' ', {名})"),
      formula("表示名", "CONCAT({氏名}, ' 様')"),
    ];
    expect(evalAll(fields, { 姓: "山田", 名: "太郎" }).表示名).toBe("山田 太郎 様");
  });
});
