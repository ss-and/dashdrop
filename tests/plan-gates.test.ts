/**
 * プランの線引き。
 *
 * ## この機能で守りたいこと
 *
 * 1. **値付けは1か所。** どの機能がどのプランか、を各APIに書き散らすと、
 *    塞いだつもりの入口が1つ残る。塞ぎ忘れた側は誰も報告しない——
 *    気づくのは「なぜか使えている」と言われたときで、そのときには既に
 *    使われている。
 * 2. **買えないプランの後ろに隠さない。** 「Pro が必要です」と出しても
 *    申し込む先が無い今は、利用者にとって単に壊れたのと同じ。だから
 *    線引きは動く状態にしつつ、効かせ始めるのは Pro が買えるようになった
 *    瞬間にする。
 * 3. **上限の数は書き換えない。** 価格表に「1ファイルまで」と書いてある画面が
 *    2つ目を受け入れるようなことが起きないように、`limitOf` は素の値を返す。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PLANS,
  PLAN_ORDER,
  CAPABILITY_LABEL,
  can,
  planIncludes,
  limitOf,
  plansEnforced,
  upgradeMessage,
  getPlan,
  anyPlanPurchasable,
  type Capability,
} from "@/lib/plans";

const ALL: Capability[] = [
  "integrations",
  "computedFields",
  "alerts",
  "reports",
  "databases",
];

describe("値付け", () => {
  it("Free は5つの有料機能をどれも含まない", () => {
    for (const cap of ALL) {
      expect(planIncludes("free", cap), cap).toBe(false);
    }
  });

  it("Pro と Business は5つとも含む", () => {
    for (const plan of ["pro", "business"] as const) {
      for (const cap of ALL) {
        expect(planIncludes(plan, cap), `${plan}/${cap}`).toBe(true);
      }
    }
  });

  it("知らないプラン名は Free として扱う（勝手に開かない）", () => {
    for (const cap of ALL) {
      expect(planIncludes("enterprise-2030", cap), cap).toBe(false);
      expect(planIncludes(null, cap), cap).toBe(false);
      expect(planIncludes(undefined, cap), cap).toBe(false);
    }
  });

  it("Free の上限は、価格表に書いてある約束と一致する", () => {
    /*
     * ここは意図的に数を直接書く。値付けは仕様であって、
     * 実装から引いてくると「変わったことに気づけない」テストになる。
     */
    expect(PLANS.free.limits.workbooks).toBe(1);
    expect(PLANS.free.limits.recordsPerCollection).toBe(500);
    // 1つのファイルに入っているタブが収まる数であること。
    expect(PLANS.free.limits.collections).toBeGreaterThanOrEqual(8);
  });

  it("上限はプランが上がるほど広い", () => {
    const keys = ["workbooks", "collections", "recordsPerCollection"] as const;
    for (const key of keys) {
      const values = PLAN_ORDER.map((id) => PLANS[id].limits[key]);
      for (let i = 1; i < values.length; i++) {
        expect(values[i], `${key} @ ${PLAN_ORDER[i]}`).toBeGreaterThanOrEqual(
          values[i - 1],
        );
      }
    }
  });

  it("すべての機能に日本語の呼び名がある（断り文面に使う）", () => {
    for (const cap of ALL) {
      expect(CAPABILITY_LABEL[cap], cap).toBeTruthy();
    }
  });
});

describe("上限の値", () => {
  it("limitOf は素の値を返す（価格表と食い違わせない）", () => {
    expect(limitOf("free", "workbooks")).toBe(PLANS.free.limits.workbooks);
    expect(limitOf("pro", "collections")).toBe(PLANS.pro.limits.collections);
  });

  it("数値でない上限は 0（apiAccess を数として読ませない）", () => {
    expect(limitOf("free", "apiAccess")).toBe(0);
  });
});

