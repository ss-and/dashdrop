/**
 * Formula field preparation — the pure half of the computed-column pipeline.
 *
 * Kept out of `relations.ts` because that module imports `server-only`, which
 * makes anything reachable from it impossible to unit-test. `relations.ts`
 * wraps these with the database queries; the ordering and coercion logic lives
 * here and is covered by tests/formula-fields.test.ts.
 */
import {
  parseFormula,
  type FormulaAst,
  type FormulaValue,
} from "./formula";

/** Minimal shape this module needs from a Field row. */
export interface FormulaField {
  key: string;
  type: string;
  config?: unknown;
}

export interface FormulaConfig {
  /** The expression source, e.g. "{sales} - {cost}". */
  expression: string;
}

export interface PreparedFormula {
  key: string;
  ast: FormulaAst;
}

/**
 * Parse every formula field once and return them in dependency order, so a
 * formula that references another formula sees the computed value rather than
 * a blank.
 *
 * Fields that fail to parse, or that sit in a reference cycle (A→B→A), are
 * skipped — they resolve to null. Validation rejects cycles at write time, but
 * a stale config from an earlier edit must never hang the read path, so the
 * ordering is done with an explicit visited/visiting marker rather than trust.
 *
 * MEMORY: chaining is what makes this ordering useful and it is also what made
 * it dangerous. Feeding one formula's output into the next lets `CONCAT` double
 * per field, and `relations.ts` runs the whole chain for EVERY record on every
 * sheet view, dashboard render and printed report — 24 chained fields over a
 * 10-character cell measured at a 167 MB string per record, 28 fields OOM'd the
 * process. The fix is the per-value cap in the engine (MAX_TEXT_LENGTH, rule 12
 * in ./formula/functions.ts), not a limit here: capping the number of formula
 * fields would not have stopped the 128× amplification a SINGLE nested-CONCAT
 * formula achieves inside the 2,000-character source cap. With the value cap the
 * cost of a chain is linear — one bounded string per field — so the ordering is
 * safe to keep exactly as it is.
 */
export function orderFormulaFields(
  fields: FormulaField[],
): PreparedFormula[] {
  const formulas = fields.filter((f) => f.type === "formula");
  if (formulas.length === 0) return [];

  const parsed = new Map<string, { ast: FormulaAst; refs: string[] }>();
  for (const f of formulas) {
    const src = ((f.config ?? {}) as FormulaConfig).expression;
    if (typeof src !== "string" || !src.trim()) continue;
    const res = parseFormula(src);
    if (res.ok) parsed.set(f.key, { ast: res.ast, refs: res.refs });
  }

  const ordered: PreparedFormula[] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const cyclic = new Set<string>();

  const visit = (key: string): void => {
    const mark = state.get(key);
    if (mark === "done") return;
    if (mark === "visiting") {
      // Back edge: every field from `key` up the current stack is part of the
      // cycle. Only those are dropped — a healthy formula that merely *reads* a
      // circular one still computes (it just sees null).
      const from = stack.lastIndexOf(key);
      if (from >= 0) for (const k of stack.slice(from)) cyclic.add(k);
      return;
    }
    const entry = parsed.get(key);
    if (!entry) return; // not a formula (or it failed to parse)

    state.set(key, "visiting");
    stack.push(key);
    for (const ref of entry.refs) {
      if (parsed.has(ref)) visit(ref);
    }
    stack.pop();
    state.set(key, "done");

    if (!cyclic.has(key)) ordered.push({ key, ast: entry.ast });
  };

  for (const f of formulas) visit(f.key);
  return ordered;
}

/**
 * Row values the formula engine accepts (everything else reads as null).
 *
 * Values are NOT length-capped here: `evaluateFormula` caps every value as it
 * reaches its stack (rule 12), so copying capped strings into the row as well
 * would only double the allocation without tightening the bound.
 */
export function toFormulaRow(
  data: Record<string, unknown>,
  computed: Record<string, unknown>,
): Record<string, FormulaValue> {
  const row: Record<string, FormulaValue> = {};
  for (const [k, v] of Object.entries({ ...data, ...computed })) {
    row[k] =
      v === null ||
      typeof v === "number" ||
      typeof v === "string" ||
      typeof v === "boolean"
        ? v
        : null;
  }
  return row;
}
