import { describe, it, expect } from "vitest";
import {
  coerceValue,
  displayValue,
  inferFieldType,
  isFieldType,
  FIELD_TYPES,
  type SelectOption,
  isComputedField,
  COMPUTED_FIELD_TYPES,
  parseJapaneseNumber,
} from "@/lib/field-types";

describe("coerceValue", () => {
  it("normalises empty / null / undefined to null (ok)", () => {
    for (const raw of [null, undefined, ""]) {
      expect(coerceValue("text", raw)).toEqual({ ok: true, value: null });
      expect(coerceValue("number", raw)).toEqual({ ok: true, value: null });
      expect(coerceValue("checkbox", raw)).toEqual({ ok: true, value: null });
    }
  });

  it("keeps boolean false and number 0 (not treated as empty)", () => {
    expect(coerceValue("checkbox", false)).toEqual({ ok: true, value: false });
    expect(coerceValue("number", 0)).toEqual({ ok: true, value: 0 });
  });

  describe("text / longtext / phone", () => {
    it("trims strings", () => {
      expect(coerceValue("text", "  hi  ")).toEqual({ ok: true, value: "hi" });
      expect(coerceValue("longtext", "  a b ")).toEqual({ ok: true, value: "a b" });
      expect(coerceValue("phone", " 090-1234 ")).toEqual({ ok: true, value: "090-1234" });
    });
  });

  describe("number / currency", () => {
    it("parses plain numbers and numeric strings", () => {
      expect(coerceValue("number", 42)).toEqual({ ok: true, value: 42 });
      expect(coerceValue("number", "42")).toEqual({ ok: true, value: 42 });
      expect(coerceValue("number", "3.14")).toEqual({ ok: true, value: 3.14 });
    });

    it("strips thousands separators", () => {
      expect(coerceValue("number", "1,000")).toEqual({ ok: true, value: 1000 });
    });

    it("strips currency symbols like ¥", () => {
      expect(coerceValue("currency", "¥500")).toEqual({ ok: true, value: 500 });
      expect(coerceValue("currency", "¥1,000")).toEqual({ ok: true, value: 1000 });
      expect(coerceValue("currency", "$2,500")).toEqual({ ok: true, value: 2500 });
    });

    it("rejects non-numbers", () => {
      const r = coerceValue("number", "abc");
      expect(r.ok).toBe(false);
      expect(r.error).toBeDefined();
    });
  });

  describe("email", () => {
    it("accepts valid and trims", () => {
      expect(coerceValue("email", "  a@b.com ")).toEqual({ ok: true, value: "a@b.com" });
    });
    it("rejects invalid", () => {
      expect(coerceValue("email", "not-an-email").ok).toBe(false);
      expect(coerceValue("email", "a@b").ok).toBe(false);
    });
  });

  describe("url", () => {
    it("auto-prefixes https:// and validates", () => {
      expect(coerceValue("url", "example.com")).toEqual({
        ok: true,
        value: "https://example.com",
      });
    });
    it("keeps an existing scheme", () => {
      expect(coerceValue("url", "http://x.io")).toEqual({ ok: true, value: "http://x.io" });
    });
    it("rejects a url containing whitespace", () => {
      expect(coerceValue("url", "has space.com").ok).toBe(false);
    });
  });

  describe("date", () => {
    it("accepts ISO date strings verbatim", () => {
      expect(coerceValue("date", "2024-01-15")).toEqual({ ok: true, value: "2024-01-15" });
    });
    it("accepts Date instances", () => {
      const d = new Date("2024-06-15T00:00:00Z");
      expect(coerceValue("date", d)).toEqual({ ok: true, value: "2024-06-15" });
    });
    it("accepts parseable datetime strings (TZ-safe absolute instant)", () => {
      expect(coerceValue("date", "2024-06-15T12:00:00Z")).toEqual({
        ok: true,
        value: "2024-06-15",
      });
    });
    it("rejects garbage", () => {
      expect(coerceValue("date", "garbage!!!").ok).toBe(false);
    });
  });

  describe("checkbox", () => {
    it("passes through booleans", () => {
      expect(coerceValue("checkbox", true)).toEqual({ ok: true, value: true });
      expect(coerceValue("checkbox", false)).toEqual({ ok: true, value: false });
    });
    it("maps ascii truthy tokens", () => {
      for (const t of ["true", "1", "yes", "y", "✓", "done"]) {
        expect(coerceValue("checkbox", t).value).toBe(true);
      }
    });
    it("maps ascii falsy tokens", () => {
      for (const f of ["false", "0", "no", "n"]) {
        expect(coerceValue("checkbox", f).value).toBe(false);
      }
    });
    it("maps Japanese tokens はい / 済 -> true, 未 / いいえ -> false", () => {
      expect(coerceValue("checkbox", "はい").value).toBe(true);
      expect(coerceValue("checkbox", "済").value).toBe(true);
      expect(coerceValue("checkbox", "未").value).toBe(false);
      expect(coerceValue("checkbox", "いいえ").value).toBe(false);
    });
  });

  describe("select", () => {
    const options: SelectOption[] = [
      { label: "High", value: "h" },
      { label: "Low", value: "l" },
    ];
    it("maps a label to its value (case-insensitive)", () => {
      expect(coerceValue("select", "high", options).value).toBe("h");
      expect(coerceValue("select", "High", options).value).toBe("h");
    });
    it("passes through a matching value", () => {
      expect(coerceValue("select", "l", options).value).toBe("l");
    });
    it("returns the raw string when no option matches", () => {
      expect(coerceValue("select", "Other", options).value).toBe("Other");
    });
    it("returns the trimmed string with no options", () => {
      expect(coerceValue("select", "  x ").value).toBe("x");
    });
  });

  describe("multiselect", () => {
    it("splits on comma, semicolon and Japanese、", () => {
      expect(coerceValue("multiselect", "a, b; c、d").value).toEqual(["a", "b", "c", "d"]);
    });
    it("drops empty fragments", () => {
      expect(coerceValue("multiselect", "a,,b, ").value).toEqual(["a", "b"]);
    });
    it("accepts arrays and trims elements", () => {
      expect(coerceValue("multiselect", [" a ", "b"]).value).toEqual(["a", "b"]);
    });
  });
});

