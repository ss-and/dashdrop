import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseFormula,
  evaluateFormula,
  validateFormula,
  FORMULA_FUNCTIONS,
  MAX_ARGS,
  MAX_DEPTH,
  MAX_SOURCE_LENGTH,
  type FormulaAst,
  type FormulaValue,
} from "@/lib/formula";

type Row = Record<string, FormulaValue>;

/** Parse + evaluate; fails loudly when the source does not parse. */
function ev(src: string, row: Row = {}): FormulaValue {
  const parsed = parseFormula(src);
  if (!parsed.ok) {
    throw new Error(`expected "${src}" to parse, got: ${parsed.error}`);
  }
  return evaluateFormula(parsed.ast, row);
}

/** Assert the source does NOT parse and return the Japanese message. */
function parseError(src: string): string {
  const parsed = parseFormula(src);
  expect(parsed.ok, `expected "${src}" to be rejected`).toBe(false);
  return parsed.ok ? "" : parsed.error;
}

/** Japanese text (kana/kanji) — every user-facing error must contain some. */
const JA_RE = /[ぁ-んァ-ン一-龯]/;

/* ========================================================================== *
 * Literals, references, refs collection
 * ========================================================================== */

describe("literals and field references", () => {
  it("parses numeric literals", () => {
    expect(ev("12")).toBe(12);
    expect(ev("3.5")).toBe(3.5);
    expect(ev("-2")).toBe(-2);
    expect(ev("+2")).toBe(2);
    expect(ev("0")).toBe(0);
  });

  it("parses string literals with either quote and escapes", () => {
    expect(ev("'abc'")).toBe("abc");
    expect(ev('"abc"')).toBe("abc");
    expect(ev("''")).toBe("");
    expect(ev("'it\\'s'")).toBe("it's");
    expect(ev('"a\\nb"')).toBe("a\nb");
    expect(ev("'日本語 と スペース'")).toBe("日本語 と スペース");
  });

  it("parses true / false / null in any case", () => {
    expect(ev("true")).toBe(true);
    expect(ev("FALSE")).toBe(false);
    expect(ev("Null")).toBe(null);
  });

  it("reads braced field references, including Japanese keys and spaces", () => {
    expect(ev("{売上}", { 売上: 1200 })).toBe(1200);
    expect(ev("{unit price} * 2", { "unit price": 21 })).toBe(42);
  });

  it("reads bare identifiers as field references", () => {
    expect(ev("sales", { sales: 7 })).toBe(7);
    expect(ev("sales_2024 + 1", { sales_2024: 1 })).toBe(2);
  });

  it("collects refs from both forms, deduped, in first-appearance order", () => {
    const parsed = parseFormula("{b} + a + {a} + b + {b}");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.refs).toEqual(["b", "a"]);
  });

  it("collects refs from inside function calls", () => {
    const parsed = parseFormula("IF({x} > 0, SUM({y}, {z}), null)");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.refs).toEqual(["x", "y", "z"]);
  });

  it("rejects an empty or unterminated field reference", () => {
    expect(parseError("{}")).toMatch(JA_RE);
    expect(parseError("{unclosed")).toMatch(JA_RE);
    expect(parseError("}")).toMatch(JA_RE);
  });

  it("rejects an unterminated string", () => {
    expect(parseError("'abc")).toContain("文字列");
    expect(parseError('"abc')).toContain("文字列");
    expect(parseError("'abc\\")).toContain("文字列");
  });

  it("rejects malformed numbers", () => {
    expect(parseError("1.")).toMatch(JA_RE);
    expect(parseError("1..2")).toMatch(JA_RE);
    expect(parseError("12abc")).toMatch(JA_RE);
    expect(parseError("0x10")).toMatch(JA_RE);
  });

  it("rejects an empty formula", () => {
    expect(parseError("")).toContain("空");
    expect(parseError("   ")).toContain("空");
  });

  it("reports a position for most errors", () => {
    const parsed = parseFormula("1 + @");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.position).toBe(4);
  });
});

/* ========================================================================== *
 * Operators — precedence and associativity
 * ========================================================================== */

