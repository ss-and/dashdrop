/**
 * Formula value model, coercion rules and the built-in function library.
 *
 * ────────────────────────────── COERCION RULES ──────────────────────────────
 * These are the contract the whole engine is built on; every rule below has a
 * test in tests/formula.test.ts.
 *
 * 1. Values are only `number | string | boolean | null`. Anything else that
 *    reaches the evaluator from a row (object, array, undefined, NaN,
 *    Infinity, Date, function) is read as `null` — never coerced, never thrown.
 *
 * 2. NUMERIC COERCION (`toNumber`) is THE ONE numeric reading of a cell in this
 *    product. `toVlookupNumber` in src/lib/vlookup.ts delegates to it, and
 *    `toNumber` in src/lib/aggregate.ts must match it rule for rule:
 *      - number   → itself when finite, else null
 *      - boolean  → 1 / 0
 *      - string   → fold full-width/half-width variants (so 「１２３」 reads as
 *                   123 — Japanese Excel exports are full of full-width
 *                   digits), strip `, whitespace ¥ $ € £`, and accept the
 *                   result only if it is a plain decimal literal; a
 *                   whitespace-only / empty string is null (NOT 0)
 *      - null / anything else → null
 *    So "1,200" → 1200, "¥500" → 500 and 「１，２００」 → 1200, but "abc" → null.
 *    `%` is deliberately NOT stripped: "50%" is null, never 50 and never 0.5.
 *    Whether the author meant 50 or 0.5 is unknowable, and rule 3 says a wrong
 *    number is worse than no number. (Regression: vlookup used to strip `%`
 *    and report "50%" as 50, so a 割引率 column silently summed to nonsense.)
 *    Folding is width-only for the same reason: whole-string NFKC would read
 *    the list marker 「①」 as the number 1. And only decimal literals count:
 *    `Number()` reads "0x10" as 16, "0b11" as 3 and "Infinity" as ∞, but in
 *    business data those strings are 型番 and 商品コード, not numbers.
 *    Exponent notation ("1e3" → 1000) IS accepted, because spreadsheets write
 *    it. This matches `NUMERIC_RE` in src/lib/aggregate.ts exactly.
 *
 * 3. A failed numeric coercion POISONS the expression: any arithmetic on a
 *    value that will not parse yields `null` for the whole expression — never
 *    NaN, never 0. A wrong number is worse than no number.
 *    `null` arithmetic is likewise `null` (blank in ⇒ blank out).
 *
 * 4. Division and modulo by zero yield `null`, never Infinity/NaN.
 *
 * 5. TEXT COERCION (`toText`): null → "", true/false → "true"/"false",
 *    numbers via String(). Used by `&`, CONCAT and the string functions.
 *
 * 6. TRUTHINESS (`toBool`): null → false; boolean → itself; number → n !== 0
 *    (non-finite → false); string → false when it trims to "", "false" or "0"
 *    (case-insensitive), true otherwise. Spreadsheet imports store "0"/"false"
 *    as text, so treating them as falsy matches what users see in the cell.
 *
 * 7. EQUALITY (`=` `==` `!=` `<>`): numeric when BOTH sides parse as numbers,
 *    otherwise stringwise (i.e. as soon as either side is a non-numeric
 *    string). null equals only null; null vs. anything else is false.
 *    Ordering comparisons (`<` `<=` `>` `>=`) use the same numeric-or-string
 *    choice, but any null operand yields `null` (blank has no position in an
 *    ordering).
 *
 * 8. BLANK (`ISBLANK`, `COALESCE`): null or a whitespace-only string.
 *
 * 9. DATES are `"YYYY-MM-DD"` strings (a longer ISO string is accepted and
 *    truncated to its date part) and are parsed as UTC midnight, so DATEDIFF
 *    is DST-free integer arithmetic. `TODAY()` returns today's date IN JAPAN
 *    (Asia/Tokyo, UTC+9) as a "YYYY-MM-DD" string — see `todayInJst`. A
 *    non-date input yields null.
 *
 * 10. AGGREGATE functions (SUM/AVERAGE/MIN/MAX) SKIP blanks rather than
 *     poisoning — a blank cell is "not a data point". A present-but-
 *     unparseable value still poisons (rule 3). SUM of nothing is 0;
 *     AVERAGE/MIN/MAX of nothing is null.
 *
 * 11. String functions (LEFT/RIGHT/TRIM/UPPER/LOWER) propagate null, and count
 *     in Unicode code points (so emoji are not cut in half). LEN(null) is 0.
 *
 * 12. TEXT SIZE IS BOUNDED. No string a formula produces — or reads out of a
 *     cell — may exceed MAX_TEXT_LENGTH code points; anything longer is cut
 *     and marked with a Japanese 「…（省略）」 note so the truncation is visible
 *     rather than silent. This is a memory-safety bound, not a nicety: every
 *     other bound in the engine is per-formula (source length, depth, args,
 *     steps) and none of them bounds the SIZE OF A VALUE. Without this rule
 *     `CONCAT({t},{t})` doubles its input, `orderFormulaFields` feeds one
 *     formula's output into the next, and relations.ts evaluates the chain per
 *     record: 24 chained fields over a 10-character cell measured at a
 *     167,772,160-character string in 243 ms, and 28 fields OOM'd the server
 *     from a single record. A single formula also amplifies 128× within the
 *     2,000-character source cap via nested CONCAT. Capping the VALUE fixes
 *     both; a cap on the number of formula fields would only fix the first.
 */
