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
import { ApiError } from "@/lib/errors";
import { buildMessage } from "@/lib/slack";
import type { AlertMessage, AlertMessageInput } from "@/lib/alerts";

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
process.env.SLACK_WEBHOOK_SINGLE_TENANT = "true";

const { runEachIsolated, describeRuleError, buildAlertMessage } =
  await import("@/lib/alerts");
const { resolveFallbackWebhook, sendWorkspaceSlack, isSingleTenantOptIn } =
  await import("@/lib/notify");

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

  it("失敗を握りつぶさず、日本語の理由を添えて返す（内部の文言は載せない）", async () => {
    const result = await runEachIsolated(rules, async (rule) => {
      if (rule.id === "r2") throw new Error("Invalid widget config");
      return false;
    });

    expect(result.failures[0].message).toContain("評価に失敗しました");
    // 例外の本文は利用者に出さない（サーバ内部が漏れるため）。原因の特定は
    // サーバログ側で行う。詳細は describeRuleError のコメント参照。
    expect(result.failures[0].message).not.toContain("Invalid widget config");
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

  it("既知のPrismaコードはそれぞれの日本語になる", () => {
    expect(describeRuleError({ code: "P2003" })).toContain("参照先のスプレッドシート");
    expect(describeRuleError({ code: "P1001" })).toContain("データベースに接続できません");
  });

  /**
   * 回帰テスト: 以前は例外の本文をそのまま利用者に返していたため、Prisma の
   * 既定フォーマットに含まれるサーバのファイルパス・行番号や、接続失敗時の
   * DBホスト名・ポートが、ワークスペースの誰でも押せる「今すぐ評価する」から
   * 読めてしまっていた。
   */
  it("例外の本文はそのまま出さない（サーバ内部が漏れないこと）", () => {
    const prismaLike = new Error(
      "Invalid `prisma.alertRule.update()` invocation in\n/home/user/dashdrop/src/lib/alerts.ts:245:26",
    );
    const msg = describeRuleError(prismaLike);
    expect(msg).not.toContain("/home/user");
    expect(msg).not.toContain("alerts.ts");
    expect(msg).not.toContain("prisma");
    expect(msg).toBe(
      "評価に失敗しました。ルールの設定と対象シートをご確認ください。",
    );

    const connLike = Object.assign(
      new Error("Can't reach database server at `db.internal.example`:`5432`"),
      { code: "P1013" },
    );
    const connMsg = describeRuleError(connLike);
    expect(connMsg).not.toContain("db.internal.example");
    expect(connMsg).not.toContain("5432");
  });

  it("ApiError だけは利用者向けの文言として通す", () => {
    expect(describeRuleError(new ApiError("対象のスプレッドシートがありません", 404))).toBe(
      "対象のスプレッドシートがありません",
    );
  });

  it("文字列・undefined・空メッセージでも日本語の理由になる", () => {
    for (const v of ["壊れています", undefined, null, 42, new Error("   ")]) {
      const msg = describeRuleError(v);
      expect(msg).toBe(
        "評価に失敗しました。ルールの設定と対象シートをご確認ください。",
      );
    }
  });
});