describe("効かせ始めるのは、買えるようになってから", () => {
  it("いまは効かせていない（申し込む先が無いので行き止まりを作らない）", () => {
    expect(anyPlanPurchasable).toBe(false);
    expect(plansEnforced).toBe(false);
  });

  it("効かせていない間は、どのプランでも全部使える", () => {
    for (const cap of ALL) {
      expect(can("free", cap), cap).toBe(true);
    }
  });

  it("それでも値付けの側は Free を閉じたまま（価格表は正しく出る）", () => {
    // can と planIncludes が同じものになっていたら、この2つは両立しない。
    expect(can("free", "alerts")).toBe(true);
    expect(planIncludes("free", "alerts")).toBe(false);
  });
});

describe("断るときの文面", () => {
  it("何ができないかと、いま何ができるかを両方言う", () => {
    const msg = upgradeMessage("alerts");
    expect(msg).toContain("通知ルール");
    expect(msg).toContain("Pro");
    // 「アップグレードしてください」で終わると、申し込めない今は行き止まり。
    expect(msg).toContain("準備中");
    expect(msg).toContain("Free");
  });

  it("すべての機能で文面が組める", () => {
    for (const cap of ALL) {
      expect(upgradeMessage(cap).length, cap).toBeGreaterThan(10);
    }
  });
});

/* ------------------------- 実際に止まるかどうか ------------------------- */

describe("効かせたときに、本当に止まる", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  /** Pro が買えるようになった世界を作って、止める側を確かめる。 */
  async function enforced() {
    vi.doMock("@/lib/plans", async () => {
      const actual = await vi.importActual<typeof import("@/lib/plans")>(
        "@/lib/plans",
      );
      return { ...actual, plansEnforced: true, can: actual.planIncludes };
    });
    vi.doMock("@/lib/db", () => ({
      db: { workbook: { count: vi.fn().mockResolvedValue(1) } },
      toJson: (v: unknown) => v,
    }));
    return import("@/lib/workspace");
  }

  const freeUser = {
    id: "u1",
    email: "a@example.com",
    name: "テスト",
    workspace: { id: "ws1", name: "WS", slug: "ws", plan: "free", role: "owner" },
  } as unknown as Parameters<
    Awaited<ReturnType<typeof enforced>>["assertCapability"]
  >[0];

  const proUser = {
    ...freeUser,
    workspace: { ...freeUser.workspace, plan: "pro" },
  } as typeof freeUser;

  it("Free は5つとも 403 で止まる", async () => {
    const { assertCapability } = await enforced();
    for (const cap of ALL) {
      let thrown: unknown;
      try {
        assertCapability(freeUser, cap);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, cap).toBeDefined();
      expect((thrown as { status?: number }).status, cap).toBe(403);
    }
  });

  it("Pro は止まらない", async () => {
    const { assertCapability } = await enforced();
    for (const cap of ALL) {
      expect(() => assertCapability(proUser, cap), cap).not.toThrow();
    }
  });

  it("Free で2つ目のファイルは止まる（1つ目は通る）", async () => {
    const { assertCanCreateWorkbook } = await enforced();
    // db.workbook.count が 1 を返す＝すでに1つある状態。
    await expect(assertCanCreateWorkbook(freeUser)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("止められたとき、片付ければ進めることを伝える", async () => {
    const { assertCanCreateWorkbook } = await enforced();
    const err = await assertCanCreateWorkbook(freeUser).catch((e) => e);
    // 行き止まりにしない。いまできることを必ず添える。
    expect(String(err.message)).toContain("削除");
  });
});

describe("プランの整合", () => {
  it("買えるプランは Free だけ（決済がまだ無い）", () => {
    for (const id of PLAN_ORDER) {
      const plan = PLANS[id];
      if (plan.available) expect(plan.priceMonthly, id).toBe(0);
    }
  });

  it("準備中のプランは features を空にして planned にだけ書く", () => {
    for (const id of PLAN_ORDER) {
      const plan = PLANS[id];
      if (!plan.available) expect(plan.features, id).toHaveLength(0);
    }
  });

  it("getPlan は常にプランを返す（画面が落ちない）", () => {
    expect(getPlan("free").id).toBe("free");
    expect(getPlan("でたらめ").id).toBe("free");
  });
});
