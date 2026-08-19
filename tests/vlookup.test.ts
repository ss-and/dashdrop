/**
 * Sheet joins (`vlookup`) — the pure core.
 *
 * Everything here runs without a database: `src/lib/relations.ts` only wraps
 * these functions with the workspace-scoped Prisma queries, so the whole
 * matching / aggregation / validation algorithm is covered here.
 */
import { describe, it, expect, vi } from "vitest";
import {
  NUMERIC_VLOOKUP_AGGREGATES,
  VLOOKUP_AGGREGATES,
  VLOOKUP_AGGREGATE_LABELS,
  VLOOKUP_CONCAT_LIMIT,
  VLOOKUP_TARGET_ROW_CAP,
  buildKeyIndex,
  isVlookupAggregate,
  normaliseKey,
  resolveVlookupField,
  resolveVlookupValues,
  toVlookupNumber,
  vlookupTruncationWarning,
  validateVlookupConfig,
  type VlookupAggregate,
  type VlookupConfig,
  type VlookupRow,
} from "@/lib/vlookup";
import { ApiError } from "@/lib/errors";
import { sanitize, toNumber } from "@/lib/formula";

/** 売上 rows: the sheet the vlookup column lives on. */
function sales(...names: Array<unknown>): VlookupRow[] {
  return names.map((取引先名) => ({ data: { 取引先名 } }));
}

/** 顧客マスター rows. */
function customers(
  ...rows: Array<[unknown, unknown]>
): VlookupRow[] {
  return rows.map(([取引先名, 業種]) => ({ data: { 取引先名, 業種 } }));
}

const baseConfig: VlookupConfig = {
  targetCollectionId: "col_customers",
  localKey: "取引先名",
  targetKey: "取引先名",
  targetField: "業種",
};

function cfg(patch: Partial<VlookupConfig> = {}): VlookupConfig {
  return { ...baseConfig, ...patch };
}

// ---------------------------------------------------------------------------
// Key normalisation
// ---------------------------------------------------------------------------

describe("normaliseKey", () => {
  it("trims, case-folds and folds width variants", () => {
    expect(normaliseKey("株式会社アオイ ")).toBe("株式会社アオイ");
    expect(normaliseKey("　株式会社アオイ　")).toBe("株式会社アオイ"); // 全角スペース
    expect(normaliseKey("ｱｵｲ")).toBe(normaliseKey("アオイ"));
    expect(normaliseKey("ＡＢＣ商事")).toBe(normaliseKey("abc商事"));
    expect(normaliseKey("Aoi Corp")).toBe(normaliseKey("aoi corp"));
    expect(normaliseKey("株式会社　アオイ")).toBe(normaliseKey("株式会社 アオイ"));
  });

  it("returns null for empty-ish keys so blanks never collide", () => {
    expect(normaliseKey(null)).toBeNull();
    expect(normaliseKey(undefined)).toBeNull();
    expect(normaliseKey("")).toBeNull();
    expect(normaliseKey("   ")).toBeNull();
    expect(normaliseKey("　")).toBeNull();
    expect(normaliseKey([])).toBeNull();
  });

  it("stringifies numbers, booleans and arrays consistently", () => {
    expect(normaliseKey(1000)).toBe("1000");
    expect(normaliseKey("1000")).toBe("1000");
    expect(normaliseKey("１０００")).toBe("1000");
    expect(normaliseKey(true)).toBe("true");
    expect(normaliseKey(["a", "b"])).toBe("a,b");
  });

  /**
   * Regression (P1-13): the rule was "NFKC", and whole-string NFKC folds far
   * more than width. Measured merges that nobody asked for: 「①」→1, 「𝟙」→1,
   * 「Ⅰ」(Roman numeral)→the letter i, 「㍿」→株式会社, 「㈱」→(株). A 商品コード
   * column mixing 「①②③」 with 「1 2 3」 is two different code systems and the
   * join merged them silently. Width and case folding stay; the rest does not.
   */
  it("does NOT merge keys that are merely similar-looking", () => {
    const distinct: Array<[string, string]> = [
      ["①", "1"], // circled digit
      ["𝟙", "1"], // mathematical double-struck digit
      ["Ⅰ", "i"], // Roman numeral one vs. the letter i
      ["Ⅱ", "ii"],
      ["㍿", "株式会社"], // square ligature
      ["㈱", "(株)"], // parenthesised ideograph
      ["㌢", "センチ"], // square katakana abbreviation
    ];
    for (const [a, b] of distinct) {
      expect(normaliseKey(a), `${a} must not fold to ${b}`).not.toBe(normaliseKey(b));
      expect(normaliseKey(a)).not.toBeNull();
    }
  });

  it("keeps the width and case folding the docstring promises", () => {
    // Documented and intended — these MUST keep matching.
    expect(normaliseKey("０１２")).toBe(normaliseKey("012"));
    expect(normaliseKey("ＡＢＣ")).toBe(normaliseKey("abc"));
    expect(normaliseKey("ｱｵｲ")).toBe(normaliseKey("アオイ"));
    expect(normaliseKey("ｶﾞｽ")).toBe(normaliseKey("ガス")); // dakuten composition
    expect(normaliseKey("（株）")).toBe(normaliseKey("(株)")); // full-width parens
    expect(normaliseKey("￥1,000")).toBe(normaliseKey("¥1,000"));
    // Canonically-equivalent sequences are the same character, so they match.
    expect(normaliseKey("ガス")).toBe(normaliseKey("カ\u3099ス"));
  });
});