describe("operator precedence and associativity", () => {
  it("multiplication binds tighter than addition", () => {
    expect(ev("1+2*3")).toBe(7);
    expect(ev("2*3+1")).toBe(7);
    expect(ev("(1+2)*3")).toBe(9);
  });

  it("+ and - are left-associative", () => {
    expect(ev("10-3-2")).toBe(5);
    expect(ev("10-(3-2)")).toBe(9);
    expect(ev("1+2+3")).toBe(6);
  });

  it("* / % are left-associative and share a level", () => {
    expect(ev("100/10/2")).toBe(5);
    expect(ev("100/(10/2)")).toBe(20);
    expect(ev("2*3%4")).toBe(2);
    expect(ev("2*(3%4)")).toBe(6);
    expect(ev("10%3")).toBe(1);
    expect(ev("2+3%2")).toBe(3);
  });

  it("applies unary minus/plus before multiplication", () => {
    expect(ev("-2*3")).toBe(-6);
    expect(ev("2*-3")).toBe(-6);
    expect(ev("-(2+3)")).toBe(-5);
    expect(ev("--3")).toBe(3);
    expect(ev("-----1")).toBe(-1);
    expect(ev("-'1,200'")).toBe(-1200);
  });

  it("puts comparisons below arithmetic and makes them left-associative", () => {
    expect(ev("1+1 = 2")).toBe(true);
    expect(ev("2*3 > 5")).toBe(true);
    // (3 > 2) → true → true > 1 → 1 > 1 → false
    expect(ev("3 > 2 > 1")).toBe(false);
  });

  it("puts AND below comparison and OR below AND", () => {
    expect(ev("1 < 2 AND 2 < 3")).toBe(true);
    expect(ev("1 < 2 AND 3 < 2")).toBe(false);
    // AND binds tighter: true OR (false AND false) → true
    expect(ev("1 = 1 OR 1 = 2 AND 1 = 3")).toBe(true);
    expect(ev("(1 = 1 OR 1 = 2) AND 1 = 3")).toBe(false);
    expect(ev("true && false || true")).toBe(true);
  });

  it("treats & as string concatenation at the additive level", () => {
    expect(ev("'a' & 'b'")).toBe("ab");
    expect(ev("'a' & 'b' & 1")).toBe("ab1");
    expect(ev("1 + 2 & 'x'")).toBe("3x"); // (1+2) & 'x'
    expect(ev("'合計: ' & {n}", { n: 10 })).toBe("合計: 10");
    expect(ev("'x' & null")).toBe("x"); // null renders as empty
  });

  it("honours parentheses arbitrarily", () => {
    expect(ev("((((1+2))))*((3))")).toBe(9);
  });

  it("rejects unbalanced parentheses and stray operators", () => {
    expect(parseError("(1+2")).toMatch(JA_RE);
    expect(parseError("1+2)")).toMatch(JA_RE);
    expect(parseError("(")).toMatch(JA_RE);
    expect(parseError(")")).toMatch(JA_RE);
    expect(parseError("1+")).toMatch(JA_RE);
    expect(parseError("*2")).toMatch(JA_RE);
    expect(parseError("1//2")).toMatch(JA_RE);
    expect(parseError("1 2")).toMatch(JA_RE);
  });
});

/* ========================================================================== *
 * Comparison semantics
 * ========================================================================== */

describe("comparison semantics", () => {
  it("compares numerically when both sides parse as numbers", () => {
    expect(ev("1 = '1'")).toBe(true);
    expect(ev("'1.0' = 1")).toBe(true);
    expect(ev("'1,200' = 1200")).toBe(true);
    expect(ev("true = 1")).toBe(true);
    expect(ev("2 < 10")).toBe(true);
    expect(ev("'2' < '10'")).toBe(true); // numeric, not lexicographic
  });

  it("compares stringwise when either side is a non-numeric string", () => {
    expect(ev("'abc' = 'abc'")).toBe(true);
    expect(ev("'abc' = 'abd'")).toBe(false);
    expect(ev("'abc' = 1")).toBe(false);
    expect(ev("'abc' < 'abd'")).toBe(true);
    expect(ev("'abc' > 'abd'")).toBe(false);
  });

  it("accepts every spelling of the comparison operators", () => {
    expect(ev("1 == 1")).toBe(true);
    expect(ev("1 != 2")).toBe(true);
    expect(ev("1 <> 2")).toBe(true);
    expect(ev("1 <= 1")).toBe(true);
    expect(ev("1 >= 2")).toBe(false);
  });

  it("treats null as equal only to null, and unordered", () => {
    expect(ev("null = null")).toBe(true);
    expect(ev("null = 0")).toBe(false);
    expect(ev("null = ''")).toBe(false);
    expect(ev("null != 0")).toBe(true);
    expect(ev("null < 1")).toBe(null);
    expect(ev("1 > null")).toBe(null);
  });
});

/* ========================================================================== *
 * Functions
 * ========================================================================== */

describe("logical functions", () => {
  it("IF picks a branch", () => {
    expect(ev("IF(true, 1, 2)")).toBe(1);
    expect(ev("IF(false, 1, 2)")).toBe(2);
    expect(ev("IF(0, 'a', 'b')")).toBe("b");
    expect(ev("IF('', 'a', 'b')")).toBe("b");
    expect(ev("IF({x} > 0, '黒字', '赤字')", { x: 5 })).toBe("黒字");
    expect(ev("if(1, 'lower-case name works', 2)")).toBe("lower-case name works");
  });

  it("IF short-circuits the branch it does not take", () => {
    expect(ev("IF(false, 1/0, 'safe')")).toBe("safe");
    expect(ev("IF(true, 'safe', {missing} * 2)")).toBe("safe");
  });

  it("IF requires exactly 3 arguments", () => {
    expect(parseError("IF(1,2)")).toContain("IF");
    expect(parseError("IF(1,2,3,4)")).toContain("IF");
    expect(parseError("IF()")).toContain("IF");
  });

  it("AND / OR / NOT", () => {
    expect(ev("AND(true, true, 1)")).toBe(true);
    expect(ev("AND(true, 0)")).toBe(false);
    expect(ev("OR(false, '', null)")).toBe(false);
    expect(ev("OR(false, 'x')")).toBe(true);
    expect(ev("NOT(true)")).toBe(false);
    expect(ev("NOT(0)")).toBe(true);
    expect(ev("NOT('')")).toBe(true);
    expect(ev("NOT(null)")).toBe(true);
    expect(parseError("AND()")).toMatch(JA_RE);
    expect(parseError("NOT()")).toMatch(JA_RE);
    expect(parseError("NOT(1, 2)")).toMatch(JA_RE);
  });

  it("AND/OR operators short-circuit and always yield booleans", () => {
    expect(ev("false AND 1/0 = 1")).toBe(false);
    expect(ev("true OR {nope} = 1")).toBe(true);
    expect(ev("1 AND 'x'")).toBe(true);
    expect(ev("0 OR ''")).toBe(false);
  });
});

