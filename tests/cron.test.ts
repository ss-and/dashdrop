/**
 * 定期実行（cron）の回帰テスト。
 *
 * 直そうとしている不具合:
 *  - スケジューラが存在せず、`evaluateWorkspaceAlerts` を呼ぶのは画面の
 *    「今すぐ評価する」だけだった。Slackを接続してルールを書いても、誰かが
 *    /alerts を開いてボタンを押さない限り通知は一度も飛ばなかった。
 *  - 追加したエンドポイントは外部から叩けるので、認証が緩ければ（未設定なら
 *    素通し、`===` での比較）誰でも全テナントの評価を起動できてしまう。
 *  - 直列評価＋Slackの8秒タイムアウトのため、先頭の1社が1回分の時間を
 *    使い切ると、後ろのワークスペースが黙って評価されないまま成功が返る。
 *  - notify.ts: `getSecret` は復号に失敗しても null を返すので、「自分の
 *    Slackを接続しているのに読めない」ワークスペースが、デプロイ共通の
 *    Webhook（別テナントのチャンネル）へ落ちていた。
 *
 * `runAlertSweep` は依存を全て引数で受け取るので、DBもネットワークも無しで
 * 認証・隔離・時間予算・順序を確かめられる。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  authorizeCron,
  runAlertSweep,
  CRON_SECRET_MISSING,
  type SweepDeps,
  type SweepWorkspace,
} from "@/lib/cron";
import type { EvaluateResult } from "@/lib/alerts";

const SECRET = "cron-secret-0123456789abcdef0123456789abcdef";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

// ───────────────────────── 認証 ─────────────────────────

describe("authorizeCron（共有シークレットの検証）", () => {
  it("シークレットが未設定なら、正しそうなヘッダでも必ず拒否する", () => {
    for (const unset of [undefined, "", "   "]) {
      const res = authorizeCron(`Bearer ${SECRET}`, unset);
      expect(res.ok, String(unset)).toBe(false);
      if (res.ok) return;
      // 無認証で走らせるくらいなら走らせない。503 は「今は使えない」の意。
      expect(res.status).toBe(503);
      expect(res.message).toBe(CRON_SECRET_MISSING);
    }
  });

  it("ヘッダが無ければ401", () => {
    for (const header of [null, undefined, "", "   "]) {
      const res = authorizeCron(header, SECRET);
      expect(res.ok, String(header)).toBe(false);
      if (!res.ok) expect(res.status).toBe(401);
    }
  });

  it("シークレットが違えば401", () => {
    for (const wrong of [
      `Bearer ${SECRET}x`, // 長い
      `Bearer ${SECRET.slice(0, -1)}`, // 短い
      `Bearer ${SECRET.slice(0, -1)}X`, // 同じ長さで末尾だけ違う
      "Bearer ", // 空トークン
    ]) {
      const res = authorizeCron(wrong, SECRET);
      expect(res.ok, wrong).toBe(false);
      if (!res.ok) expect(res.status).toBe(401);
    }
  });

  it("Bearer 以外のスキームやトークンだけの指定は受け付けない", () => {
    for (const bad of [SECRET, `Basic ${SECRET}`, `Token ${SECRET}`]) {
      expect(authorizeCron(bad, SECRET).ok, bad).toBe(false);
    }
  });

  it("正しいシークレットなら通す（スキーム名の大小と前後の空白は許容）", () => {
    expect(authorizeCron(`Bearer ${SECRET}`, SECRET)).toEqual({ ok: true });
    expect(authorizeCron(`bearer ${SECRET}`, SECRET)).toEqual({ ok: true });
    expect(authorizeCron(`  Bearer   ${SECRET}  `, SECRET)).toEqual({ ok: true });
    // 環境変数側に紛れ込んだ空白で締め出されないこと。
    expect(authorizeCron(`Bearer ${SECRET}`, ` ${SECRET}\n`)).toEqual({ ok: true });
  });
});

// ───────────────────── 一巡（sweep）のための道具 ─────────────────────

function result(over: Partial<EvaluateResult> = {}): EvaluateResult {
  return { evaluated: 1, triggered: 0, failed: 0, errors: [], ...over };
}

/**
 * 仮想時計つきのフェイク。`evaluate` は「何ミリ秒かかったことにするか」を
 * 時計に足すだけなので、実時間を待たずに時間予算を検証できる。
 */
