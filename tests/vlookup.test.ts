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
  resolveVlookupValues,
  toVlookupNumber,
  validateVlookupConfig,
  type VlookupAggregate,
  type VlookupConfig,
  type VlookupRow,
} from "@/lib/vlookup";
import { ApiError } from "@/lib/errors";

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
  it("trims, case-folds and NFKC-normalises", () => {
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
    expect(run("count")).toBe(4); // count counts ROWS, not parseable numbers
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
