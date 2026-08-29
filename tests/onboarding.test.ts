import { describe, it, expect } from "vitest";
import {
  onboardingSteps,
  onboardingProgress,
  nextStep,
  type OnboardingState,
  type OnboardingStepId,
} from "@/lib/onboarding";

/**
 * 設定ガイドの判定。
 *
 * ここが間違うと出る症状は地味で、しかも初日の利用者にしか見えない——
 * 済んだ課題が残り続ける、押した先で行き止まりに当たる、全部終わったのに
 * パネルが消えない。どれも本人は報告してくれず、ただ離脱する。
 */

/** 何も無い状態。各テストはここから必要な1つだけを立てる。 */
const EMPTY: OnboardingState = {
  workbooks: 0,
  dashboards: 0,
  records: 0,
  sharedDashboards: 0,
  emailVerified: false,
};

/** 全部済んだ状態。 */
const FULL: OnboardingState = {
  workbooks: 2,
  dashboards: 1,
  records: 128,
  sharedDashboards: 1,
  emailVerified: true,
};

function doneIds(state: OnboardingState): OnboardingStepId[] {
  return onboardingSteps(state)
    .filter((s) => s.done)
    .map((s) => s.id);
}

describe("onboardingSteps — done の判定", () => {
  it("何も無いワークスペースでは1つも done にならない", () => {
    expect(doneIds(EMPTY)).toEqual([]);
  });

  it("すべて揃っていれば全部 done", () => {
    const steps = onboardingSteps(FULL);
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it("件数は 0 と 1以上 の境目だけを見る", () => {
    expect(doneIds({ ...EMPTY, workbooks: 1 })).toEqual(["import"]);
    expect(doneIds({ ...EMPTY, records: 1 })).toEqual(["records"]);
    expect(doneIds({ ...EMPTY, dashboards: 1 })).toEqual(["dashboard"]);
    expect(doneIds({ ...EMPTY, sharedDashboards: 1 })).toEqual(["share"]);
    expect(doneIds({ ...EMPTY, emailVerified: true })).toEqual(["verifyEmail"]);
  });

  it("1件でも100件でも判定は変わらない（多いほど偉いガイドではない）", () => {
    expect(doneIds({ ...EMPTY, workbooks: 1 })).toEqual(
      doneIds({ ...EMPTY, workbooks: 100 }),
    );
  });

  it("項目ごとに独立している——取り込んでもダッシュボードは done にならない", () => {
    const steps = onboardingSteps({ ...EMPTY, workbooks: 3, records: 40 });
    const byId = new Map(steps.map((s) => [s.id, s.done]));
    expect(byId.get("import")).toBe(true);
    expect(byId.get("records")).toBe(true);
    expect(byId.get("dashboard")).toBe(false);
    expect(byId.get("share")).toBe(false);
    expect(byId.get("verifyEmail")).toBe(false);
  });
});

describe("onboardingSteps — 中身の約束", () => {
  it("どのステップにも「なぜやるのか」が1行付いている", () => {
    for (const step of onboardingSteps(EMPTY)) {
      expect(step.description.length).toBeGreaterThan(10);
      expect(step.label.length).toBeGreaterThan(0);
    }
  });

  it("行き先は今あるアプリ内のページだけ（行き止まりを勧めない）", () => {
    const live = new Set(["/import", "/home", "/dashboards", "/settings"]);
    for (const step of onboardingSteps(EMPTY)) {
      expect(live.has(step.href)).toBe(true);
    }
  });

  it("メール確認は共有リンクより前に並ぶ（未確認では公開リンクを作れないため）", () => {
    const ids = onboardingSteps(EMPTY).map((s) => s.id);
    expect(ids.indexOf("verifyEmail")).toBeLessThan(ids.indexOf("share"));
    expect(ids.indexOf("import")).toBeLessThan(ids.indexOf("dashboard"));
  });

  it("id は重複しない", () => {
    const ids = onboardingSteps(EMPTY).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("onboardingProgress", () => {
  it("何も無いときは 0/5・未完了", () => {
    const p = onboardingProgress(onboardingSteps(EMPTY));
    expect(p.done).toBe(0);
    expect(p.total).toBe(5);
    expect(p.complete).toBe(false);
  });

  it("済んだ数だけ数える", () => {
    const p = onboardingProgress(
      onboardingSteps({ ...EMPTY, workbooks: 1, records: 5 }),
    );
    expect(p.done).toBe(2);
    expect(p.total).toBe(5);
    expect(p.complete).toBe(false);
  });

  it("残り1つでは complete にならない", () => {
    const p = onboardingProgress(
      onboardingSteps({ ...FULL, sharedDashboards: 0 }),
    );
    expect(p.done).toBe(4);
    expect(p.complete).toBe(false);
  });

  it("全部済んだら complete（画面はここでパネルを出さなくなる）", () => {
    const p = onboardingProgress(onboardingSteps(FULL));
    expect(p.done).toBe(p.total);
    expect(p.complete).toBe(true);
  });

  it("課題が0件なら complete——出すものが無いなら出さない", () => {
    expect(onboardingProgress([])).toEqual({ done: 0, total: 0, complete: true });
  });
});

describe("nextStep", () => {
  it("何も無いときは先頭＝Excelの取り込み", () => {
    expect(nextStep(onboardingSteps(EMPTY))?.id).toBe("import");
  });

  it("**最初の**未完了を返す（後ろが済んでいても飛ばさない）", () => {
    // 取り込みだけ残っていて、その先はなぜか済んでいる状態。
    const steps = onboardingSteps({ ...FULL, workbooks: 0 });
    expect(nextStep(steps)?.id).toBe("import");
  });

  it("先頭が済めば次へ進む", () => {
    expect(nextStep(onboardingSteps({ ...EMPTY, workbooks: 1 }))?.id).toBe(
      "records",
    );
    expect(
      nextStep(onboardingSteps({ ...EMPTY, workbooks: 1, records: 9 }))?.id,
    ).toBe("dashboard");
  });

  it("残り1つならそれを返す", () => {
    const steps = onboardingSteps({ ...FULL, sharedDashboards: 0 });
    expect(nextStep(steps)?.id).toBe("share");
  });

  it("全部済んだら null（勧めるものが無い）", () => {
    expect(nextStep(onboardingSteps(FULL))).toBeNull();
    expect(nextStep([])).toBeNull();
  });
});
