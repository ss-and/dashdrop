/**
 * アラート評価の耐障害性（F3）と、SLACK_WEBHOOK_URL フォールバックの
 * テナント分離（F8）の回帰テスト。
 *
 * 実際にあった不具合:
 *  - F3: ルールのループに try/catch がなく、1件でも例外が出ると（コレクション
 *    削除、ウィジェット設定の不正、評価中に行が消えたときの Prisma P2025 など）
 *    以降のルールが丸ごと評価されないまま 500 が返っていた。
 *  - F8: SLACK_WEBHOOK_URL が設定されているだけで、Slack未接続の全ワークスペースの
 *    通知が運営のチャンネルへ送られていた（テナント間の情報漏えい）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock の factory から参照するため、巻き上げに合わせて hoisted で用意する。
const state = vi.hoisted(() => ({
  workspaces: [{ id: "ws_1" }] as { id: string }[],
}));

// relations.ts は `server-only` を import しており vitest では解決できない。
// factory 付きの vi.mock は元モジュールを読み込まないので、これで alerts.ts の
// 純粋なロジックだけを DB なしで検証できる。
vi.mock("@/lib/relations", () => ({
  resolveCollectionRecords: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findMany: vi.fn(async () => state.workspaces) },
  },
  toJson: (value: unknown) => value,
}));

// 実際に Slack へ POST しない。宛先だけを記録する。
const postToSlack = vi.hoisted(() =>
  vi.fn(async (_url: string, _msg: unknown) => ({ ok: true }) as { ok: true }),
);
vi.mock("@/lib/slack", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/slack")>();
  return { ...actual, postToSlack };
});

// このワークスペースは自分の Slack を接続していない、という状況を作る。
vi.mock("@/lib/integrations", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/integrations")>();
  return { ...actual, getSecret: vi.fn(async () => null) };
});

const FALLBACK = "https://hooks.slack.com/services/T000/B000/abcdefg";
process.env.SLACK_WEBHOOK_URL = FALLBACK;

const { runEachIsolated, describeRuleError } = await import("@/lib/alerts");
const { resolveFallbackWebhook, sendWorkspaceSlack } = await import(
  "@/lib/notify"
);

type Rule = { id: string; name: string };

const rules: Rule[] = [
  { id: "r1", name: "売上ダウン" },
  { id: "r2", name: "壊れたルール" },
  { id: "r3", name: "在庫不足" },
];

beforeEach(() => {
  state.workspaces = [{ id: "ws_1" }];
  postToSlack.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("runEachIsolated（F3: ルール単位のエラー隔離）", () => {
  it("1件が失敗しても残りのルールを評価し続ける", async () => {
    const seen: string[] = [];
    const result = await runEachIsolated(rules, async (rule) => {
      seen.push(rule.id);
      if (rule.id === "r2") throw new Error("collection missing");
      return true;
    });

    // 失敗したルールの「後ろ」が飛ばされないことが本質。
    expect(seen).toEqual(["r1", "r2", "r3"]);
    expect(result.triggered).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].ruleId).toBe("r2");
    expect(result.failures[0].ruleName).toBe("壊れたルール");
  });

  it("失敗を握りつぶさず、日本語の理由を添えて返す", async () => {
    const result = await runEachIsolated(rules, async (rule) => {
      if (rule.id === "r2") throw new Error("Invalid widget config");
      return false;
    });

    expect(result.failures[0].message).toContain("評価に失敗しました");
    expect(result.failures[0].message).toContain("Invalid widget config");
  });

  it("Prisma P2025（評価中にルール行が消えた）も1件の失敗として隔離する", async () => {
    const deleted = Object.assign(new Error("Record to update not found."), {
      code: "P2025",
    });
    const result = await runEachIsolated(rules, async (rule) => {
      if (rule.id === "r1") throw deleted;
      return true;
    });

    expect(result.triggered).toBe(2);
    expect(result.failures.map((f) => f.ruleId)).toEqual(["r1"]);
    expect(result.failures[0].message).toContain("削除された可能性");
  });

  it("同期的に投げられた例外も隔離する", async () => {
    const result = await runEachIsolated(rules, (rule) => {
      if (rule.id === "r1") throw new TypeError("bad metric");
      return true;
    });

    expect(result.triggered).toBe(2);
    expect(result.failures).toHaveLength(1);
  });

  it("全件成功なら failures は空", async () => {
    const result = await runEachIsolated(rules, async () => true);
    expect(result.failures).toEqual([]);
    expect(result.triggered).toBe(3);
  });

  it("直列に評価する（Slackのレート制限とDB負荷を避けるため）", async () => {
    let running = 0;
    let maxConcurrent = 0;
    await runEachIsolated(rules, async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await Promise.resolve();
      running--;
      return false;
    });

    expect(maxConcurrent).toBe(1);
  });
});

describe("describeRuleError（失敗理由の日本語化）", () => {
  it("P2025 は削除・競合として説明する", () => {
    const msg = describeRuleError({ code: "P2025", message: "not found" });
    expect(msg).toContain("ルールが見つかりませんでした");
  });

  it("Error のメッセージを引き継ぐ", () => {
    expect(describeRuleError(new Error("boom"))).toContain("boom");
  });

  it("文字列や不明な値でも日本語の理由になる", () => {
    expect(describeRuleError("壊れています")).toContain("壊れています");
    expect(describeRuleError(undefined)).toContain("原因不明");
    expect(describeRuleError(new Error("   "))).toContain("原因不明");
  });

  it("長すぎる理由は切り詰める", () => {
    const msg = describeRuleError(new Error("x".repeat(5000)));
    expect(msg.length).toBeLessThan(300);
    expect(msg.endsWith("…")).toBe(true);
  });
});

describe("resolveFallbackWebhook（F8: env フォールバックの限定）", () => {
  it("未設定なら使わない", () => {
    expect(resolveFallbackWebhook(undefined, 1)).toEqual({
      use: false,
      reason: "unset",
    });
    expect(resolveFallbackWebhook("   ", 1)).toEqual({
      use: false,
      reason: "unset",
    });
  });

  it("ワークスペースが複数あるデプロイでは、正しいURLでも使わない", () => {
    expect(resolveFallbackWebhook(FALLBACK, 2)).toEqual({
      use: false,
      reason: "multi-tenant",
    });
  });

  it("hooks.slack.com 以外・非HTTPSは弾く（ユーザー入力のWebhookと同じピン留め）", () => {
    for (const bad of [
      "https://evil.example.com/hook",
      "http://hooks.slack.com/services/T000/B000/abc",
      "https://hooks.slack.com.evil.example.com/x",
      "http://127.0.0.1:8080/internal",
      "not a url",
    ]) {
      expect(resolveFallbackWebhook(bad, 1)).toEqual({
        use: false,
        reason: "invalid",
      });
    }
  });

  it("単一ワークスペース＋正しいURLのときだけ使う", () => {
    expect(resolveFallbackWebhook(`  ${FALLBACK}  `, 1)).toEqual({
      use: true,
      url: FALLBACK,
    });
    expect(resolveFallbackWebhook(FALLBACK, 0)).toEqual({
      use: true,
      url: FALLBACK,
    });
  });
});

describe("sendWorkspaceSlack（F8: 実際の配信経路）", () => {
  it("ワークスペースが複数あるデプロイでは、未接続テナントの通知を送らない", async () => {
    state.workspaces = [{ id: "ws_1" }, { id: "ws_2" }];

    const sent = await sendWorkspaceSlack("ws_1", { title: "アラート" });

    expect(sent).toBe(false);
    expect(postToSlack).not.toHaveBeenCalled();
  });

  it("単一ワークスペースのデプロイでは従来どおりフォールバックへ送る", async () => {
    const sent = await sendWorkspaceSlack("ws_1", { title: "アラート" });

    expect(sent).toBe(true);
    expect(postToSlack).toHaveBeenCalledTimes(1);
    expect(postToSlack.mock.calls[0][0]).toBe(FALLBACK);
  });
});