describe("displayValue", () => {
  it("renders empty for null/undefined/empty", () => {
    expect(displayValue("text", null)).toBe("");
    expect(displayValue("number", undefined)).toBe("");
    expect(displayValue("text", "")).toBe("");
  });

  it("formats currency with grouping and yen sign", () => {
    const out = displayValue("currency", 1000);
    expect(out).toContain("1,000");
    expect(out).toContain("¥");
  });

  it("formats numbers with thousands separators", () => {
    expect(displayValue("number", 1234567)).toBe("1,234,567");
  });

  it("renders checkbox as ✓ / empty", () => {
    expect(displayValue("checkbox", true)).toBe("✓");
    expect(displayValue("checkbox", false)).toBe("");
  });

  it("joins multiselect arrays", () => {
    expect(displayValue("multiselect", ["a", "b", "c"])).toBe("a, b, c");
  });

  it("falls back to String for plain text", () => {
    expect(displayValue("text", "hello")).toBe("hello");
  });
});

describe("inferFieldType", () => {
  it("empty column -> text", () => {
    expect(inferFieldType([])).toBe("text");
    expect(inferFieldType([null, "", undefined])).toBe("text");
  });

  it("all numbers -> number", () => {
    expect(inferFieldType([10, 20, 30, 40])).toBe("number");
    expect(inferFieldType(["100", "200", "1,000"])).toBe("number");
  });

  it("booleans -> checkbox", () => {
    expect(inferFieldType([true, false, true])).toBe("checkbox");
  });

  it("yes/no -> checkbox", () => {
    expect(inferFieldType(["yes", "no", "yes", "no"])).toBe("checkbox");
  });

  it("emails -> email", () => {
    expect(inferFieldType(["a@x.com", "b@y.co.jp", "c@z.org"])).toBe("email");
  });

  it("dates -> date", () => {
    expect(inferFieldType(["2024-01-01", "2024-06-15", "2025-12-31"])).toBe("date");
  });

  it("low-cardinality strings -> select", () => {
    expect(
      inferFieldType(["Red", "Blue", "Red", "Blue", "Red", "Blue"]),
    ).toBe("select");
  });

  it("long distinct strings -> longtext", () => {
    const long = (n: number) => `entry-${n}-` + "x".repeat(90);
    expect(inferFieldType([long(1), long(2), long(3)])).toBe("longtext");
  });

  it("short distinct strings -> text", () => {
    expect(inferFieldType(["alpha", "bravo", "charlie", "delta", "echo"])).toBe("text");
  });
});

describe("isFieldType", () => {
  it("accepts every known field type", () => {
    for (const t of FIELD_TYPES) expect(isFieldType(t)).toBe(true);
  });
  it("rejects unknown / non-string values", () => {
    expect(isFieldType("nope")).toBe(false);
    expect(isFieldType(42)).toBe(false);
    expect(isFieldType(null)).toBe(false);
    expect(isFieldType(undefined)).toBe(false);
  });
});

describe("computed field display", () => {
  // Regression: `displayValue` had no case for formula/vlookup, so it fell to
  // the default `String(value)` and printed the literal "null" in cells; and
  // the grid decided read-only-ness with a hardcoded lookup/rollup pair, so the
  // new computed types read from `data` (where they never exist) and rendered
  // blank even though the API returned correct values.
  it("treats all four derived types as computed", () => {
    for (const t of ["lookup", "rollup", "formula", "vlookup"]) {
      expect(isComputedField(t), t).toBe(true);
    }
    for (const t of ["text", "number", "currency", "date", "relation"]) {
      expect(isComputedField(t), t).toBe(false);
    }
    expect([...COMPUTED_FIELD_TYPES].sort()).toEqual(
      ["formula", "lookup", "rollup", "vlookup"].sort(),
    );
  });

  it("renders a null computed value as blank, never the string 'null'", () => {
    for (const t of ["formula", "vlookup"] as const) {
      expect(displayValue(t, null)).toBe("");
      expect(displayValue(t, undefined)).toBe("");
    }
  });

  it("formats computed numbers and keeps zero visible", () => {
    expect(displayValue("formula", 600)).toBe("600");
    expect(displayValue("formula", 1234567)).toBe("1,234,567");
    // 0 is a real answer — it must not be swallowed as "empty".
    expect(displayValue("formula", 0)).toBe("0");
    expect(displayValue("vlookup", 0)).toBe("0");
  });

  it("passes computed text and lists through", () => {
    expect(displayValue("vlookup", "製造")).toBe("製造");
    expect(displayValue("vlookup", ["製造", "卸売"])).toBe("製造, 卸売");
    expect(displayValue("formula", true)).toBe("true");
  });
});

