/**
 * Slack は無料でも使える、という線引きを固定する。
 *
 * 理由は原価ではなく**広がり方**。Slack で起きるのは2つだけで、
 *   1. アラート発火時の自動通知（src/lib/alerts.ts）
 *   2. ダッシュボードを手で Slack に送る
 * 1 は「アラート」の権限で別に閉じているので、Slack を開けても自動通知は
 * 開かない。開くのは 2——チームの目に DashDrop が触れる経路だけ。共有リンクと
 * 同じで、これは製品が広がる仕組みなので閉じると自分の首を絞める。
 *
 * この線引きはコードを読まないと分からず、権限を1行足すだけで静かに戻せて
 * しまう。だからルートのソースそのものを見張る。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CAPABILITY_LABEL, PLANS, planIncludes } from "@/lib/plans";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Slack で動く2つの経路。どちらも有料の門を通してはいけない。 */
const SLACK_ROUTES = [
  "src/app/api/integrations/slack/route.ts",
  "src/app/api/integrations/slack/test/route.ts",
  "src/app/api/dashboards/[id]/share/slack/route.ts",
];

describe("Slack は無料で使える", () => {
  it("Slack のルートは有料の権限を要求しない", () => {
    for (const path of SLACK_ROUTES) {
      const src = read(path);
      expect(
        src.includes("assertCapability"),
        `${path} が assertCapability を呼んでいる。Slack を有料に戻すなら、` +
          `このテストと plans.ts のコメントも一緒に直すこと。`,
      ).toBe(false);
    }
  });

  /**
   * 権限そのものは残っている（Notion と Google スプレッドシート用）。
   * 巻き添えで消していないことを確かめる。
   */
  it("integrations の権限は残っていて、有料のまま", () => {
    expect(planIncludes("free", "integrations")).toBe(false);
    expect(planIncludes("pro", "integrations")).toBe(true);
  });

  /**
   * 画面に「連携（Slack・…）は有料」と出したまま Slack を無料にすると、
   * 使えるのに使えないと書いてあることになる。
   */
  it("有料機能のラベルに Slack を含めない", () => {
    expect(CAPABILITY_LABEL.integrations).not.toContain("Slack");
    for (const plan of Object.values(PLANS)) {
      for (const line of [...plan.features, ...plan.planned]) {
        if (line.includes("連携")) {
          expect(line, `「${line}」に Slack が残っている`).not.toContain("Slack");
        }
      }
    }
  });

  /**
   * アラートの自動通知まで開いてしまうと、15分ごとに回る処理が無料で走る。
   * そこは原価がかかるので閉じたままでなければならない。
   */
  it("アラートは有料のまま（自動通知は開かない）", () => {
    expect(planIncludes("free", "alerts")).toBe(false);
    const alerts = read("src/app/api/alerts/route.ts");
    expect(alerts).toContain('assertCapability(user, "alerts")');
  });
});
