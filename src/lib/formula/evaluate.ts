/**
 * Formula evaluator.
 *
 * The walk is iterative — an explicit instruction stack, not recursion — so
 * that no AST, however deep or however it was constructed, can overflow the
 * JS stack. Work is O(number of AST nodes) and additionally bounded by a hard
 * step limit; there is no construct in the language that can loop.
 *
 * `evaluateFormula` never throws: every failure mode (missing field, bad
 * types, division by zero, unknown function, malformed AST) resolves to
 * `null`. See the coercion rules at the top of ./functions.ts.
 */
import {
  findFn,
  isBlank,
  sanitize,
  toBool,
  toNumber,
  toText,
  type FormulaValue,
} from "./functions";
import { MAX_ARGS } from "./tokenizer";
import type { AstNode, BinaryOp, FormulaAst } from "./parser";

/** Belt-and-braces bound on evaluator work (the parser already caps AST size). */
const MAX_STEPS = 100_000;

/**
 * Read one field out of the row.
 *
 * Uses hasOwnProperty so that `{constructor}`, `{__proto__}`, `{toString}` and
 * friends resolve to null instead of leaking a JS object/function into the
 * expression. Anything that is not a number/string/boolean/null (objects,
 * arrays, undefined, NaN, Infinity, Date) also reads as null.
 */
function lookupField(row: unknown, key: string): FormulaValue {
  if (row === null || typeof row !== "object") return null;
  if (row instanceof Map) return sanitize(row.get(key));
  if (!Object.prototype.hasOwnProperty.call(row, key)) return null;
  return sanitize((row as Record<string, unknown>)[key]);
}

/** Rule 7: numeric when both sides parse as numbers, stringwise otherwise. */
function looseEquals(l: FormulaValue, r: FormulaValue): boolean {
  if (l === null || r === null) return l === null && r === null;
  const ln = toNumber(l);
  const rn = toNumber(r);
  if (ln !== null && rn !== null) return ln === rn;
  return toText(l) === toText(r);
}

function compare(op: BinaryOp, l: FormulaValue, r: FormulaValue): FormulaValue {
  if (l === null || r === null) return null; // blank has no place in an ordering
  const ln = toNumber(l);
  const rn = toNumber(r);
  let cmp: number;
  if (ln !== null && rn !== null) {
    cmp = ln < rn ? -1 : ln > rn ? 1 : 0;
  } else {
    const ls = toText(l);
    const rs = toText(r);
    cmp = ls < rs ? -1 : ls > rs ? 1 : 0;
  }
  switch (op) {
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    default:
      return null;
  }
}

function applyBinary(op: BinaryOp, l: FormulaValue, r: FormulaValue): FormulaValue {
  switch (op) {
    case "&":
      return toText(l) + toText(r);
    case "=":
      return looseEquals(l, r);
    case "!=":
      return !looseEquals(l, r);
    case "<":
    case "<=":
    case ">":
    case ">=":
      return compare(op, l, r);
    case "+":
    case "-":
    case "*":
    case "/":
    case "%": {
      const a = toNumber(l);
      const b = toNumber(r);
      if (a === null || b === null) return null; // blank or unparseable poisons
      let out: number;
      if (op === "+") out = a + b;
      else if (op === "-") out = a - b;
      else if (op === "*") out = a * b;
      else if (op === "/") {
        if (b === 0) return null; // never Infinity
        out = a / b;
      } else {
        if (b === 0) return null; // never NaN
        out = a % b;
      }
      return Number.isFinite(out) ? out : null;
    }
    default:
      return null;
  }
}

function applyUnary(op: "-" | "+", v: FormulaValue): FormulaValue {
  const n = toNumber(v);
  if (n === null) return null;
  const out = op === "-" ? -n : n;
  return Number.isFinite(out) ? out : null;
}