describe("toVlookupNumber", () => {
  it("parses money-ish strings and rejects text", () => {
    expect(toVlookupNumber(1200)).toBe(1200);
    expect(toVlookupNumber("1,200")).toBe(1200);
    expect(toVlookupNumber("¥1,200")).toBe(1200);
    expect(toVlookupNumber("１２００")).toBe(1200);
    expect(toVlookupNumber("不明")).toBeNull();
    expect(toVlookupNumber("")).toBeNull();
    expect(toVlookupNumber(null)).toBeNull();
    expect(toVlookupNumber(Number.NaN)).toBeNull();
  });

  /**
   * Regression (P1-11): three implementations of "read this cell as a number"
   * disagreed. This one stripped `%`, so 「50%」 came back as 50 — neither 50%
   * nor 0.5, just a wrong number — while a formula read the same cell as null.
   * There is now one implementation; this file only wraps it.
   */
  it("agrees with the formula engine on every cell, including 「50%」", () => {
    for (const cell of [
      "１２３", "50%", "５０％", "", "   ", "　", "1,200", "¥500", "￥500",
      "abc", "0", "-1,500", "1e999", "0x10", true, false, null, 42, {},
    ]) {
      expect(toVlookupNumber(cell), JSON.stringify(cell)).toBe(
        toNumber(sanitize(cell)),
      );
    }
    expect(toVlookupNumber("50%")).toBeNull();
    expect(toVlookupNumber("１２３")).toBe(123);
  });
});

// ---------------------------------------------------------------------------
// Index build
// ---------------------------------------------------------------------------