describe("numeric functions", () => {
  it("ROUND with and without digits, half away from zero", () => {
    expect(ev("ROUND(1.234, 2)")).toBe(1.23);
    expect(ev("ROUND(2.5)")).toBe(3);
    expect(ev("ROUND(-2.5)")).toBe(-3);
    expect(ev("ROUND(2.675, 2)")).toBe(2.68); // float-tolerant
    expect(ev("ROUND(1234.5678, -2)")).toBe(1200);
    expect(ev("ROUND(1250, -2)")).toBe(1300);
    expect(ev("ROUND('abc')")).toBe(null);
    expect(ev("ROUND(1, 'abc')")).toBe(null);
    expect(parseError("ROUND()")).toMatch(JA_RE);
    expect(parseError("ROUND(1,2,3)")).toMatch(JA_RE);
  });

  it("FLOOR / CEILING / ABS", () => {
    expect(ev("FLOOR(2.7)")).toBe(2);
    expect(ev("FLOOR(-2.1)")).toBe(-3);
    expect(ev("CEILING(2.1)")).toBe(3);
    expect(ev("CEILING(-2.9)")).toBe(-2);
    expect(ev("ABS(-5)")).toBe(5);
    expect(ev("ABS(5)")).toBe(5);
    expect(ev("ABS('abc')")).toBe(null);
    expect(ev("ABS(null)")).toBe(null);
    expect(parseError("FLOOR()")).toMatch(JA_RE);
    expect(parseError("CEILING(1,2)")).toMatch(JA_RE);
    expect(parseError("ABS(1,2)")).toMatch(JA_RE);
  });

  it("MIN / MAX / SUM / AVERAGE skip blanks but poison on junk", () => {
    expect(ev("MIN(3, 1, 2)")).toBe(1);
    expect(ev("MAX(3, 1, 2)")).toBe(3);
    expect(ev("SUM(1, 2, 3)")).toBe(6);
    expect(ev("AVERAGE(1, 2, 3)")).toBe(2);
    expect(ev("SUM('1,200', 300)")).toBe(1500);
    expect(ev("MIN(null, 5)")).toBe(5);
    expect(ev("SUM(null)")).toBe(0);
    expect(ev("AVERAGE(null)")).toBe(null);
    expect(ev("MIN(null)")).toBe(null);
    expect(ev("MAX(null)")).toBe(null);
    expect(ev("SUM(1, 'abc')")).toBe(null);
    expect(ev("MAX(1, 'abc')")).toBe(null);
    expect(ev("SUM(1)")).toBe(1);
    expect(parseError("SUM()")).toMatch(JA_RE);
    expect(parseError("AVERAGE()")).toMatch(JA_RE);
  });
});

describe("string functions", () => {
  it("CONCAT joins anything, blanks become empty", () => {
    expect(ev("CONCAT('a', 1, true, null)")).toBe("a1true");
    expect(ev("CONCAT('売上: ', {v})", { v: 100 })).toBe("売上: 100");
    expect(parseError("CONCAT()")).toMatch(JA_RE);
  });

  it("LEFT / RIGHT clamp and count code points", () => {
    expect(ev("LEFT('hello', 2)")).toBe("he");
    expect(ev("RIGHT('hello', 3)")).toBe("llo");
    expect(ev("LEFT('hello', 99)")).toBe("hello");
    expect(ev("LEFT('hello', -1)")).toBe("");
    expect(ev("LEFT('こんにちは', 2)")).toBe("こん");
    expect(ev("LEFT('😀😀', 1)")).toBe("😀"); // no broken surrogate halves
    expect(ev("LEFT(null, 2)")).toBe(null);
    expect(ev("LEFT('abc', 'x')")).toBe(null);
    expect(parseError("LEFT('abc')")).toMatch(JA_RE);
    expect(parseError("RIGHT('abc')")).toMatch(JA_RE);
  });

  it("LEN / TRIM / UPPER / LOWER", () => {
    expect(ev("LEN('hello')")).toBe(5);
    expect(ev("LEN('日本語')")).toBe(3);
    expect(ev("LEN(null)")).toBe(0);
    expect(ev("LEN('')")).toBe(0);
    expect(ev("TRIM('  a  ')")).toBe("a");
    expect(ev("TRIM(null)")).toBe(null);
    expect(ev("UPPER('abc')")).toBe("ABC");
    expect(ev("LOWER('ABC')")).toBe("abc");
    expect(ev("UPPER(null)")).toBe(null);
    expect(parseError("LEN()")).toMatch(JA_RE);
    expect(parseError("TRIM('a','b')")).toMatch(JA_RE);
  });
});

