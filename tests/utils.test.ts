import { describe, it, expect } from "vitest";
import {
  slugify,
  toFieldKey,
  uniqueName,
  formatNumber,
  percent,
} from "@/lib/utils";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("collapses symbols into single hyphens and trims them", () => {
    expect(slugify("  Foo!!! & Bar??  ")).toBe("foo-bar");
  });

  it("keeps Japanese letters", () => {
    expect(slugify("売上 一覧")).toBe("売上-一覧");
  });

  it("falls back to 'item' for empty / symbol-only input", () => {
    expect(slugify("")).toBe("item");
    expect(slugify("!!!")).toBe("item");
  });

  it("caps length at 60 chars", () => {
    expect(slugify("a".repeat(100)).length).toBe(60);
  });
});

describe("toFieldKey", () => {
  it("produces a snake_case-ish key", () => {
    expect(toFieldKey("Full Name")).toBe("full_name");
    expect(toFieldKey("  Order #  ")).toBe("order");
  });

  it("falls back to 'field' for empty input", () => {
    expect(toFieldKey("")).toBe("field");
    expect(toFieldKey("###")).toBe("field");
  });

  it("caps length at 48 chars", () => {
    expect(toFieldKey("x".repeat(80)).length).toBe(48);
  });
});

describe("uniqueName", () => {
  it("returns the candidate when unused", () => {
    expect(uniqueName("name", new Set())).toBe("name");
  });

  it("suffixes -2, -3 for collisions", () => {
    const taken = new Set<string>(["name"]);
    expect(uniqueName("name", taken)).toBe("name-2");
    taken.add("name-2");
    expect(uniqueName("name", taken)).toBe("name-3");
  });
});

describe("formatNumber", () => {
  it("adds thousands separators, no decimals by default", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("respects a fraction-digit count", () => {
    expect(formatNumber(3.14159, 2)).toBe("3.14");
  });
});

describe("percent", () => {
  it("computes a rounded integer percentage", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(50, 200)).toBe(25);
  });

  it("guards divide-by-zero -> 0", () => {
    expect(percent(5, 0)).toBe(0);
    expect(percent(5, -1)).toBe(0);
  });
});
