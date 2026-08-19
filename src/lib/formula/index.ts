/**
 * Safe spreadsheet formula engine.
 *
 * Tokenizer → parser → AST → iterative evaluator, all hand-written: there is
 * no `eval`, no `new Function`, no dynamic import and no user-built RegExp
 * anywhere in this directory. Formulas are untrusted, tenant-supplied text
 * that we evaluate server-side, so the engine is bounded on every axis
 * (2,000 source characters, 32 nesting levels, 256 arguments per call) and
 * neither `parseFormula` nor `evaluateFormula` ever throws.
 *
 *   const parsed = parseFormula("{sales} - {cost}");
 *   if (parsed.ok) evaluateFormula(parsed.ast, { sales: 1000, cost: 400 }); // 600
 *
 * Coercion rules are documented in ./functions.ts.
 */
export type { FormulaValue } from "./functions";
export { FORMULA_FUNCTIONS } from "./functions";

export type {
  FormulaAst,
  ParseOk,
  ParseErr,
  ParseResult,
} from "./parser";
export { parseFormula, validateFormula } from "./parser";

export { evaluateFormula } from "./evaluate";

export { MAX_SOURCE_LENGTH, MAX_DEPTH, MAX_ARGS } from "./tokenizer";