describe("blank handling", () => {
  it("COALESCE returns the first non-blank value", () => {
    expect(ev("COALESCE(null, '', 'x')")).toBe("x");
    expect(ev("COALESCE(null, null)")).toBe(null);
    expect(ev("COALESCE(0, 'x')")).toBe(0); // 0 is a value, not a blank
    expect(ev("COALESCE({a}, {b}, 'なし')", { a: null, b: "  " })).toBe("なし");
    expect(parseError("COALESCE()")).toMatch(JA_RE);
  });

  it("ISBLANK treats null and whitespace-only strings as blank", () => {
    expect(ev("ISBLANK(null)")).toBe(true);
    expect(ev("ISBLANK('')")).toBe(true);
    expect(ev("ISBLANK('  ')")).toBe(true);
    expect(ev("ISBLANK(0)")).toBe(false);
    expect(ev("ISBLANK('a')")).toBe(false);
    expect(ev("ISBLANK({missing})")).toBe(true);
    expect(parseError("ISBLANK()")).toMatch(JA_RE);
    expect(parseError("ISBLANK(1,2)")).toMatch(JA_RE);
  });
});

describe("date functions", () => {
  it("DATEDIFF counts whole days, end minus start", () => {
    // 2026 is NOT a leap year: Jan 31 days + Feb 28 days = 59.
    expect(ev("DATEDIFF('2026-01-01', '2026-03-01')")).toBe(59);
    expect(ev("DATEDIFF('2026-03-01', '2026-01-01')")).toBe(-59);
    // 2024 IS a leap year: 31 + 29 = 60.
    expect(ev("DATEDIFF('2024-01-01', '2024-03-01')")).toBe(60);
    expect(ev("DATEDIFF('2026-01-01', '2026-01-01')")).toBe(0);
    expect(ev("DATEDIFF('2026-01-31', '2026-02-01')")).toBe(1);
    // no DST drift: a range spanning a northern-hemisphere DST switch
    expect(ev("DATEDIFF('2026-03-01', '2026-04-01')")).toBe(31);
    expect(ev("DATEDIFF('2026-01-01T00:00:00Z', '2026-01-11T23:59:00Z')")).toBe(10);
  });

  it("DATEDIFF returns null for anything that is not a date", () => {
    expect(ev("DATEDIFF('2026-01-01', 'abc')")).toBe(null);
    expect(ev("DATEDIFF(null, '2026-01-01')")).toBe(null);
    expect(ev("DATEDIFF('2026-02-30', '2026-03-01')")).toBe(null); // impossible day
    expect(ev("DATEDIFF('2026-13-01', '2026-03-01')")).toBe(null);
    expect(ev("DATEDIFF(1, 2)")).toBe(null);
    expect(parseError("DATEDIFF('2026-01-01')")).toMatch(JA_RE);
  });

  it("TODAY returns today's UTC date as YYYY-MM-DD", () => {
    const today = ev("TODAY()");
    expect(typeof today).toBe("string");
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(today).toBe(new Date().toISOString().slice(0, 10));
    expect(ev("DATEDIFF(TODAY(), TODAY())")).toBe(0);
    expect(parseError("TODAY(1)")).toMatch(JA_RE);
  });

  it("YEAR / MONTH / DAY read UTC parts", () => {
    expect(ev("YEAR('2026-08-19')")).toBe(2026);
    expect(ev("MONTH('2026-08-19')")).toBe(8);
    expect(ev("DAY('2026-08-19')")).toBe(19);
    expect(ev("MONTH('2026-01-01T15:00:00Z')")).toBe(1);
    expect(ev("YEAR('nope')")).toBe(null);
    expect(ev("YEAR(null)")).toBe(null);
    expect(ev("DAY(20260819)")).toBe(null);
    expect(parseError("YEAR()")).toMatch(JA_RE);
    expect(parseError("MONTH('a','b')")).toMatch(JA_RE);
  });
});

describe("function names are case-insensitive", () => {
  it("accepts any casing", () => {
    expect(ev("round(1.5)")).toBe(2);
    expect(ev("Sum(1, 2)")).toBe(3);
    expect(ev("uPpEr('a')")).toBe("A");
  });

  it("rejects unknown functions with a Japanese message naming them", () => {
    const msg = parseError("FOO(1)");
    expect(msg).toContain("FOO");
    expect(msg).toMatch(JA_RE);
    expect(parseError("exec('rm -rf /')")).toContain("EXEC");
    expect(parseError("eval('1+1')")).toContain("EVAL");
  });
});