type Instr =
  | { t: "node"; node: AstNode }
  | { t: "unary"; op: "-" | "+" }
  | { t: "binary"; op: BinaryOp }
  | { t: "logical"; op: "AND" | "OR"; right: AstNode }
  | { t: "bool" }
  | { t: "if"; then: AstNode; other: AstNode }
  | { t: "call"; name: string; argc: number };

function isNode(v: unknown): v is AstNode {
  return typeof v === "object" && v !== null && typeof (v as { kind?: unknown }).kind === "string";
}

/**
 * Evaluate a parsed AST against one row. Never throws — returns null on any
 * runtime problem.
 */
export function evaluateFormula(
  ast: FormulaAst,
  row: Record<string, FormulaValue>,
): FormulaValue {
  try {
    if (!isNode(ast)) return null;

    const work: Instr[] = [{ t: "node", node: ast }];
    const values: FormulaValue[] = [];
    let steps = 0;

    while (work.length > 0) {
      if (++steps > MAX_STEPS) return null;
      const instr = work.pop() as Instr;

      switch (instr.t) {
        case "node": {
          const node = instr.node;
          if (!isNode(node)) {
            values.push(null);
            break;
          }
          switch (node.kind) {
            case "lit":
              values.push(sanitize(node.value));
              break;
            case "field":
              values.push(lookupField(row, node.key));
              break;
            case "unary":
              work.push({ t: "unary", op: node.op === "-" ? "-" : "+" });
              work.push({ t: "node", node: node.operand });
              break;
            case "binary":
              // LIFO: left is evaluated first, then right, then the operator.
              work.push({ t: "binary", op: node.op });
              work.push({ t: "node", node: node.right });
              work.push({ t: "node", node: node.left });
              break;
            case "logical":
              work.push({ t: "logical", op: node.op, right: node.right });
              work.push({ t: "node", node: node.left });
              break;
            case "if":
              work.push({ t: "if", then: node.then, other: node.other });
              work.push({ t: "node", node: node.cond });
              break;
            case "call": {
              const args = Array.isArray(node.args) ? node.args : [];
              if (args.length > MAX_ARGS) {
                values.push(null);
                break;
              }
              work.push({ t: "call", name: node.name, argc: args.length });
              for (let i = args.length - 1; i >= 0; i--) {
                work.push({ t: "node", node: args[i] });
              }
              break;
            }
            default:
              values.push(null);
          }
          break;
        }

        case "unary": {
          const v = values.pop() ?? null;
          values.push(applyUnary(instr.op, v));
          break;
        }

        case "binary": {
          const r = values.pop() ?? null;
          const l = values.pop() ?? null;
          values.push(applyBinary(instr.op, l, r));
          break;
        }

        case "logical": {
          const l = values.pop() ?? null;
          const b = toBool(l);
          if (instr.op === "AND" && !b) {
            values.push(false); // short-circuit
          } else if (instr.op === "OR" && b) {
            values.push(true); // short-circuit
          } else {
            work.push({ t: "bool" });
            work.push({ t: "node", node: instr.right });
          }
          break;
        }

        case "bool": {
          const v = values.pop() ?? null;
          values.push(toBool(v));
          break;
        }

        case "if": {
          const cond = values.pop() ?? null;
          work.push({ t: "node", node: toBool(cond) ? instr.then : instr.other });
          break;
        }

        case "call": {
          const argc = Math.max(0, Math.min(MAX_ARGS, instr.argc));
          const args: FormulaValue[] = new Array(argc);
          for (let i = argc - 1; i >= 0; i--) args[i] = values.pop() ?? null;
          const def = findFn(instr.name);
          if (!def || argc < def.minArgs || argc > def.maxArgs) {
            values.push(null);
            break;
          }
          try {
            values.push(sanitize(def.call(args)));
          } catch {
            values.push(null);
          }
          break;
        }

        default:
          values.push(null);
      }
    }

    return values.length === 1 ? values[0] : null;
  } catch {
    return null;
  }
}

/** Re-exported for callers that want the blank test the engine itself uses. */
export { isBlank };
