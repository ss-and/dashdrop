/**
 * 画面が事実と違うことを言っていないか。
 *
 * このリポジトリには「できないことを約束しない」という方針があり、過去に
 * 一度まとめて直している（0853a0c）。それでも同じ形の間違いが2つ混入した:
 *
 *   1. 設定ガイドが「通知メールの宛先もここで確定します」と書いていた。
 *      この製品にメールで通知する経路は無い（通知は画面の中と Slack だけ）。
 *      確認メール自体は届くので、**それらしく読めてしまう**のが厄介だった。
 *
 *   2. 価格表の「N種類のグラフ」を手で書いていた。ウィジェットを1つ足した
 *      ときに数え直して、かえってずれた（22 → 20、実際は23）。
 *
 * どちらも型では防げず、動かしても壊れない。読んで気づくしかないので、
 * **文言そのものを見張るテスト**にしてある。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PLANS, PLAN_ORDER } from "@/lib/plans";
import { WIDGET_TYPES } from "@/lib/widget-builder";
import { PALETTES } from "@/lib/palette";
import { onboardingSteps } from "@/lib/onboarding";

/* ========================================================================== */
describe("数は実装から数える", () => {
  /**
   * 価格表の文言に、図表の実数がそのまま出ていること。
   *
   * 数字を手で書き直すと必ずずれるので、文言側を実装から組み立てている。
   * ここでは「組み立てた結果が実数と一致する」ことだけを見る。
   */
  it("Free の説明に出る図表の数が、実際に置ける種類の数と一致する", () => {
    const line = PLANS.free.features.find((f) => f.includes("種類の図表"));
    expect(line).toBeDefined();
    expect(line).toContain(`${WIDGET_TYPES.length}種類の図表`);
    expect(line).toContain(`${PALETTES.length}つの配色`);
  });

  /**
   * 【回帰】以前は "22種類のグラフ" のような**文字列リテラル**だった。
   * ウィジェットが増えても文言は動かず、手で直すたびにずれた。
   */
  it("価格表の文言に、数字を直接書いた「N種類」が残っていない", () => {
    const src = readFileSync("src/lib/plans.ts", "utf8");
    // features / planned の中に、数字直書きの「N種類」があってはいけない。
    const hardCoded = src.match(/"[^"]*\d+種類[^"]*"/g);
    expect(hardCoded).toBeNull();
  });

  it("表・ピボット・KPI も置けるので「グラフ」と言い切らない", () => {
    // 表をグラフとは呼べない。「図表」なら表もKPIも含められる。
    for (const id of PLAN_ORDER) {
      for (const f of PLANS[id].features) {
        expect(f).not.toMatch(/\d+種類のグラフ/);
      }
    }
  });
});

/* ========================================================================== */
describe("無い機能を約束しない", () => {
  const ALL_DONE = {
    workbooks: 1,
    dashboards: 1,
    records: 1,
    sharedDashboards: 1,
    emailVerified: true,
  };
  const NOTHING_DONE = {
    workbooks: 0,
    dashboards: 0,
    records: 0,
    sharedDashboards: 0,
    emailVerified: false,
  };

  /**
   * 【回帰】設定ガイドが「通知メールの宛先もここで確定します」と書いていた。
   * 通知の宛先という概念自体が無く、alerts の channel は inapp|slack だけ。
   */
  it("設定ガイドの文言が、メールでの通知に触れていない", () => {
    for (const state of [NOTHING_DONE, ALL_DONE]) {
      for (const step of onboardingSteps(state)) {
        const text = `${step.label} ${step.description}`;
        expect(text).not.toContain("通知メール");
        expect(text).not.toMatch(/メール.*(通知|お知らせ)し/);
      }
    }
  });

  /**
   * 通知の宛先が増えるとしたら、まず alerts の channel に現れる。ここが
   * inapp|slack のままであるうちは、どの画面も「メールで知らせます」と
   * 書いてはいけない。逆にここが増えたときは、このテストが落ちて
   * 「文言も見直す番だ」と気づける。
   */
  it("通知の宛先は、いまも画面の中と Slack だけ", () => {
    // 受け付ける値そのものを見る。コメントには「"email" を足さないこと」と
    // いう**警告**が書いてあるので、素朴に文字列を探すとそれに当たる。
    const src = readFileSync("src/app/api/alerts/route.ts", "utf8");
    expect(src).toContain('z.enum(["inapp", "slack"])');
  });

  /**
   * 定期レポートも同じ。宛先メールを扱う経路が無いので、レポートの画面が
   * 「送ります」と書けるのは Slack と Notion に対してだけ。
   */
  it("定期レポートを実際に送る先に、メールが混ざっていない", () => {
    // 送信の実体（src/lib/alerts.ts の配信）に、メールを送る呼び出しが無いこと。
    // ここに現れた瞬間、レポート画面の「送ります」の意味が変わる。
    const src = readFileSync("src/lib/alerts.ts", "utf8");
    expect(src).not.toMatch(/sendMail|sendWorkspaceEmail|nodemailer/);
  });
});