import { MAX_ARGS } from "./tokenizer";

export type FormulaValue = number | string | boolean | null;

/* ----------------------------- coercion ---------------------------------- */

/** Narrow an arbitrary runtime value to a FormulaValue; anything else → null. */
export function sanitize(v: unknown): FormulaValue {
  if (v === null) return null;
  const t = typeof v;
  if (t === "string") return v as string;
  if (t === "boolean") return v as boolean;
  if (t === "number") return Number.isFinite(v as number) ? (v as number) : null;
  return null;
}

/**
 * Full-width / half-width variants (U+FF01–U+FFEE) plus the ideographic space.
 * A static pattern — this engine never builds a RegExp out of user input.
 */
const WIDTH_VARIANTS_RE = /[\u3000\uFF01-\uFFEE]+/g;

/**
 * Fold ONLY width variants, by NFKC-normalising the runs of characters that
 * ARE width variants and leaving every other character alone.
 *
 * Whole-string NFKC folds far more than width — 「①」→1, 「𝟙」→1, 「Ⅰ」→「I」,
 * 「㍿」→「株式会社」, 「㈱」→「(株)」 — and each of those is a different
 * character with a different meaning, not a different width. Reading 「①」 as
 * the number 1 (rule 2) or matching it against the key 「1」 (normaliseKey in
 * src/lib/vlookup.ts, which shares this helper) is a silent wrong answer.
 *
 * Matching runs rather than single characters keeps half-width katakana
 * dakuten composition working (「ｶ」+「ﾞ」 → 「ガ」), which needs both code
 * points normalised together.
 */
export function foldWidthVariants(s: string): string {
  return s.replace(WIDTH_VARIANTS_RE, (run) => run.normalize("NFKC"));
}

/**
 * A plain decimal literal, optionally signed, optionally with an exponent.
 * Kept identical to `NUMERIC_RE` in src/lib/aggregate.ts — see rule 2 for why
 * `Number()` alone is not good enough.
 */
const DECIMAL_LITERAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Rule 2/3 — the single numeric reading of a cell.
 *
 * `toVlookupNumber` (src/lib/vlookup.ts) is a thin wrapper around this, and
 * `toNumber` in src/lib/aggregate.ts must stay identical. Regression: the three
 * used to disagree on the same cell — 「１２３」 was null in a formula but 123 in
 * a vlookup, "50%" was null in a formula but 50 in a vlookup, "" was null in a
 * formula but 0 in aggregate.
 *
 * Width folding handles the full-width digits and punctuation that Japanese
 * Excel exports are full of. `%` is NOT stripped (see rule 2).
 */