function fakeDeps(
  workspaces: SweepWorkspace[],
  behaviour: (id: string) => { costMs?: number; result?: EvaluateResult; throws?: unknown },
) {
  const calls: string[] = [];
  const claims: string[] = [];
  let clock = 1_000;

  const deps: SweepDeps = {
    listWorkspaces: async (limit) => workspaces.slice(0, limit),
    claim: async (id) => {
      claims.push(id);
    },
    evaluate: async (id) => {
      calls.push(id);
      const b = behaviour(id);
      clock += b.costMs ?? 0;
      if (b.throws) throw b.throws;
      return b.result ?? result();
    },
    now: () => clock,
  };

  return { deps, calls, claims };
}

const ws = (id: string, lastAttemptedAt: Date | null = null): SweepWorkspace => ({
  id,
  lastAttemptedAt,
});

// ─────────────────── ワークスペース単位の隔離 ───────────────────

describe("runAlertSweep（ワークスペース単位のエラー隔離）", () => {
  it("1社の評価が失敗しても、残りの評価を続ける", async () => {
    const { deps, calls } = fakeDeps(
      [ws("ws_1"), ws("ws_2"), ws("ws_3")],
      (id) =>
        id === "ws_2"
          ? { throws: new Error("collection missing") }
          : { result: result({ evaluated: 2, triggered: 1 }) },
    );

    const res = await runAlertSweep(deps);

    // 失敗した社の「後ろ」が飛ばされないことが本質。
    expect(calls).toEqual(["ws_1", "ws_2", "ws_3"]);
    expect(res.processed).toBe(3);
    expect(res.failedWorkspaces).toBe(1);
    expect(res.triggered).toBe(2);
    expect(res.outcomes.find((o) => o.workspaceId === "ws_2")?.status).toBe("failed");
  });

  it("失敗理由は日本語で返し、例外の本文は載せない", async () => {
    const { deps } = fakeDeps([ws("ws_1")], () => ({
      throws: new Error(
        "Invalid `prisma.alertRule.update()` invocation in /home/user/dashdrop/src/lib/alerts.ts:245:26",
      ),
    }));

    const res = await runAlertSweep(deps);
    const message = res.outcomes[0].message ?? "";

    expect(message).toContain("評価に失敗しました");
    expect(message).not.toContain("/home/user");
    expect(message).not.toContain("prisma");
  });

  it("ルール単位の失敗数（EvaluateResult.failed）はそのまま集計する", async () => {
    const { deps } = fakeDeps([ws("ws_1"), ws("ws_2")], () => ({
      result: result({ evaluated: 3, triggered: 1, failed: 2 }),
    }));

    const res = await runAlertSweep(deps);

    expect(res.evaluated).toBe(6);
    expect(res.triggered).toBe(2);
    expect(res.failedRules).toBe(4);
    expect(res.failedWorkspaces).toBe(0);
  });

  it("直列に評価する（Slackのレート制限とDB負荷を避けるため）", async () => {
    let running = 0;
    let maxConcurrent = 0;
    const deps: SweepDeps = {
      listWorkspaces: async () => [ws("a"), ws("b"), ws("c")],
      claim: async () => {},
      evaluate: async () => {
        running++;
        maxConcurrent = Math.max(maxConcurrent, running);
        await Promise.resolve();
        running--;
        return result();
      },
      now: () => Date.now(),
    };

    await runAlertSweep(deps);
    expect(maxConcurrent).toBe(1);
  });

  it("対象が無ければ何もせず、その旨を返す", async () => {
    const { deps } = fakeDeps([], () => ({}));
    const res = await runAlertSweep(deps);

    expect(res.queued).toBe(0);
    expect(res.processed).toBe(0);
    expect(res.message).toContain("評価対象のアラートルールがありません");
  });
});