describe("resolveFallbackWebhook（F8: env フォールバックの限定）", () => {
  it("未設定なら使わない", () => {
    expect(resolveFallbackWebhook(undefined, 1, true)).toEqual({
      use: false,
      reason: "unset",
    });
    expect(resolveFallbackWebhook("   ", 1, true)).toEqual({
      use: false,
      reason: "unset",
    });
  });

  it("ワークスペースが複数あるデプロイでは、正しいURLでも使わない", () => {
    expect(resolveFallbackWebhook(FALLBACK, 2, true)).toEqual({
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
      expect(resolveFallbackWebhook(bad, 1, true)).toEqual({
        use: false,
        reason: "invalid",
      });
    }
  });

  /**
   * 回帰テスト: 「今ワークスペースが1つ」を自己ホストの証拠として扱っていたため、
   * ホスティング版でも最初の1社が登録した直後や、整理して1社になった瞬間に
   * フォールバックが復活し、そのお客さまの通知が運営のチャンネルへ流れていた。
   */
  it("SLACK_WEBHOOK_SINGLE_TENANT の宣言が無ければ、単一ワークスペースでも使わない", () => {
    expect(resolveFallbackWebhook(FALLBACK, 1, false)).toEqual({
      use: false,
      reason: "not-opted-in",
    });
  });

  it("宣言の真偽解釈", () => {
    for (const yes of ["true", "TRUE", " 1 ", "yes", "on"]) {
      expect(isSingleTenantOptIn(yes), yes).toBe(true);
    }
    for (const no of ["", "  ", "false", "0", "no", "maybe", undefined]) {
      expect(isSingleTenantOptIn(no), String(no)).toBe(false);
    }
  });

  it("宣言済み＋単一ワークスペース＋正しいURLのときだけ使う", () => {
    expect(resolveFallbackWebhook(`  ${FALLBACK}  `, 1, true)).toEqual({
      use: true,
      url: FALLBACK,
    });
    expect(resolveFallbackWebhook(FALLBACK, 0, true)).toEqual({
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

/**
 * 通知の文面そのもの。DBに触れないので、実際に届く文字列を直接固定できる。
 *
 * 直したこと（すべて実際に届いていた文面の問題）:
 *  - どのシートで起きたかを一度も言っていなかった（シートが十数枚あると特定不能）
 *  - ルール名と現在値・しきい値が2回ずつ書かれ、分量の半分が繰り返しだった
 *  - 手元にある lastValue を使わず、「どう動いたか」を伝えていなかった
 *  - 金額フィールドでも displayValue("number", …) 固定で「¥」が落ちていた
 *  - しきい値だけ書式化されず、整形済みの現在値と並んでいた
 *  - リンクの文言が「DashDrop で開く」で、行き先が分からなかった
 */
describe("buildAlertMessage（通知の文面）", () => {
  const base: AlertMessageInput = {
    ruleName: "今月の売上が目標割れ",
    collectionName: "売上台帳",
    collectionId: "clx9a",
    measure: { kind: "sum", field: "amount" },
    fields: [{ key: "amount", type: "currency" }],
    operator: "lt",
    threshold: 3_000_000,
    value: 2_842_300,
    lastValue: 3_120_000,
  };
  const message = (over: Partial<AlertMessageInput> = {}): AlertMessage =>
    buildAlertMessage({ ...base, ...over });

  it("金額の集計は ¥ 付き・しきい値も同じ書式・前回からの動きを出す", () => {
    const msg = message();

    expect(msg.title).toBe("🚨 今月の売上が目標割れ｜売上台帳");
    expect(msg.body).toBe(
      "前回 ¥3,120,000 → 今回 ¥2,842,300（-¥277,700）\n" +
        "しきい値 ¥3,000,000を下回りました",
    );
    expect(msg.url).toBe("/c/clx9a");
    expect(msg.linkLabel).toBe("売上台帳を開く");

    // 裸の数字（¥なし・書式なし）が残っていないこと。
    expect(msg.body).not.toContain("3000000");
    expect(msg.body).not.toMatch(/(?<!¥)2,842,300/);
    // ルール名は見出しに1回だけ。
    expect(msg.body).not.toContain(base.ruleName);
  });

  it("件数の集計は「件」を付け、金額記号は付けない", () => {
    const msg = message({
      ruleName: "未対応の問い合わせが増加",
      collectionName: "問い合わせ",
      measure: { kind: "count" },
      fields: [{ key: "amount", type: "currency" }],
      operator: "gte",
      threshold: 10,
      value: 14,
      lastValue: 8,
    });

    expect(msg.title).toBe("🚨 未対応の問い合わせが増加｜問い合わせ");
    expect(msg.body).toBe("前回 8件 → 今回 14件（+6件）\nしきい値 10件以上になりました");
    // count は対象フィールドを持たないので、単位を偽ってはいけない。
    expect(msg.body).not.toContain("¥");
  });

  it("初回の発火では「前回」を書かず、初回だと明示する", () => {
    const msg = message({ lastValue: null });

    expect(msg.body).toBe(
      "現在 ¥2,842,300（初回の通知）\nしきい値 ¥3,000,000を下回りました",
    );
    expect(msg.body).not.toContain("前回");
    expect(msg.body).not.toContain("null");
    expect(msg.body).not.toContain("NaN");
  });

  it("値が 0 でも「0」として残る（消えると在庫切れ・売上ゼロを見落とす）", () => {
    const zero = message({ value: 0, lastValue: 480_000 });
    expect(zero.body).toContain("今回 ¥0");
    expect(zero.body).toContain("前回 ¥480,000");
    expect(zero.body).toContain("（-¥480,000）");

    const zeroCount = message({
      measure: { kind: "count" },
      threshold: 1,
      value: 0,
      lastValue: null,
      operator: "lt",
    });
    expect(zeroCount.body).toBe("現在 0件（初回の通知）\nしきい値 1件を下回りました");
  });

  it("しきい値も現在値も 0 のとき、しきい値が消えない", () => {
    const msg = message({ threshold: 0, value: 0, lastValue: 100 });
    expect(msg.body).toContain("しきい値 ¥0");
  });

  it("Infinity は ∞ と出し、差分は書かない（NaN を出さない）", () => {
    const msg = message({ value: Infinity, lastValue: Infinity });
    expect(msg.body).toContain("¥∞");
    expect(msg.body).not.toContain("NaN");
  });

  it("ルール名もシート名も空なら DashDrop に落ちる", () => {
    const msg = message({ ruleName: "   ", collectionName: "" });
    expect(msg.title).toBe("DashDrop");
    expect(msg.linkLabel).toBe("DashDrop で開く");
  });

  it("非常に長いシート名は省略し、ルール名を押し出さない", () => {
    const long = "２０２５年度_関東エリア_全店舗_日次売上明細_統合版_バックアップ";
    const msg = message({ collectionName: long });

    expect(msg.title.startsWith("🚨 今月の売上が目標割れ｜")).toBe(true);
    expect(msg.title.length).toBeLessThan(60);
    expect(msg.title).toContain("…");
    expect(msg.linkLabel.endsWith("を開く")).toBe(true);
    expect(msg.linkLabel.length).toBeLessThan(40);
  });
});

describe("アラート通知の実際のペイロード（Slack / アプリ内）", () => {
  const input: AlertMessageInput = {
    ruleName: "今月の売上が目標割れ",
    collectionName: "売上台帳",
    collectionId: "clx9a",
    measure: { kind: "sum", field: "amount" },
    fields: [{ key: "amount", type: "currency" }],
    operator: "lt",
    threshold: 3_000_000,
    value: 2_842_300,
    lastValue: 3_120_000,
  };

  /** 文面が「部品として正しい」だけでなく、送信される JSON ごと固定する。 */
  it("Slack へ送る JSON を丸ごと固定する", () => {
    const msg = buildAlertMessage(input);
    const payload = buildMessage({
      title: msg.title,
      body: msg.body,
      url: `https://app.example.com${msg.url}`,
      linkLabel: msg.linkLabel,
    });

    expect(payload).toEqual({
      text:
        "🚨 今月の売上が目標割れ｜売上台帳 / " +
        "前回 ¥3,120,000 → 今回 ¥2,842,300（-¥277,700）\n" +
        "しきい値 ¥3,000,000を下回りました / " +
        "https://app.example.com/c/clx9a",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              "*🚨 今月の売上が目標割れ｜売上台帳*\n" +
              "前回 ¥3,120,000 → 今回 ¥2,842,300（-¥277,700）\n" +
              "しきい値 ¥3,000,000を下回りました",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "<https://app.example.com/c/clx9a|売上台帳を開く>",
          },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: "DashDrop からの通知" }],
        },
      ],
    });
  });

  /**
   * 回帰テスト: ルール名・シート名は利用者が自由に付けられる。<!channel> を
   * 含むまま送ると、通知先チャンネル全員をメンションできてしまう。
   */
  it("ルール名の <!channel> は blocks にも text にも素通ししない", () => {
    const msg = buildAlertMessage({
      ...input,
      ruleName: "<!channel> 至急",
      collectionName: "<!here> 売上台帳",
    });

    // 文面の組み立て自体はエスケープしない（アプリ内通知はHTMLとして解釈しない）。
    expect(msg.title).toBe("🚨 <!channel> 至急｜<!here> 売上台帳");

    const payload = buildMessage({
      title: msg.title,
      body: msg.body,
      url: `https://app.example.com${msg.url}`,
      linkLabel: msg.linkLabel,
    });
    const json = JSON.stringify(payload.blocks);
    for (const raw of ["<!channel>", "<!here>"]) {
      expect(payload.text).not.toContain(raw);
      expect(json).not.toContain(raw);
    }
    expect(payload.text).toContain("&lt;!channel&gt;");
    // リンクのラベル（シート名由来）にも同じエスケープが要る。
    expect(json).toContain("&lt;!here&gt; 売上台帳を開く");
  });

  it("桁の大きい値でも Slack の上限を超えない", () => {
    const msg = buildAlertMessage({
      ...input,
      value: Number.MAX_VALUE,
      lastValue: Number.MAX_VALUE / 2,
      threshold: Number.MAX_VALUE / 3,
    });
    const payload = buildMessage({
      title: msg.title,
      body: msg.body,
      url: `https://app.example.com${msg.url}`,
      linkLabel: msg.linkLabel,
    });

    expect(payload.text.length).toBeLessThanOrEqual(2000);
    for (const b of payload.blocks as { text?: { text?: string } }[]) {
      if (b.text?.text) expect(b.text.text.length).toBeLessThanOrEqual(3000);
    }
  });
});
