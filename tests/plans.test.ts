import { describe, it, expect } from "vitest";
import { getPlan, formatPrice, PLANS, PLAN_ORDER } from "@/lib/plans";

describe("getPlan", () => {
  it("returns the matching plan for known ids", () => {
    expect(getPlan("free").id).toBe("free");
    expect(getPlan("pro").id).toBe("pro");
    expect(getPlan("business").id).toBe("business");
  });

  it("falls back to free for unknown / null / undefined", () => {
    expect(getPlan("enterprise").id).toBe("free");
    expect(getPlan(null).id).toBe("free");
    expect(getPlan(undefined).id).toBe("free");
    expect(getPlan("").id).toBe("free");
  });
});

describe("formatPrice", () => {
  it("renders ¥0 for the free plan", () => {
    expect(formatPrice(PLANS.free)).toBe("¥0");
  });

  it("renders a grouped yen price for pro", () => {
    expect(formatPrice(PLANS.pro)).toBe("¥3,800");
  });

  it("renders お問い合わせ for a null price", () => {
    const custom = { ...PLANS.business, priceMonthly: null };
    expect(formatPrice(custom)).toBe("お問い合わせ");
  });
});

describe("PLAN_ORDER", () => {
  it("has exactly three plans in ascending order", () => {
    expect(PLAN_ORDER).toHaveLength(3);
    expect(PLAN_ORDER).toEqual(["free", "pro", "business"]);
  });
});

describe("plan limits", () => {
  it("pro limits are >= free limits", () => {
    const { free, pro } = PLANS;
    expect(pro.limits.collections).toBeGreaterThanOrEqual(free.limits.collections);
    expect(pro.limits.recordsPerCollection).toBeGreaterThanOrEqual(
      free.limits.recordsPerCollection,
    );
    expect(pro.limits.members).toBeGreaterThanOrEqual(free.limits.members);
    expect(pro.limits.monthlyImports).toBeGreaterThanOrEqual(free.limits.monthlyImports);
  });

  it("free has no API access, pro does", () => {
    expect(PLANS.free.limits.apiAccess).toBe(false);
    expect(PLANS.pro.limits.apiAccess).toBe(true);
  });
});