export function toNumber(v: FormulaValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    // \s already covers U+3000, which the fold turns into a plain space anyway.
    const stripped = foldWidthVariants(v).replace(/[,\s¥$€£]/g, "");
    if (stripped === "" || !DECIMAL_LITERAL_RE.test(stripped)) return null;
    const n = Number(stripped);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/* ------------------------------ text bound -------------------------------- */

/**
 * Rule 12. Hard cap on the length of ANY string value inside the engine, in
 * Unicode code points.
 *
 * Deliberately generous for a spreadsheet cell (no grid shows 10,000
 * characters) and deliberately finite, because the engine's other bounds are
 * all per-formula and none of them bounds the size of a value. With this cap
 * the worst case is linear — one capped string per formula field per record —
 * instead of doubling with every chained field.
 */
export const MAX_TEXT_LENGTH = 10_000;

/** Japanese marker appended in place of the part that was cut. */
export const TEXT_TRUNCATION_NOTE = `…（${MAX_TEXT_LENGTH}文字を超えたため省略）`;

const TRUNCATION_NOTE_LENGTH = Array.from(TEXT_TRUNCATION_NOTE).length;

/**
 * Cut `s` to MAX_TEXT_LENGTH code points, appending {@link TEXT_TRUNCATION_NOTE}
 * so a truncated cell never looks like a complete one. The result is always
 * MAX_TEXT_LENGTH code points or fewer, so capping is idempotent.
 *
 * Cheap on the common path: strings at or under the cap are returned as-is
 * without allocating, and the code-point walk only runs when a cut is needed
 * (so an emoji or a surrogate pair is never split in half).
 */
export function capText(s: string): string {
  // A code point is at most 2 UTF-16 units, so length <= cap can never be over.
  if (s.length <= MAX_TEXT_LENGTH) return s;
  const cs = Array.from(s);
  if (cs.length <= MAX_TEXT_LENGTH) return s;
  return cs.slice(0, MAX_TEXT_LENGTH - TRUNCATION_NOTE_LENGTH).join("") + TEXT_TRUNCATION_NOTE;
}

/** {@link capText} for a whole value; non-strings pass through untouched. */
export function capValue(v: FormulaValue): FormulaValue {
  return typeof v === "string" ? capText(v) : v;
}

/** Rule 5. */
export function toText(v: FormulaValue): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/** Rule 6. */
export function toBool(v: FormulaValue): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) && v !== 0;
  const s = v.trim().toLowerCase();
  return s !== "" && s !== "false" && s !== "0";
}