describe("日本のビジネス文書の数の読み方", () => {
  /**
   * 回帰テスト: 取り込んだ列の型を「数値」に直すと、`1,234円` `▲500` `１２３`
   * `￥88,000` がすべて弾かれて空欄になっていた。利用者から見ると
   * 「正しい型を選んだのに中身が消えた」という最悪の挙動で、文字列のまま
   * 諦めるしか無かった。
   */
  it("会計・和文の表記を読む", () => {
    const cases: Array<[string, number | null]> = [
      ["1,234", 1234],
      ["￥1,234", 1234],
      ["¥1,234", 1234],
      ["1,234円", 1234],
      ["▲500", -500],
      ["△500", -500],
      ["(500)", -500],
      ["－500", -500],
      ["１２３", 123],
      ["１，２３４円", 1234],
      ["15%", 0.15],
      ["１５％", 0.15],
      ["1,234万", 12_340_000],
      ["5億", 500_000_000],
      ["-12.5", -12.5],
      ["0", 0],
      ["0.5", 0.5],
      ["abc", null],
      ["", null],
      ["   ", null],
      ["2026/04/01", null],
    ];
    for (const [input, expected] of cases) {
      expect(parseJapaneseNumber(input), input).toBe(expected);
    }
  });

  it("数値型はその読み方で受け入れる", () => {
    expect(coerceValue("currency", "▲500")).toEqual({ ok: true, value: -500 });
    expect(coerceValue("number", "１２３")).toEqual({ ok: true, value: 123 });
    expect(coerceValue("currency", "1,234円")).toEqual({ ok: true, value: 1234 });
    expect(coerceValue("number", "abc").ok).toBe(false);
  });
});

describe("列の型の推定 — 壊してはいけないもの", () => {
  /**
   * 回帰テスト: 郵便番号 0600001、社員番号 0012、商品コード 007 が
   * 数値と判定され、先頭のゼロが落ちて別物になっていた。
   */
  it("先頭ゼロのコードは数値にしない", () => {
    expect(inferFieldType(["0600001", "1500001", "0012345"])).not.toBe("number");
    expect(inferFieldType(["0012", "0013", "0014"])).not.toBe("number");
    expect(inferFieldType(["007", "008"])).not.toBe("number");
    expect(inferFieldType(["0312345678", "0454321000"])).not.toBe("number");
    // 1件でも先頭ゼロがあれば、その列はコードとして扱う。
    expect(inferFieldType(["100", "200", "0300"])).not.toBe("number");
  });

  it("本物の数は数値のまま", () => {
    expect(inferFieldType(["100", "200", "300"])).toBe("number");
    expect(inferFieldType(["0", "5", "10"])).toBe("number");
    expect(inferFieldType(["0.5", "1.5"])).toBe("number");
    expect(inferFieldType(["-3", "0", "3"])).toBe("number");
  });

  /**
   * 回帰テスト: 0/1 を真偽値と見なしていたため、`1,0,1` という数量列が
   * チェックボックスになり true/false として保存されていた。
   */
  it("0/1 の数量列をチェックボックスにしない", () => {
    expect(inferFieldType(["1", "0", "1"])).toBe("number");
    expect(inferFieldType(["1", "1", "1"])).toBe("number");
    expect(inferFieldType([1, 0, 1])).toBe("number");
  });

  it("真偽値と分かる語はチェックボックス", () => {
    expect(inferFieldType(["true", "false"])).toBe("checkbox");
    expect(inferFieldType(["はい", "いいえ"])).toBe("checkbox");
    expect(inferFieldType(["有", "無"])).toBe("checkbox");
    expect(inferFieldType([true, false])).toBe("checkbox");
  });

  it("通貨記号のある列は通貨として扱う", () => {
    expect(inferFieldType(["￥1,000", "￥2,000"])).toBe("currency");
    expect(inferFieldType(["1,000円", "▲500"])).toBe("currency");
    expect(inferFieldType(["1000", "2000"])).toBe("number");
  });

  it("％は推定では数値にしない（0.15 になるのは直感に反するため）", () => {
    expect(inferFieldType(["15%", "20%"])).not.toBe("number");
    // 利用者が明示的に数値型を選んだときだけ換算する。
    expect(coerceValue("number", "15%")).toEqual({ ok: true, value: 0.15 });
  });
});