describe("buildKeyIndex", () => {
  it("buckets rows by normalised key, keeping the sheet's own order", () => {
    const index = buildKeyIndex(
      customers(["アオイ", "製造"], ["アオイ ", "卸売"], ["ミドリ", "小売"]),
      "取引先名",
    );
    expect([...index.keys()]).toEqual(["アオイ", "ミドリ"]);
    expect(index.get("アオイ")).toHaveLength(2);
    expect(index.get("アオイ")?.[0]?.data.業種).toBe("製造");
  });

  it("drops rows whose key is blank", () => {
    const index = buildKeyIndex(
      customers(["", "製造"], [null, "卸売"], ["  ", "小売"], ["アオイ", "IT"]),
      "取引先名",
    );
    expect(index.size).toBe(1);
    expect(index.get("アオイ")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

describe("resolveVlookupValues — matching", () => {
  const master = customers(
    ["株式会社アオイ", "製造"],
    ["ミドリ商事", "卸売"],
  );

  it("pulls the value on an exact match (VLOOKUP)", () => {
    const out = resolveVlookupValues(cfg(), sales("株式会社アオイ", "ミドリ商事"), master);
    expect(out).toEqual(["製造", "卸売"]);
  });

  it("returns null when nothing matches", () => {
    expect(resolveVlookupValues(cfg(), sales("知らない会社"), master)).toEqual([null]);
  });

  it("returns 0 (not null) for count when nothing matches", () => {
    expect(
      resolveVlookupValues(cfg({ aggregate: "count" }), sales("知らない会社"), master),
    ).toEqual([0]);
  });

  it("matches across trailing spaces, width and case", () => {
    const rows = sales(
      "株式会社アオイ ", // trailing half-width space
      "株式会社アオイ　", // trailing full-width space
      "株式会社ｱｵｲ", // half-width katakana (NFKC)
      "ミドリ商事",
    );
    expect(resolveVlookupValues(cfg(), rows, master)).toEqual([
      "製造",
      "製造",
      "製造",
      "卸売",
    ]);

    const latin = customers(["Aoi Corp", "製造"]);
    expect(resolveVlookupValues(cfg(), sales("AOI CORP", "aoi corp "), latin)).toEqual([
      "製造",
      "製造",
    ]);
  });

  it("never matches on an empty local key or an empty target key", () => {
    const withBlanks = customers(["", "製造"], [null, "卸売"], ["アオイ", "IT"]);
    const rows = sales("", null, "   ", "アオイ");
    expect(resolveVlookupValues(cfg(), rows, withBlanks)).toEqual([
      null,
      null,
      null,
      "IT",
    ]);
  });

  it("returns blanks when the config is incomplete", () => {
    const rows = sales("株式会社アオイ");
    expect(resolveVlookupValues(cfg({ targetField: "" }), rows, master)).toEqual([null]);
    expect(resolveVlookupValues(cfg({ localKey: "" }), rows, master)).toEqual([null]);
    expect(
      resolveVlookupValues(cfg({ targetKey: "", aggregate: "count" }), rows, master),
    ).toEqual([0]);
  });

  it("treats an empty pulled value as null for `first`", () => {
    const master2 = customers(["アオイ", ""]);
    expect(resolveVlookupValues(cfg(), sales("アオイ"), master2)).toEqual([null]);
  });
});

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

describe("resolveVlookupValues — aggregates over multiple matches", () => {
  /** Three 明細 rows for アオイ, one for ミドリ. */
  const detail: VlookupRow[] = [
    { data: { 取引先名: "アオイ", 金額: 1000, 区分: "A" } },
    { data: { 取引先名: "アオイ ", 金額: "2,000", 区分: "B" } },
    { data: { 取引先名: "ｱｵｲ", 金額: 3000, 区分: "A" } },
    { data: { 取引先名: "ミドリ", 金額: 50, 区分: "C" } },
  ];
  const money = (aggregate: VlookupAggregate) =>
    resolveVlookupValues(
      cfg({ targetField: "金額", aggregate }),
      sales("アオイ"),
      detail,
      "currency",
    )[0];

  it("first returns the first match in the target's own order", () => {
    expect(money("first")).toBe(1000);
  });
  it("sum adds every match (SUMIF), parsing 「2,000」", () => {
    expect(money("sum")).toBe(6000);
  });
  it("avg averages the matches, rounded to 2 decimals", () => {
    expect(money("avg")).toBe(2000);
    expect(
      resolveVlookupValues(
        cfg({ targetField: "金額", aggregate: "avg" }),
        sales("アオイ"),
        [
          { data: { 取引先名: "アオイ", 金額: 1 } },
          { data: { 取引先名: "アオイ", 金額: 2 } },
          { data: { 取引先名: "アオイ", 金額: 2 } },
        ],
      )[0],
    ).toBe(1.67);
  });
  it("count counts matching rows (COUNTIF)", () => {
    expect(money("count")).toBe(3);
  });
  it("min / max scan the matches", () => {
    expect(money("min")).toBe(1000);
    expect(money("max")).toBe(3000);
  });

  it("numeric aggregates ignore unparseable values", () => {
    const messy: VlookupRow[] = [
      { data: { 取引先名: "アオイ", 金額: "不明" } },
      { data: { 取引先名: "アオイ", 金額: 100 } },
      { data: { 取引先名: "アオイ", 金額: null } },
      { data: { 取引先名: "アオイ", 金額: "¥250" } },
    ];
    const run = (aggregate: VlookupAggregate) =>
      resolveVlookupValues(
        cfg({ targetField: "金額", aggregate }),
        sales("アオイ"),
        messy,
      )[0];
    expect(run("sum")).toBe(350);
    expect(run("avg")).toBe(175);
    expect(run("min")).toBe(100);
    expect(run("max")).toBe(250);
    // 件数 counts rows that HAVE a value: the null row is not a data point.
    // 「不明」 is a value, so it is counted even though the numeric modes cannot
    // read it — the one residual gap, and only reachable on a non-numeric
    // column, which validateVlookupConfig refuses for 合計/平均/最小/最大.
    expect(run("count")).toBe(3);
  });

  it("sum of no parseable value is null (not 0)", () => {
    const none: VlookupRow[] = [
      { data: { 取引先名: "アオイ", 金額: "不明" } },
      { data: { 取引先名: "アオイ", 金額: "" } },
    ];
    for (const a of ["sum", "avg", "min", "max"] as VlookupAggregate[]) {
      expect(
        resolveVlookupValues(cfg({ targetField: "金額", aggregate: a }), sales("アオイ"), none)[0],
      ).toBeNull();
    }
  });

  it("concat joins distinct display values with 、", () => {
    expect(
      resolveVlookupValues(
        cfg({ targetField: "区分", aggregate: "concat" }),
        sales("アオイ"),
        detail,
      )[0],
    ).toBe("A、B");
  });

  it("concat caps at 10 values", () => {
    const many: VlookupRow[] = Array.from({ length: 25 }, (_, i) => ({
      data: { 取引先名: "アオイ", 区分: `分類${i}` },
    }));
    const out = String(
      resolveVlookupValues(
        cfg({ targetField: "区分", aggregate: "concat" }),
        sales("アオイ"),
        many,
      )[0],
    );
    expect(out.split("、")).toHaveLength(VLOOKUP_CONCAT_LIMIT);
    expect(out.startsWith("分類0、分類1")).toBe(true);
  });

  it("concat of only-empty values is null", () => {
    expect(
      resolveVlookupValues(
        cfg({ targetField: "区分", aggregate: "concat" }),
        sales("アオイ"),
        [{ data: { 取引先名: "アオイ", 区分: "" } }, { data: { 取引先名: "アオイ" } }],
      )[0],
    ).toBeNull();
  });

  it("an unknown aggregate falls back to first", () => {
    expect(
      resolveVlookupValues(
        { ...baseConfig, aggregate: "median" as unknown as VlookupAggregate },
        sales("アオイ"),
        customers(["アオイ", "製造"]),
      ),
    ).toEqual(["製造"]);
  });
});

// ---------------------------------------------------------------------------
// Performance shape: one index build, one pass
// ---------------------------------------------------------------------------

describe("resolveVlookupValues — performance shape", () => {
  it("resolves 1,000 local rows against 5,000 target rows in one pass", () => {
    const targetRows: VlookupRow[] = Array.from(
      { length: VLOOKUP_TARGET_ROW_CAP },
      (_, i) => ({ data: { 取引先名: `会社${i}`, 業種: `業種${i % 7}` } }),
    );
    const localRows: VlookupRow[] = Array.from({ length: 1000 }, (_, i) => ({
      data: { 取引先名: `会社${i * 3}　` },
    }));

    // Spy on Map.prototype.get: a nested scan would call it far more than once
    // per local row; the index itself is built with `set`.
    const getSpy = vi.spyOn(Map.prototype, "get");
    const setSpy = vi.spyOn(Map.prototype, "set");
    const started = Date.now();
    const out = resolveVlookupValues(cfg(), localRows, targetRows);
    const elapsed = Date.now() - started;
    const gets = getSpy.mock.calls.length;
    const sets = setSpy.mock.calls.length;
    getSpy.mockRestore();
    setSpy.mockRestore();

    expect(out).toHaveLength(1000);
    expect(out[0]).toBe("業種0");
    expect(out[1]).toBe("業種3");
    // Index built once: one `set` per distinct target key (no rebuild per row).
    expect(sets).toBe(VLOOKUP_TARGET_ROW_CAP);
    // One index probe per local row (plus the per-row bucket append lookups).
    expect(gets).toBeLessThanOrEqual(localRows.length + targetRows.length);
    expect(elapsed).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// P0-2: the 5,000-row cap must never be silent
// ---------------------------------------------------------------------------

describe("resolveVlookupField — truncation of the target set", () => {
  const master = (n: number, from = 0): VlookupRow[] =>
    Array.from({ length: n }, (_, i) => ({
      data: { 取引先名: `会社${from + i}`, 業種: `業種${from + i}` },
    }));

  it("reports a complete target set as not truncated", () => {
    const out = resolveVlookupField(cfg(), sales("会社1"), master(10));
    expect(out.values).toEqual(["業種1"]);
    expect(out.truncated).toBe(false);
    expect(out.warning).toBeNull();
    expect(out.loaded).toBe(10);
    expect(out.total).toBe(10);
  });

  it("treats exactly the cap with a matching count as complete", () => {
    const rows = master(VLOOKUP_TARGET_ROW_CAP);
    const out = resolveVlookupField(cfg(), sales("会社0"), rows, "text", {
      targetTotal: VLOOKUP_TARGET_ROW_CAP,
    });
    expect(out.truncated).toBe(false);
    expect(out.warning).toBeNull();
  });

  /**
   * Regression (P0-2): the cap was applied with `orderBy: createdAt asc` and
   * nothing anywhere reported it — no count query, no flag, no UI string. Pro
   * allows 50,000 rows per collection and Business 1,000,000, so on a 20,000-row
   * 顧客マスター 75% of the keys resolved to null (or 0 for 件数) — and because
   * of the ordering it was always the NEWEST customers that vanished. The join
   * looked like it worked and returned wrong numbers.
   */
  it("reports truncation, in Japanese, when the caller's count exceeds the cap", () => {
    const loaded = master(VLOOKUP_TARGET_ROW_CAP);
    const out = resolveVlookupField(
      cfg(),
      sales("会社0", "会社19999"),
      loaded,
      "text",
      { targetTotal: 20000 },
    );
    expect(out.truncated).toBe(true);
    expect(out.loaded).toBe(VLOOKUP_TARGET_ROW_CAP);
    expect(out.total).toBe(20000);
    // The row inside the cap resolves; the one past it is indistinguishable
    // from "no such customer" — which is exactly why the warning must exist.
    expect(out.values[0]).toBe("業種0");
    expect(out.values[1]).toBeNull();

    const warning = String(out.warning);
    expect(warning).toMatch(/[ぁ-んァ-ン一-龯]/);
    expect(warning).toContain("20,000");
    expect(warning).toContain("5,000");
    expect(warning).toContain("15,000"); // how many rows are missing
    expect(warning).toBe(vlookupTruncationWarning(VLOOKUP_TARGET_ROW_CAP, 20000));
  });

  it("enforces the cap itself, so a caller that forgets `take` cannot blow it", () => {
    const out = resolveVlookupField(cfg(), sales("会社0"), master(VLOOKUP_TARGET_ROW_CAP + 500));
    expect(out.loaded).toBe(VLOOKUP_TARGET_ROW_CAP);
    expect(out.total).toBe(VLOOKUP_TARGET_ROW_CAP + 500);
    expect(out.truncated).toBe(true);
  });

  it("ignores a nonsensical targetTotal instead of under-reporting", () => {
    const rows = master(100);
    for (const targetTotal of [0, -5, 12, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = resolveVlookupField(cfg(), sales("会社0"), rows, "text", { targetTotal });
      expect(out.total).toBe(100);
      expect(out.truncated).toBe(false);
    }
  });

  it("still reports truncation when the config is incomplete", () => {
    const out = resolveVlookupField(
      cfg({ targetField: "" }),
      sales("会社0"),
      master(VLOOKUP_TARGET_ROW_CAP),
      "text",
      { targetTotal: 9999 },
    );
    expect(out.values).toEqual([null]);
    expect(out.truncated).toBe(true);
  });

  it("resolveVlookupValues is exactly resolveVlookupField's values", () => {
    const rows = master(50);
    expect(resolveVlookupValues(cfg(), sales("会社3"), rows)).toEqual(
      resolveVlookupField(cfg(), sales("会社3"), rows).values,
    );
  });
});

// ---------------------------------------------------------------------------
// Mode consistency: a blank cell is not a data point, in ANY mode
// ---------------------------------------------------------------------------

describe("resolveVlookupValues — blank cells are skipped by every aggregate", () => {
  /** アオイ has four rows; the first two have no 金額 at all. */
  const patchy: VlookupRow[] = [
    { data: { 取引先名: "アオイ", 金額: null, 区分: null } },
    { data: { 取引先名: "アオイ", 金額: "  ", 区分: "  " } },
    { data: { 取引先名: "アオイ", 金額: 10, 区分: "A" } },
    { data: { 取引先名: "アオイ", 金額: 20, 区分: "B" } },
  ];
  const run = (aggregate: VlookupAggregate, targetField = "金額") =>
    resolveVlookupValues(cfg({ targetField, aggregate }), sales("アオイ"), patchy)[0];

  /**
   * Regression: `first` returned the first ROW's value even when it was blank,
   * so a filled row two lines down was thrown away and the cell was
   * indistinguishable from "no match", while `concat` skipped blanks.
   */
  it("first returns the first row that actually HAS a value", () => {
    expect(run("first")).toBe(10);
    expect(run("first", "区分")).toBe("A");
  });

  /**
   * Regression: `count` counted rows whose value was blank/non-numeric, so a
   * 件数 of 4 sat next to a 合計 of 30 — implying an average of 7.5 while 平均
   * reported 15. 件数 now counts data points, like every other mode.
   */
  it("count counts data points, so 件数 × 平均 = 合計", () => {
    expect(run("count")).toBe(2);
    expect(run("sum")).toBe(30);
    expect(run("avg")).toBe(15);
    expect(Number(run("count")) * Number(run("avg"))).toBe(run("sum"));
  });

  it("min / max / concat see the same set", () => {
    expect(run("min")).toBe(10);
    expect(run("max")).toBe(20);
    expect(run("concat", "区分")).toBe("A、B");
  });

  it("a match whose every value is blank is empty, not zero-ish", () => {
    const allBlank: VlookupRow[] = [
      { data: { 取引先名: "アオイ", 金額: null } },
      { data: { 取引先名: "アオイ", 金額: "" } },
    ];
    for (const a of ["first", "sum", "avg", "min", "max", "concat"] as VlookupAggregate[]) {
      expect(
        resolveVlookupValues(cfg({ targetField: "金額", aggregate: a }), sales("アオイ"), allBlank)[0],
        a,
      ).toBeNull();
    }
    // 件数 is the one mode that answers with a number: zero data points.
    expect(
      resolveVlookupValues(
        cfg({ targetField: "金額", aggregate: "count" }),
        sales("アオイ"),
        allBlank,
      )[0],
    ).toBe(0);
  });

  it("does not mistake 0 or false for a blank", () => {
    const zeros: VlookupRow[] = [
      { data: { 取引先名: "アオイ", 金額: 0 } },
      { data: { 取引先名: "アオイ", 金額: 5 } },
    ];
    const z = (aggregate: VlookupAggregate) =>
      resolveVlookupValues(cfg({ targetField: "金額", aggregate }), sales("アオイ"), zeros)[0];
    expect(z("first")).toBe(0);
    expect(z("count")).toBe(2);
    expect(z("min")).toBe(0);
    expect(z("sum")).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const localFields = [
  { key: "取引先名", name: "取引先名", type: "text" },
  { key: "金額", name: "金額", type: "currency" },
  { key: "粗利", name: "粗利", type: "formula" },
];
const targetCollection = {
  id: "col_customers",
  name: "顧客マスター",
  fields: [
    { key: "取引先名", name: "取引先名", type: "text" },
    { key: "業種", name: "業種", type: "select" },
    { key: "与信額", name: "与信額", type: "currency" },
    { key: "累計売上", name: "累計売上", type: "rollup" },
    { key: "キー計算", name: "キー計算", type: "formula" },
  ],
};
const ctx = (patch: Partial<Parameters<typeof validateVlookupConfig>[1]> = {}) => ({
  selfCollectionId: "col_sales",
  localFields,
  target: targetCollection,
  ...patch,
});

/** Assert an ApiError with a Japanese message mentioning `needle`. */
function expectJapaneseError(fn: () => unknown, needle: string, status = 422) {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ApiError);
  const err = caught as ApiError;
  expect(err.status).toBe(status);
  expect(err.message).toContain(needle);
  // Contains Japanese (kana or kanji), not an English fallback.
  expect(/[ぁ-んァ-ン一-龯]/.test(err.message)).toBe(true);
}

describe("validateVlookupConfig", () => {
  it("normalises a good config and defaults the aggregate to first", () => {
    expect(validateVlookupConfig(baseConfig, ctx())).toEqual({
      targetCollectionId: "col_customers",
      localKey: "取引先名",
      targetKey: "取引先名",
      targetField: "業種",
      aggregate: "first",
    });
    expect(
      validateVlookupConfig(cfg({ targetField: "与信額", aggregate: "sum" }), ctx()),
    ).toMatchObject({ aggregate: "sum", targetField: "与信額" });
  });

  it("rejects a missing target sheet", () => {
    expectJapaneseError(
      () => validateVlookupConfig(cfg({ targetCollectionId: "" }), ctx()),
      "参照するシート",
    );
  });

  it("rejects a target that is missing or in another workspace (404, no leak)", () => {
    expectJapaneseError(
      () => validateVlookupConfig(cfg({ targetCollectionId: "col_other_ws" }), ctx({ target: null })),
      "見つかりません",
      404,
    );
  });

  it("rejects a self-reference (cycle guard)", () => {
    expectJapaneseError(
      () => validateVlookupConfig(cfg({ targetCollectionId: "col_sales" }), ctx()),
      "同じシートを参照することはできません",
    );
  });

  it("rejects unknown keys on either sheet", () => {
    expectJapaneseError(
      () => validateVlookupConfig(cfg({ localKey: "" }), ctx()),
      "このシートのキー項目",
    );
    expectJapaneseError(
      () => validateVlookupConfig(cfg({ localKey: "顧客名" }), ctx()),
      "このシートに「顧客名」という項目がありません",
    );
    expectJapaneseError(
      () => validateVlookupConfig(cfg({ targetKey: "会社名" }), ctx()),
      "参照先シートに「会社名」という項目がありません",
    );
    expectJapaneseError(
      () => validateVlookupConfig(cfg({ targetField: "" }), ctx()),
      "取得する項目",
    );
    expectJapaneseError(
      () => validateVlookupConfig(cfg({ targetField: "住所" }), ctx()),
      "参照先シートに「住所」という項目がありません",
    );
  });

  it("rejects a computed targetField (no chaining onto計算列)", () => {
    expectJapaneseError(
      () => validateVlookupConfig(cfg({ targetField: "累計売上" }), ctx()),
      "計算列を続けて引くことはできません",
    );
  });

  it("rejects computed key columns on either side", () => {
    expectJapaneseError(
      () => validateVlookupConfig(cfg({ localKey: "粗利" }), ctx()),
      "キー項目「粗利」は自動計算の列",
    );
    expectJapaneseError(
      () => validateVlookupConfig(cfg({ targetKey: "キー計算" }), ctx()),
      "参照先のキー項目「キー計算」は自動計算の列",
    );
  });

  it("rejects a non-numeric field with sum / avg / min / max, naming the field", () => {
    for (const aggregate of NUMERIC_VLOOKUP_AGGREGATES) {
      expectJapaneseError(
        () => validateVlookupConfig(cfg({ aggregate }), ctx()),
        `取得する項目「業種」は数値の列ではないため、${VLOOKUP_AGGREGATE_LABELS[aggregate]}では集計できません`,
      );
    }
    // …but first / count / concat are fine on a text column.
    for (const aggregate of ["first", "count", "concat"] as VlookupAggregate[]) {
      expect(validateVlookupConfig(cfg({ aggregate }), ctx())).toMatchObject({ aggregate });
    }
  });

  it("rejects an unknown aggregate", () => {
    expectJapaneseError(
      () => validateVlookupConfig({ ...baseConfig, aggregate: "median" }, ctx()),
      "複数一致したとき",
    );
  });
});

describe("aggregate metadata", () => {
  it("labels every aggregate in Japanese and guards the type", () => {
    for (const a of VLOOKUP_AGGREGATES) {
      expect(VLOOKUP_AGGREGATE_LABELS[a]).toBeTruthy();
      expect(isVlookupAggregate(a)).toBe(true);
    }
    expect(isVlookupAggregate("median")).toBe(false);
    expect(VLOOKUP_AGGREGATES).toEqual([
      "first",
      "sum",
      "avg",
      "count",
      "min",
      "max",
      "concat",
    ]);
  });
});