/* ========================================================================== *
 * Coercion rules
 * ========================================================================== */

describe("coercion rules", () => {
  it("parses spreadsheet-formatted numbers (mirrors aggregate.toNumber)", () => {
    expect(ev("'1,200' + 1")).toBe(1201);
    expect(ev("'¥500' * 2")).toBe(1000);
    expect(ev("'$1,000' + 0")).toBe(1000);
    expect(ev("'1 200' + 0")).toBe(1200);
    expect(ev("{v} * 2", { v: "1,250" })).toBe(2500);
    expect(ev("{v} + 1", { v: "¥ 1,000" })).toBe(1001);
  });

  it("poisons the expression to null (never NaN, never 0) on junk input", () => {
    expect(ev("'abc' * 2")).toBe(null);
    expect(ev("'abc' + 1")).toBe(null);
    expect(ev("1 + 'abc' + 1")).toBe(null);
    expect(ev("({a} + {b}) * 2", { a: 1, b: "junk" })).toBe(null);
    expect(ev("-'abc'")).toBe(null);
  });

  it("propagates blanks as null through arithmetic", () => {
    expect(ev("null + 1")).toBe(null);
    expect(ev("1 - null")).toBe(null);
    expect(ev("'' + 1")).toBe(null);
    expect(ev("'  ' + 1")).toBe(null);
    expect(ev("{missing} * 2")).toBe(null);
    expect(ev("{a} + 1", { a: null })).toBe(null);
  });

  it("coerces booleans to 1 / 0", () => {
    expect(ev("true + 1")).toBe(2);
    expect(ev("false + 1")).toBe(1);
    expect(ev("{flag} * 10", { flag: true })).toBe(10);
  });

  it("renders values as text for & and CONCAT", () => {
    expect(ev("'' & 1.5")).toBe("1.5");
    expect(ev("'' & true")).toBe("true");
    expect(ev("'' & null")).toBe("");
  });

  it("uses spreadsheet truthiness for strings", () => {
    expect(ev("IF('0', 'y', 'n')")).toBe("n");
    expect(ev("IF('false', 'y', 'n')")).toBe("n");
    expect(ev("IF('FALSE', 'y', 'n')")).toBe("n");
    expect(ev("IF(' ', 'y', 'n')")).toBe("n");
    expect(ev("IF('anything', 'y', 'n')")).toBe("y");
  });

  it("returns null for division and modulo by zero", () => {
    expect(ev("1/0")).toBe(null);
    expect(ev("0/0")).toBe(null);
    expect(ev("-1/0")).toBe(null);
    expect(ev("1 % 0")).toBe(null);
    expect(ev("1/'0'")).toBe(null);
    expect(ev("{a}/{b}", { a: 10, b: 0 })).toBe(null);
    expect(ev("{a}/{b}", { a: 10, b: null })).toBe(null);
    expect(Number.isFinite(ev("1/0") as number)).toBe(false);
  });
});

/* ========================================================================== *
 * The real use case
 * ========================================================================== */

describe("the real use case: 粗利 and 粗利率", () => {
  const src = "{sales} - {cost}";

  it("computes 粗利 = 売上 - 原価", () => {
    expect(ev(src, { sales: 1000, cost: 400 })).toBe(600);
    expect(ev(src, { sales: "1,000", cost: "¥400" })).toBe(600);
    expect(ev(src, { sales: 1000, cost: null })).toBe(null);
    expect(ev(src, {})).toBe(null);
  });

  it("computes 粗利率 with a guard against divide-by-zero", () => {
    const pct = "IF({sales} > 0, ROUND(({sales}-{cost})/{sales}*100, 1), null)";
    expect(ev(pct, { sales: 1000, cost: 400 })).toBe(60);
    expect(ev(pct, { sales: 3000, cost: 1000 })).toBe(66.7);
    expect(ev(pct, { sales: 0, cost: 100 })).toBe(null);
    expect(ev(pct, { sales: null, cost: 100 })).toBe(null);
    expect(ev(pct, { sales: "abc", cost: 100 })).toBe(null);
  });

  it("works with Japanese field keys", () => {
    expect(ev("{売上} - {原価}", { 売上: 12000, 原価: 4500 })).toBe(7500);
    const parsed = parseFormula("{売上} - {原価}");
    expect(parsed.ok && parsed.refs).toEqual(["売上", "原価"]);
  });

  it("supports a text label formula", () => {
    const label = "IF({sales} - {cost} > 0, '黒字 ' & ({sales}-{cost}), '赤字')";
    expect(ev(label, { sales: 1000, cost: 400 })).toBe("黒字 600");
    expect(ev(label, { sales: 100, cost: 400 })).toBe("赤字");
  });
});

/* ========================================================================== *
 * validateFormula
 * ========================================================================== */