// ───────────────────────── 時間予算 ─────────────────────────

describe("runAlertSweep（実行時間の上限と、取りこぼしの報告）", () => {
  it("予算を使い切ったら止まり、未着手のワークスペースを名指しで報告する", async () => {
    // 1社あたり20秒・着手には20秒の残りが必要 × 予算50秒
    // → 2社で打ち切り、残り3社は次回へ。
    const { deps, calls } = fakeDeps(
      [ws("ws_1"), ws("ws_2"), ws("ws_3"), ws("ws_4"), ws("ws_5")],
      () => ({ costMs: 20_000 }),
    );

    const res = await runAlertSweep(deps, {
      budgetMs: 50_000,
      minStartMs: 20_000,
    });

    expect(calls).toEqual(["ws_1", "ws_2"]);
    expect(res.processed).toBe(2);
    expect(res.budgetExhausted).toBe(true);
    // 「半分だけ処理して成功」と黙って返すのがいちばん危ない。
    expect(res.skipped).toBe(3);
    expect(res.skippedWorkspaceIds).toEqual(["ws_3", "ws_4", "ws_5"]);
    expect(res.message).toContain("未着手");
  });

  it("予算に収まるなら全件を処理し、取りこぼしは報告しない", async () => {
    const { deps } = fakeDeps([ws("ws_1"), ws("ws_2")], () => ({ costMs: 1_000 }));

    const res = await runAlertSweep(deps, { budgetMs: 50_000 });

    expect(res.processed).toBe(2);
    expect(res.skipped).toBe(0);
    expect(res.skippedWorkspaceIds).toEqual([]);
    expect(res.budgetExhausted).toBe(false);
  });

  it("1社が上限時間を超えたら待つのをやめ、次の社へ進む", async () => {
    // 死んだWebhookに対する評価は、Slackの8秒タイムアウト×ルール数だけ
    // 粘りうる。ここでは実時間で、上限を超えた1社を打ち切れることを見る。
    const slow = new Promise<EvaluateResult>((resolve) => {
      setTimeout(() => resolve(result()), 300);
    });
    const calls: string[] = [];
    const deps: SweepDeps = {
      listWorkspaces: async () => [ws("slow"), ws("fast")],
      claim: async () => {},
      evaluate: async (id) => {
        calls.push(id);
        return id === "slow" ? slow : result({ triggered: 1 });
      },
      now: () => Date.now(),
    };

    const res = await runAlertSweep(deps, {
      budgetMs: 5_000,
      perWorkspaceMs: 20,
    });

    expect(calls).toEqual(["slow", "fast"]);
    expect(res.timedOut).toBe(1);
    expect(res.outcomes[0].status).toBe("timeout");
    expect(res.outcomes[0].message).toContain("中断");
    // 後続はちゃんと評価されている。
    expect(res.outcomes[1].status).toBe("ok");
    expect(res.triggered).toBe(1);
    expect(res.message).toContain("中断");
  });

  it("残り時間がわずかなら、中途半端に着手しない", async () => {
    const { deps, calls } = fakeDeps([ws("ws_1"), ws("ws_2")], () => ({
      costMs: 9_500,
    }));

    const res = await runAlertSweep(deps, {
      budgetMs: 10_000,
      minStartMs: 2_000,
    });

    expect(calls).toEqual(["ws_1"]);
    expect(res.skippedWorkspaceIds).toEqual(["ws_2"]);
  });

  it("取り出す件数にも上限がある（応答とDB負荷の歯止め）", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ws(`ws_${i}`));
    const { deps } = fakeDeps(many, () => ({}));

    const res = await runAlertSweep(deps, { maxWorkspaces: 3 });

    expect(res.queued).toBe(3);
    expect(res.processed).toBe(3);
  });
});