/** Rule 8. */
export function isBlank(v: FormulaValue): boolean {
  return v === null || (typeof v === "string" && v.trim() === "");
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Rule 9. Returns a UTC-midnight timestamp in ms, or null. */
export function toDateMs(v: FormulaValue): number | null {
  if (typeof v !== "string") return null;
  const m = DATE_RE.exec(v.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  if (!Number.isFinite(ms)) return null;
  const back = new Date(ms);
  // Reject impossible days like 2026-02-30 (Date.UTC would roll them over).
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

/** Format a UTC timestamp as "YYYY-MM-DD". */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Japan Standard Time is a fixed UTC+9 with no DST, ever — so "today in Japan"
 * is exactly the UTC calendar date nine hours from now, with no ICU/timezone
 * database dependency and nothing to configure.
 *
 * Regression: TODAY() used to format `Date.now()` as a UTC date. The servers
 * run in UTC (there is no TZ set anywhere in the repo), so between 00:00 and
 * 09:00 JST it returned YESTERDAY and `DATEDIFF(TODAY(), {納期})` was off by
 * one for nine hours of every day. DATEDIFF itself is fine — it anchors date
 * strings at UTC midnight — only "today" was wrong.
 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Today's date in Japan as "YYYY-MM-DD". `now` is injectable for tests. */
export function todayInJst(now: number = Date.now()): string {
  return formatDate(now + JST_OFFSET_MS);
}

const DAY_MS = 86400000;

/** Excel-style half-away-from-zero rounding, tolerant of float representation. */
function roundHalfAway(x: number, digits: number): number | null {
  if (!Number.isFinite(x)) return null;
  const d = Math.max(-10, Math.min(10, Math.trunc(digits)));
  const f = Math.pow(10, d);
  const y = x * f;
  if (!Number.isFinite(y)) return null;
  const eps = Math.abs(y) * Number.EPSILON * 4;
  const r = y >= 0 ? Math.floor(y + 0.5 + eps) : Math.ceil(y - 0.5 - eps);
  const out = r / f;
  return Number.isFinite(out) ? out : null;
}

/** Code-point-safe character array (keeps emoji and surrogate pairs whole). */
function chars(s: string): string[] {
  return Array.from(s);
}

/* -------------------------- function registry ---------------------------- */

export interface FunctionDef {
  /** Canonical, upper-case name. */
  name: string;
  /** Human-readable signature, e.g. "(cond, a, b)". */
  args: string;
  description: string;
  minArgs: number;
  maxArgs: number;
  /** IF is evaluated lazily by the evaluator; this impl is the eager fallback. */
  lazy?: boolean;
  call: (args: FormulaValue[]) => FormulaValue;
}

/** Coerce arguments to numbers, skipping blanks (rule 10). */
function numsSkipBlank(args: FormulaValue[]): number[] | null {
  const out: number[] = [];
  for (const a of args) {
    if (isBlank(a)) continue;
    const n = toNumber(a);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

function unaryNum(fn: (n: number) => number) {
  return (args: FormulaValue[]): FormulaValue => {
    const n = toNumber(args[0] ?? null);
    if (n === null) return null;
    const r = fn(n);
    return Number.isFinite(r) ? r : null;
  };
}

function unaryStr(fn: (s: string) => FormulaValue) {
  return (args: FormulaValue[]): FormulaValue => {
    const v = args[0] ?? null;
    if (v === null) return null;
    return fn(toText(v));
  };
}

function datePart(pick: (d: Date) => number) {
  return (args: FormulaValue[]): FormulaValue => {
    const ms = toDateMs(args[0] ?? null);
    if (ms === null) return null;
    return pick(new Date(ms));
  };
}

function sideOf(side: "left" | "right") {
  return (args: FormulaValue[]): FormulaValue => {
    const v = args[0] ?? null;
    if (v === null) return null;
    const n = toNumber(args[1] ?? null);
    if (n === null) return null;
    const cs = chars(toText(v));
    const k = Math.max(0, Math.min(cs.length, Math.trunc(n)));
    return side === "left" ? cs.slice(0, k).join("") : cs.slice(cs.length - k).join("");
  };
}

const DEFS: FunctionDef[] = [
  {
    name: "IF",
    args: "(条件, 真のとき, 偽のとき)",
    description: "条件が真なら2番目、偽なら3番目の値を返す",
    minArgs: 3,
    maxArgs: 3,
    lazy: true,
    call: (a) => (toBool(a[0] ?? null) ? (a[1] ?? null) : (a[2] ?? null)),
  },
  {
    name: "AND",
    args: "(値1, 値2, ...)",
    description: "すべて真なら true",
    minArgs: 1,
    maxArgs: MAX_ARGS,
    call: (a) => a.every((v) => toBool(v)),
  },
  {
    name: "OR",
    args: "(値1, 値2, ...)",
    description: "いずれかが真なら true",
    minArgs: 1,
    maxArgs: MAX_ARGS,
    call: (a) => a.some((v) => toBool(v)),
  },
  {
    name: "NOT",
    args: "(値)",
    description: "真偽を反転する",
    minArgs: 1,
    maxArgs: 1,
    call: (a) => !toBool(a[0] ?? null),
  },
  {
    name: "ROUND",
    args: "(数値, 桁数?)",
    description: "四捨五入（桁数の既定は0）",
    minArgs: 1,
    maxArgs: 2,
    call: (a) => {
      const x = toNumber(a[0] ?? null);
      if (x === null) return null;
      let d = 0;
      if (a.length > 1) {
        const dd = toNumber(a[1] ?? null);
        if (dd === null) return null;
        d = dd;
      }
      return roundHalfAway(x, d);
    },
  },
  {
    name: "FLOOR",
    args: "(数値)",
    description: "小数点以下を切り捨て（負の無限大方向）",
    minArgs: 1,
    maxArgs: 1,
    call: unaryNum(Math.floor),
  },
  {
    name: "CEILING",
    args: "(数値)",
    description: "小数点以下を切り上げ（正の無限大方向）",
    minArgs: 1,
    maxArgs: 1,
    call: unaryNum(Math.ceil),
  },
  {
    name: "ABS",
    args: "(数値)",
    description: "絶対値",
    minArgs: 1,
    maxArgs: 1,
    call: unaryNum(Math.abs),
  },
  {
    name: "MIN",
    args: "(数値1, 数値2, ...)",
    description: "最小値（空欄は無視）",
    minArgs: 1,
    maxArgs: MAX_ARGS,
    call: (a) => {
      const ns = numsSkipBlank(a);
      if (ns === null || ns.length === 0) return null;
      return Math.min(...ns);
    },
  },
  {
    name: "MAX",
    args: "(数値1, 数値2, ...)",
    description: "最大値（空欄は無視）",
    minArgs: 1,
    maxArgs: MAX_ARGS,
    call: (a) => {
      const ns = numsSkipBlank(a);
      if (ns === null || ns.length === 0) return null;
      return Math.max(...ns);
    },
  },
  {
    name: "SUM",
    args: "(数値1, 数値2, ...)",
    description: "合計（空欄は無視）",
    minArgs: 1,
    maxArgs: MAX_ARGS,
    call: (a) => {
      const ns = numsSkipBlank(a);
      if (ns === null) return null;
      let total = 0;
      for (const n of ns) total += n;
      return Number.isFinite(total) ? total : null;
    },
  },
  {
    name: "AVERAGE",
    args: "(数値1, 数値2, ...)",
    description: "平均（空欄は無視）",
    minArgs: 1,
    maxArgs: MAX_ARGS,
    call: (a) => {
      const ns = numsSkipBlank(a);
      if (ns === null || ns.length === 0) return null;
      let total = 0;
      for (const n of ns) total += n;
      const avg = total / ns.length;
      return Number.isFinite(avg) ? avg : null;
    },
  },
  {
    name: "CONCAT",
    args: "(値1, 値2, ...)",
    description: "文字列を連結（空欄は空文字）",
    minArgs: 1,
    maxArgs: MAX_ARGS,
    // Bounded as it builds: joining 256 arguments first and cutting afterwards
    // would still allocate the oversized string rule 12 exists to prevent.
    // A code point costs at most 2 UTF-16 units, so once the buffer is past
    // 2 × the cap it is certainly over the cap in code points and no remaining
    // argument can change the capped result — which is why this stops early
    // only on that certainty, and never on the UTF-16 length alone.
    call: (a) => {
      let out = "";
      for (const v of a) {
        out += toText(v);
        if (out.length > MAX_TEXT_LENGTH * 2) break;
      }
      return capText(out);
    },
  },
  {
    name: "LEFT",
    args: "(文字列, 文字数)",
    description: "先頭から指定文字数を取り出す",
    minArgs: 2,
    maxArgs: 2,
    call: sideOf("left"),
  },
  {
    name: "RIGHT",
    args: "(文字列, 文字数)",
    description: "末尾から指定文字数を取り出す",
    minArgs: 2,
    maxArgs: 2,
    call: sideOf("right"),
  },
  {
    name: "LEN",
    args: "(文字列)",
    description: "文字数（空欄は0）",
    minArgs: 1,
    maxArgs: 1,
    call: (a) => chars(toText(a[0] ?? null)).length,
  },
  {
    name: "TRIM",
    args: "(文字列)",
    description: "前後の空白を削除",
    minArgs: 1,
    maxArgs: 1,
    call: unaryStr((s) => s.trim()),
  },
  {
    name: "UPPER",
    args: "(文字列)",
    description: "大文字に変換",
    minArgs: 1,
    maxArgs: 1,
    call: unaryStr((s) => s.toUpperCase()),
  },
  {
    name: "LOWER",
    args: "(文字列)",
    description: "小文字に変換",
    minArgs: 1,
    maxArgs: 1,
    call: unaryStr((s) => s.toLowerCase()),
  },
  {
    name: "COALESCE",
    args: "(値1, 値2, ...)",
    description: "最初の空でない値を返す",
    minArgs: 1,
    maxArgs: MAX_ARGS,
    call: (a) => {
      for (const v of a) if (!isBlank(v)) return v;
      return null;
    },
  },
  {
    name: "ISBLANK",
    args: "(値)",
    description: "空欄（null または空白のみ）なら true",
    minArgs: 1,
    maxArgs: 1,
    call: (a) => isBlank(a[0] ?? null),
  },
  {
    name: "DATEDIFF",
    args: "(開始日, 終了日)",
    description: "2つの日付の日数差（終了日 − 開始日）",
    minArgs: 2,
    maxArgs: 2,
    call: (a) => {
      const from = toDateMs(a[0] ?? null);
      const to = toDateMs(a[1] ?? null);
      if (from === null || to === null) return null;
      return Math.round((to - from) / DAY_MS);
    },
  },
  {
    name: "TODAY",
    args: "()",
    description: "今日の日付（日本時間、YYYY-MM-DD）",
    minArgs: 0,
    maxArgs: 0,
    call: () => todayInJst(),
  },
  {
    name: "YEAR",
    args: "(日付)",
    description: "日付の年",
    minArgs: 1,
    maxArgs: 1,
    call: datePart((d) => d.getUTCFullYear()),
  },
  {
    name: "MONTH",
    args: "(日付)",
    description: "日付の月（1〜12）",
    minArgs: 1,
    maxArgs: 1,
    call: datePart((d) => d.getUTCMonth() + 1),
  },
  {
    name: "DAY",
    args: "(日付)",
    description: "日付の日（1〜31）",
    minArgs: 1,
    maxArgs: 1,
    call: datePart((d) => d.getUTCDate()),
  },
];

/** Lookup table keyed by canonical upper-case name. Uses a Map, never an object. */
const REGISTRY: Map<string, FunctionDef> = new Map(DEFS.map((d) => [d.name, d]));

/** Case-insensitive function lookup. Returns undefined for unknown names. */
export function findFn(name: string): FunctionDef | undefined {
  if (typeof name !== "string") return undefined;
  return REGISTRY.get(name.toUpperCase());
}

/** Names/arity of every supported function, for help text and pickers. */
export const FORMULA_FUNCTIONS: {
  name: string;
  args: string;
  description: string;
}[] = DEFS.map((d) => ({ name: d.name, args: d.args, description: d.description }));