describe("validateFormula", () => {
  it("accepts a formula whose refs all exist", () => {
    const res = validateFormula("{sales} - {cost}", ["sales", "cost", "tax"]);
    expect(res).toEqual({ ok: true, refs: ["sales", "cost"] });
  });

  it("accepts bare identifiers too", () => {
    expect(validateFormula("sales * 2", ["sales"])).toEqual({ ok: true, refs: ["sales"] });
  });

  it("accepts a formula with no refs", () => {
    expect(validateFormula("1 + 1", [])).toEqual({ ok: true, refs: [] });
  });

  it("rejects an unknown field with a Japanese message naming it", () => {
    const res = validateFormula("{sales} - {profit}", ["sales", "cost"]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("profit");
      expect(res.error).toMatch(JA_RE);
    }
  });

  it("names an unknown Japanese field", () => {
    const res = validateFormula("{売上} - {粗利}", ["売上"]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("粗利");
  });

  it("passes parse errors through", () => {
    const res = validateFormula("1 +", ["a"]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(JA_RE);
  });

  it("survives a non-array key list", () => {
    const res = validateFormula("{a}", null as unknown as string[]);
    expect(res.ok).toBe(false);
  });
});

/* ========================================================================== *
 * FORMULA_FUNCTIONS metadata
 * ========================================================================== */

describe("FORMULA_FUNCTIONS", () => {
  it("lists every documented function exactly once", () => {
    const names = FORMULA_FUNCTIONS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const expected of [
      "IF", "AND", "OR", "NOT",
      "ROUND", "FLOOR", "CEILING", "ABS", "MIN", "MAX", "SUM", "AVERAGE",
      "CONCAT", "LEFT", "RIGHT", "LEN", "TRIM", "UPPER", "LOWER",
      "COALESCE", "ISBLANK",
      "DATEDIFF", "TODAY", "YEAR", "MONTH", "DAY",
    ]) {
      expect(names).toContain(expected);
    }
    expect(names).toHaveLength(26);
  });

  it("gives every entry an upper-case name, a signature and a description", () => {
    for (const f of FORMULA_FUNCTIONS) {
      expect(f.name).toBe(f.name.toUpperCase());
      expect(f.args.startsWith("(")).toBe(true);
      expect(f.args.endsWith(")")).toBe(true);
      expect(f.description.length).toBeGreaterThan(0);
    }
  });

  it("every listed function is actually callable", () => {
    const arity: Record<string, number> = {
      IF: 3,
      TODAY: 0,
      LEFT: 2,
      RIGHT: 2,
      DATEDIFF: 2,
    };
    for (const f of FORMULA_FUNCTIONS) {
      const argCount = arity[f.name] ?? 1;
      const src = `${f.name}(${Array.from({ length: argCount }, () => "1").join(",")})`;
      const parsed = parseFormula(src);
      expect(parsed.ok, `${src} should parse`).toBe(true);
      if (parsed.ok) {
        expect(() => evaluateFormula(parsed.ast, {})).not.toThrow();
      }
    }
  });
});

/* ========================================================================== *
 * SAFETY — the point of this engine
 * ========================================================================== */

describe("safety 1: no dynamic code execution anywhere in the engine", () => {
  const dir = join(process.cwd(), "src/lib/formula");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("ships the expected modules", () => {
    expect(files.slice().sort()).toEqual([
      "evaluate.ts",
      "functions.ts",
      "index.ts",
      "parser.ts",
      "tokenizer.ts",
    ]);
  });

  for (const file of files) {
    it(`${file} contains no eval / Function constructor / dynamic import`, () => {
      const src = readFileSync(join(dir, file), "utf8");
      // The exact grep from the spec: eval( | new Function | Function(
      expect(src).not.toMatch(/eval\(|new Function|Function\(/);
      // ...plus dynamic import and other indirect execution vectors.
      expect(src).not.toMatch(/\bimport\s*\(/);
      expect(src).not.toMatch(/\brequire\s*\(/);
      expect(src).not.toMatch(/setTimeout|setInterval|globalThis\s*\[/);
    });
  }
});

describe("safety 2: nesting depth limit", () => {
  it(`rejects nesting deeper than ${MAX_DEPTH} levels`, () => {
    const deep = "(".repeat(200) + "1" + ")".repeat(200);
    const parsed = parseFormula(deep);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("ネスト");
      expect(parsed.error).toContain(String(MAX_DEPTH));
    }
  });

  it("rejects deeply nested function calls", () => {
    const deep = "ABS(".repeat(100) + "1" + ")".repeat(100);
    expect(parseError(deep)).toContain("ネスト");
  });

  it("rejects deep nesting without throwing, even at 900 levels", () => {
    const deep = "(".repeat(900) + "1" + ")".repeat(900);
    expect(() => parseFormula(deep)).not.toThrow();
    expect(parseFormula(deep).ok).toBe(false);
  });

  it("still accepts reasonable nesting", () => {
    const ok = "(".repeat(20) + "1+1" + ")".repeat(20);
    expect(ev(ok)).toBe(2);
    expect(ev("IF(1, IF(1, IF(1, IF(1, 'deep enough', 0), 0), 0), 0)")).toBe("deep enough");
  });
});

describe("safety 3: source length limit", () => {
  it(`rejects sources longer than ${MAX_SOURCE_LENGTH} characters`, () => {
    const long = "1+".repeat(1500) + "1"; // 3001 chars
    const parsed = parseFormula(long);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(String(MAX_SOURCE_LENGTH));
  });

  it("rejects at exactly one character over the limit and accepts at the limit", () => {
    expect(parseFormula("a".repeat(MAX_SOURCE_LENGTH + 1)).ok).toBe(false);
    expect(parseFormula("a".repeat(MAX_SOURCE_LENGTH)).ok).toBe(true);
  });

  it("checks length before doing any scanning work", () => {
    // Pathological but short-circuited: an unterminated string 100k chars long.
    const hostile = "'" + "x".repeat(100_000);
    const parsed = parseFormula(hostile);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(String(MAX_SOURCE_LENGTH));
  });
});

describe("safety 4: bounded work, no user-controlled recursion", () => {
  it(`rejects more than ${MAX_ARGS} arguments to a variadic function`, () => {
    const args = Array.from({ length: 300 }, (_, i) => String(i)).join(",");
    const parsed = parseFormula(`SUM(${args})`);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain(String(MAX_ARGS));
      expect(parsed.error).toMatch(JA_RE);
    }
    expect(parseFormula(`CONCAT(${args})`).ok).toBe(false);
  });

  it(`accepts exactly ${MAX_ARGS} arguments`, () => {
    const args = Array.from({ length: MAX_ARGS }, () => "1").join(",");
    expect(ev(`SUM(${args})`)).toBe(MAX_ARGS);
  });

  it("caps arguments again at evaluation time, for hand-built ASTs", () => {
    const ast = {
      kind: "call",
      name: "SUM",
      args: Array.from({ length: 300 }, () => ({ kind: "lit", value: 1 })),
    } as unknown as FormulaAst;
    let result: FormulaValue = 0;
    expect(() => {
      result = evaluateFormula(ast, {});
    }).not.toThrow();
    expect(result).toBe(null);
  });

  it("evaluates iteratively: a 20,000-deep AST does not overflow the stack", () => {
    let ast: unknown = { kind: "lit", value: 1 };
    for (let i = 0; i < 20_000; i++) {
      ast = { kind: "unary", op: "-", operand: ast };
    }
    let result: FormulaValue = null;
    expect(() => {
      result = evaluateFormula(ast as FormulaAst, {});
    }).not.toThrow();
    expect(result).toBe(1); // 20,000 negations = identity
  });

  it("evaluates a wide AST without blowing up", () => {
    const parsed = parseFormula(Array.from({ length: 200 }, (_, i) => String(i)).join("+"));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(evaluateFormula(parsed.ast, {})).toBe((199 * 200) / 2);
  });
});

describe("safety 5: prototype pollution / prototype leakage", () => {
  const dangerous = [
    "__proto__",
    "constructor",
    "prototype",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
  ];

  for (const key of dangerous) {
    it(`{${key}} resolves to null, not a JS object`, () => {
      const value = ev(`{${key}}`, {} as Row);
      expect(value).toBe(null);
      // and it stringifies as empty, so nothing leaks into a text formula
      expect(ev(`CONCAT({${key}})`, {} as Row)).toBe("");
      expect(ev(`ISBLANK({${key}})`, {} as Row)).toBe(true);
    });
  }

  it("ignores inherited properties", () => {
    const parent = { secret: "leaked", sales: 999 };
    const row = Object.create(parent) as Row;
    row.cost = 100;
    expect(ev("{secret}", row)).toBe(null);
    expect(ev("{sales}", row)).toBe(null);
    expect(ev("{cost}", row)).toBe(100); // own property still works
  });

  it("does not let a formula assign or mutate anything", () => {
    const row: Row = { a: 1 };
    ev("{a} + 1", row);
    expect(row).toEqual({ a: 1 });
    expect(Object.keys(row)).toEqual(["a"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("reads an own __proto__ property literally when one really exists", () => {
    const row = JSON.parse('{"__proto__": 5}') as Row;
    // Whatever the host object does, the engine must return a FormulaValue.
    const value = ev("{__proto__}", row);
    expect(value === 5 || value === null).toBe(true);
  });
});

describe("safety 6: evaluateFormula never throws", () => {
  const parsed = parseFormula("{a} + {b} & CONCAT({a}, LEFT({b}, {a}))");
  const ast = parsed.ok ? parsed.ast : ({ kind: "lit", value: null } as unknown as FormulaAst);

  const hostileRows: unknown[] = [
    {},
    { a: undefined, b: undefined },
    { a: NaN, b: Infinity },
    { a: -Infinity, b: -0 },
    { a: {}, b: [] },
    { a: [1, 2, 3], b: { nested: { deep: true } } },
    { a: new Date(), b: /regex/ },
    { a: () => "boom", b: Symbol("s") },
    { a: BigInt(10), b: null },
    { a: new Map(), b: new Set() },
    Object.create(null),
    { a: "1,200", b: "¥300" },
    null,
    undefined,
    "not an object",
    42,
    [],
  ];

  for (const [i, row] of hostileRows.entries()) {
    it(`survives hostile row #${i}`, () => {
      let result: FormulaValue = 0;
      expect(() => {
        result = evaluateFormula(ast, row as Row);
      }).not.toThrow();
      expect(["number", "string", "boolean", "object"]).toContain(typeof result);
      if (typeof result === "object") expect(result).toBe(null);
    });
  }

  const malformedAsts: unknown[] = [
    null,
    undefined,
    42,
    "lit",
    {},
    { kind: "nope" },
    { kind: "lit" },
    { kind: "lit", value: {} },
    { kind: "field" },
    { kind: "field", key: 5 },
    { kind: "unary", op: "?", operand: null },
    { kind: "binary", op: "??", left: null, right: null },
    { kind: "binary", op: "+", left: { kind: "lit", value: 1 } },
    { kind: "logical", op: "AND", left: null, right: null },
    { kind: "if", cond: null, then: null, other: null },
    { kind: "call", name: "NOPE", args: [] },
    { kind: "call", name: 123, args: null },
    { kind: "call", name: "SUM", args: [{ kind: "lit", value: 1 }] },
  ];

  for (const [i, bad] of malformedAsts.entries()) {
    it(`survives malformed AST #${i}`, () => {
      expect(() => evaluateFormula(bad as FormulaAst, { a: 1 })).not.toThrow();
    });
  }

  it("returns a FormulaValue for a self-referential AST without hanging", () => {
    const node: Record<string, unknown> = { kind: "unary", op: "-" };
    node.operand = node; // cycle
    let result: FormulaValue = 0;
    expect(() => {
      result = evaluateFormula(node as unknown as FormulaAst, {});
    }).not.toThrow();
    expect(result).toBe(null); // stopped by the step limit
  });
});

/* ========================================================================== *
 * Fuzz-ish robustness
 * ========================================================================== */

describe("robustness against malformed and hostile input", () => {
  const hostile: string[] = [
    "",
    " ",
    "(",
    ")",
    "()",
    "((",
    "))",
    "(,)",
    "1+",
    "+",
    "*",
    "1+*2",
    "1//2",
    "&&&",
    "||",
    "==",
    "1 2",
    "1,2",
    "IF(",
    "IF()",
    "IF(1,2",
    "SUM(1,)",
    "SUM(,)",
    "{}",
    "{ }",
    "{unclosed",
    "}",
    "{a}}",
    "{{a}}",
    "'",
    "'a",
    '"a',
    "'a\\",
    "\\",
    "@",
    "#!/bin/sh",
    "1;2",
    "a[0]",
    "a.b",
    "a=>b",
    "`x`",
    "${x}",
    "process.exit(1)",
    "require('fs')",
    "constructor.constructor('return 1')()",
    "this",
    "\u{1F600}",
    "\u{1F642} + \u{1F643}",
    "日本語の式",
    "١٢٣", // arabic-indic digits
    "　", // ideographic space
    "‮1+1", // right-to-left override
    " ",
    "-".repeat(500),
    "a".repeat(1500),
    "a".repeat(5000),
    "(".repeat(500),
    "1".repeat(1999),
    "SUM(" + "1,".repeat(400) + "1)",
    "IF(".repeat(50) + "1" + ")".repeat(50),
    "{" + "x".repeat(1500) + "}",
    "'" + "y".repeat(1900) + "'",
    "0/0",
    "1e999",
    "999999999999999999999999 * 999999999999999999999999",
  ];

  it("covers a broad hostile corpus", () => {
    expect(hostile.length).toBeGreaterThanOrEqual(40);
  });

  for (const [i, src] of hostile.entries()) {
    const label = src.length > 24 ? `${JSON.stringify(src.slice(0, 24))}…(len ${src.length})` : JSON.stringify(src);
    it(`#${i} never throws on ${label}`, () => {
      let raw: ReturnType<typeof parseFormula> | undefined;
      expect(() => {
        raw = parseFormula(src);
      }).not.toThrow();
      expect(raw).toBeDefined();
      const parsed = raw as ReturnType<typeof parseFormula>;

      if (!parsed.ok) {
        // Errors are always user-facing Japanese strings.
        expect(typeof parsed.error).toBe("string");
        expect(parsed.error.length).toBeGreaterThan(0);
        expect(parsed.error).toMatch(JA_RE);
        if (parsed.position !== undefined) {
          expect(Number.isInteger(parsed.position)).toBe(true);
          expect(parsed.position).toBeGreaterThanOrEqual(0);
        }
        return;
      }

      // Anything that DOES parse must evaluate without throwing.
      let value: FormulaValue = 0;
      expect(() => {
        value = evaluateFormula(parsed.ast, { x: 1, a: "1,000" });
      }).not.toThrow();
      expect(["number", "string", "boolean", "object"]).toContain(typeof value);
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      if (typeof value === "object") expect(value).toBe(null);
    });
  }

  it("tolerates non-string input to the public API", () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(() => parseFormula(bad as unknown as string)).not.toThrow();
      expect(parseFormula(bad as unknown as string).ok).toBe(false);
      expect(() => validateFormula(bad as unknown as string, [])).not.toThrow();
    }
  });
});