// ─────────────── 実行をまたいだ前進（順序） ───────────────

/**
 * 「最後に着手した時刻が古い順」に並べ、着手時にその時刻を進める、という
 * dbSweepDeps と同じ規則をメモリ上で再現する。これで、1回に収まらない件数でも
 * 連続する実行が同じ先頭N件を舐め続けないことを確かめる。
 */
function rotatingDeps(ids: string[], costMs: number) {
  const lastAttempt = new Map<string, number>(ids.map((id) => [id, 0]));
  let clock = 1_000;

  const deps: SweepDeps = {
    listWorkspaces: async (limit) =>
      ids
        .map((id) => ({ id, lastAttemptedAt: new Date(lastAttempt.get(id) ?? 0) }))
        .sort((a, b) => a.lastAttemptedAt.getTime() - b.lastAttemptedAt.getTime())
        .slice(0, limit),
    claim: async (id) => {
      lastAttempt.set(id, clock);
    },
    evaluate: async () => {
      clock += costMs;
      return result();
    },
    now: () => clock,
  };

  return { deps, reset: () => (clock += 60_000) };
}

describe("runAlertSweep（実行をまたいで全ワークスペースに行き渡ること）", () => {
  it("連続する実行が同じ先頭N件を繰り返さず、末尾まで一巡する", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    const { deps, reset } = rotatingDeps(ids, 20_000); // 1回で2社ずつ

    const seen: string[][] = [];
    for (let run = 0; run < 3; run++) {
      const res = await runAlertSweep(deps, {
        budgetMs: 45_000,
        minStartMs: 20_000,
      });
      seen.push(res.outcomes.map((o) => o.workspaceId));
      reset();
    }

    expect(seen[0]).toEqual(["a", "b"]);
    expect(seen[1]).toEqual(["c", "d"]);
    expect(seen[2]).toEqual(["e", "a"]);
    // 3回で全社が少なくとも1度は評価されている（末尾が飢えない）。
    expect(new Set(seen.flat())).toEqual(new Set(ids));
  });

  it("評価に失敗し続けるワークスペースがあっても、順番は回り続ける", async () => {
    // 着手の記録を評価の *後* に行うと、失敗し続ける1社が毎回先頭に居座って
    // 後続が永久に評価されない。claim は評価の前に呼ばれること。
    const ids = ["broken", "b", "c"];
    const lastAttempt = new Map<string, number>(ids.map((id) => [id, 0]));
    let clock = 1_000;
    const deps: SweepDeps = {
      listWorkspaces: async () =>
        ids
          .map((id) => ({ id, lastAttemptedAt: new Date(lastAttempt.get(id) ?? 0) }))
          .sort((a, b) => a.lastAttemptedAt.getTime() - b.lastAttemptedAt.getTime()),
      claim: async (id) => {
        lastAttempt.set(id, clock);
      },
      evaluate: async (id) => {
        clock += 30_000;
        if (id === "broken") throw new Error("boom");
        return result();
      },
      now: () => clock,
    };

    const budget = { budgetMs: 35_000, minStartMs: 30_000 };
    const first = await runAlertSweep(deps, budget);
    clock += 60_000;
    const second = await runAlertSweep(deps, budget);

    expect(first.outcomes.map((o) => o.workspaceId)).toEqual(["broken"]);
    expect(first.failedWorkspaces).toBe(1);
    // 2回目は壊れた社ではなく次の社へ進む。
    expect(second.outcomes.map((o) => o.workspaceId)).toEqual(["b"]);
  });

  it("着手の記録に失敗しても評価は行う", async () => {
    const calls: string[] = [];
    const deps: SweepDeps = {
      listWorkspaces: async () => [ws("ws_1")],
      claim: async () => {
        throw new Error("claim failed");
      },
      evaluate: async (id) => {
        calls.push(id);
        return result({ triggered: 1 });
      },
      now: () => Date.now(),
    };

    const res = await runAlertSweep(deps);

    expect(calls).toEqual(["ws_1"]);
    expect(res.triggered).toBe(1);
  });
});

// ─────────── Slack配信のテナント分離（notify.ts の穴埋め） ───────────

/**
 * cron が動き出すと、この経路は「人が見ていないところで」毎回走る。ボタンを
 * 押したときだけなら気づけた誤配信が、放っておくと静かに積み上がるので、
 * 同じ変更のなかで塞いでテストも隣に置く。
 *
 * 塞いだ穴: `getSecret` は復号に失敗しても null を返す（decryptSecret が
 * throw しない設計）ため、「自分の Slack を接続しているのに読めない」
 * ワークスペースが、未接続扱いでデプロイ共通のWebhookへ落ちていた。
 * catch は一度も実行されず、コメントが書いてある不変条件だけが嘘だった。
 */
const notifyState = vi.hoisted(() => ({
  workspaces: [{ id: "ws_1" }] as { id: string }[],
  /** Integration 行の有無。null は未接続。 */
  slackRow: null as { id: string } | null,
  /** getSecret の戻り。null は「未接続 or 復号できない」。 */
  secret: null as string | null,
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findMany: vi.fn(async () => notifyState.workspaces) },
    integration: { findFirst: vi.fn(async () => notifyState.slackRow) },
  },
  toJson: (value: unknown) => value,
}));

vi.mock("@/lib/integrations", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/integrations")>();
  return { ...actual, getSecret: vi.fn(async () => notifyState.secret) };
});

const slackMocks = vi.hoisted(() => ({
  postToSlack: vi.fn(async (_url: string, _msg: unknown) => ({ ok: true }) as { ok: true }),
  notifyWorkspaceSlack: vi.fn(async (_id: string, _msg: unknown) => true),
}));
vi.mock("@/lib/slack", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/slack")>();
  return { ...actual, ...slackMocks };
});

const FALLBACK = "https://hooks.slack.com/services/T000/B000/abcdefg";
process.env.SLACK_WEBHOOK_URL = FALLBACK;
process.env.SLACK_WEBHOOK_SINGLE_TENANT = "true";

const { sendWorkspaceSlack } = await import("@/lib/notify");

describe("sendWorkspaceSlack（保存済みのSlack行があるならフォールバックしない）", () => {
  beforeEach(() => {
    notifyState.workspaces = [{ id: "ws_1" }];
    notifyState.slackRow = null;
    notifyState.secret = null;
    slackMocks.postToSlack.mockClear();
    slackMocks.notifyWorkspaceSlack.mockClear();
  });

  it("一度もSlackを接続していないワークスペースは、従来どおりフォールバックへ", async () => {
    expect(await sendWorkspaceSlack("ws_1", { title: "アラート" })).toBe(true);
    expect(slackMocks.postToSlack).toHaveBeenCalledTimes(1);
    expect(slackMocks.postToSlack.mock.calls[0][0]).toBe(FALLBACK);
  });

  it("接続済みなら、そのワークスペースのWebhookへ送る", async () => {
    notifyState.slackRow = { id: "int_1" };
    notifyState.secret = "https://hooks.slack.com/services/T111/B111/xyz";

    expect(await sendWorkspaceSlack("ws_1", { title: "アラート" })).toBe(true);
    expect(slackMocks.notifyWorkspaceSlack).toHaveBeenCalledTimes(1);
    expect(slackMocks.postToSlack).not.toHaveBeenCalled();
  });

  /** 回帰テスト: AUTH_SECRET を入れ替えた直後などに起きていた誤配信。 */
  it("接続済みだが復号できない場合は、デプロイ共通のWebhookへ回さず送らない", async () => {
    notifyState.slackRow = { id: "int_1" };
    notifyState.secret = null; // 復号できない／無効化されている

    expect(await sendWorkspaceSlack("ws_1", { title: "アラート" })).toBe(false);
    expect(slackMocks.postToSlack).not.toHaveBeenCalled();
    expect(slackMocks.notifyWorkspaceSlack).not.toHaveBeenCalled();
  });
});
