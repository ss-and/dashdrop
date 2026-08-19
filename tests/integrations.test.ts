/**
 * 連携（Slack）まわりの回帰テスト。
 *
 * 直したのは、どれも「画面は接続済みと言っているのに、実際には届かない／
 * 届いた証拠が別物」という種類の不具合なので、ここで押さえるのは次の4点：
 *
 *  1. connected の定義が getSecret（＝実際に配信できる条件）と一致していること。
 *  2. 認証情報を入れ替えたら送信履歴が白紙に戻ること（前のWebhookの成功時刻を
 *     新しいWebhookの「最終送信」として見せない）。
 *  3. 通知先チャンネルの控えが config を往復すること。
 *  4. Slackに拒否された送信が、HTTPのステータスでも失敗として返ること。
 *
 * db は全面的にモックし、Prisma もネットワークも触らない。暗号化だけは本物を
 * 使う（復号できない行の扱いが論点なので、ここを偽物にすると意味がない）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  db: {
    integration: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  postToSlack: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db, toJson: (v: unknown) => v }));

// buildMessage は本物のまま（送信内容の組み立ては tests/slack.test.ts の担当）。
// 差し替えるのは実際にネットワークへ出る postToSlack だけ。
vi.mock("@/lib/slack", async () => {
  const actual = await vi.importActual<typeof import("@/lib/slack")>(
    "@/lib/slack",
  );
  return { ...actual, postToSlack: mocks.postToSlack };
});

// next/server を読み込まずにルートを呼ぶための最小の @/lib/api。
// ApiError は本物を使い、instanceof 判定をルート側と一致させる。
vi.mock("@/lib/api", async () => {
  const errors = await import("@/lib/errors");
  return {
    ApiError: errors.ApiError,
    ok: (data: unknown) => ({ ok: true, data }),
    fail: (error: string, status: number) => ({ ok: false, error, status }),
    withAuth: (handler: unknown) => handler,
    readJson: async (
      req: { json: () => Promise<unknown> },
      schema: { parse: (v: unknown) => unknown },
    ) => schema.parse(await req.json()),
  };
});

import { ApiError } from "@/lib/errors";
import { encryptSecret } from "@/lib/crypto";
import {
  getIntegration,
  getSecret,
  listIntegrations,
  saveIntegration,
  normaliseChannelHint,
  readChannelHint,
  CHANNEL_HINT_MAX,
  type IntegrationSummary,
} from "@/lib/integrations";
import { SlackCard } from "@/components/settings/SlackCard";

const WEBHOOK = "https://hooks.slack.com/services/T000/B000/abcdefghij";
const OTHER_WEBHOOK = "https://hooks.slack.com/services/T000/B999/zyxwvutsrq";

/** Prisma の行に見える最小のオブジェクト。 */
interface StoredRow {
  provider: string;
  enabled: boolean;
  secret: string;
  config: unknown;
  lastOkAt: Date | null;
  lastError: string | null;
}

function row(over: Partial<StoredRow> = {}): StoredRow {
  return {
    provider: "slack",
    enabled: true,
    secret: encryptSecret(WEBHOOK),
    config: null,
    lastOkAt: null,
    lastError: null,
    ...over,
  };
}

interface UpsertArgs {
  create: { secret: string; config?: unknown };
  update: Record<string, unknown>;
}

/**
 * upsert / findUnique / update を1行ぶんのメモリに結びつける。
 * ルートは「保存 → 結果を記録 → 読み直して返す」と3回 db に触るので、
 * それぞれが独立した固定値を返すモックだと何も検証できない。
 */
function wireStore(initial: StoredRow | null = null) {
  let current: StoredRow | null = initial;

  mocks.db.integration.upsert.mockImplementation(async (args: UpsertArgs) => {
    current = current
      ? ({ ...current, ...args.update } as StoredRow)
      : {
          provider: "slack",
          enabled: true,
          secret: args.create.secret,
          config: args.create.config ?? null,
          lastOkAt: null,
          lastError: null,
        };
    return current;
  });
  mocks.db.integration.findUnique.mockImplementation(async () => current);
  mocks.db.integration.update.mockImplementation(
    async (args: { data: Record<string, unknown> }) => {
      if (current) current = { ...current, ...args.data } as StoredRow;
      return current;
    },
  );

  return () => current;
}

beforeEach(() => {
  for (const fn of Object.values(mocks.db.integration)) fn.mockReset();
  mocks.postToSlack.mockReset();
  mocks.postToSlack.mockResolvedValue({ ok: true });
});

// ---------------------------------------------------------------------------
// 1. connected の判定
// ---------------------------------------------------------------------------

describe("connected は「実際に配信できるか」と一致する", () => {
  it("有効で復号できる行だけを接続済みとして返す", async () => {
    mocks.db.integration.findUnique.mockResolvedValue(row());

    const s = await getIntegration("ws-1", "slack");
    expect(s?.connected).toBe(true);
    expect(s?.status).toBe("connected");
    // 実物ではなくマスクだけが出ていく。
    expect(s?.masked).not.toContain("abcdefghij");
    expect(s?.masked).toBe(`http…${WEBHOOK.slice(-4)}`);
  });

  it("enabled:false の行は接続済みにしない（getSecret も null を返す＝送られない）", async () => {
    mocks.db.integration.findUnique.mockResolvedValue(row({ enabled: false }));

    const s = await getIntegration("ws-1", "slack");
    expect(s?.connected).toBe(false);
    expect(s?.status).toBe("disabled");
    // 接続済みの見た目（マスク）も出さない。
    expect(s?.masked).toBeNull();

    // 配信側の判断と突き合わせる：ここがずれていたのが元の不具合。
    mocks.db.integration.findUnique.mockResolvedValue(row({ enabled: false }));
    await expect(getSecret("ws-1", "slack")).resolves.toBeNull();
  });

  it("復号できない行は unreadable として返し、記録済みのエラーも残す", async () => {
    mocks.db.integration.findUnique.mockResolvedValue(
      row({ secret: "v1.aaa.bbb.ccc", lastError: "Webhookが無効です。" }),
    );

    const s = await getIntegration("ws-1", "slack");
    expect(s?.connected).toBe(false);
    expect(s?.status).toBe("unreadable");
    expect(s?.enabled).toBe(true);
    expect(s?.masked).toBeNull();
    expect(s?.lastError).toBe("Webhookが無効です。");
  });

  it("行が無いプロバイダは disconnected", async () => {
    mocks.db.integration.findMany.mockResolvedValue([row()]);

    const all = await listIntegrations("ws-1");
    expect(all.find((s) => s.provider === "slack")?.status).toBe("connected");
    expect(all.find((s) => s.provider === "notion")?.status).toBe(
      "disconnected",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. 付け替えたら履歴は白紙 / 3. チャンネルの控え
// ---------------------------------------------------------------------------

describe("saveIntegration", () => {
  it("認証情報を入れ替えたら lastOkAt と lastError を消す", async () => {
    const read = wireStore(
      row({
        lastOkAt: new Date("2026-08-01T00:00:00.000Z"),
        lastError: "古いエラー",
      }),
    );

    const s = await saveIntegration("ws-1", "slack", OTHER_WEBHOOK);

    const args = mocks.db.integration.upsert.mock.calls[0][0] as UpsertArgs;
    expect(args.update.lastOkAt).toBeNull();
    expect(args.update.lastError).toBeNull();
    // 前のWebhookの成功時刻が「最終送信」として残らない。
    expect(s.lastOkAt).toBeNull();
    expect(read()?.lastOkAt).toBeNull();
  });

  it("通知先チャンネルの控えが config を往復する", async () => {
    wireStore();

    const s = await saveIntegration("ws-1", "slack", WEBHOOK, {
      channelHint: "#売上アラート",
    });

    expect(s.config).toEqual({ channelHint: "#売上アラート" });
    expect(readChannelHint(s.config)).toBe("#売上アラート");
  });

  it("空の控えを渡すと、以前の控えを消す", async () => {
    wireStore(row({ config: { channelHint: "#古いチャンネル" } }));

    const s = await saveIntegration("ws-1", "slack", WEBHOOK, {
      channelHint: "",
    });

    expect(readChannelHint(s.config)).toBeNull();
  });

  it("hooks.slack.com 以外のURLは保存しない", async () => {
    wireStore();

    for (const bad of [
      "http://hooks.slack.com/services/T/B/x",
      "https://example.com/services/T/B/x",
      "https://hooks.slack.com.evil.test/x",
      "not a url",
    ]) {
      const err = await saveIntegration("ws-1", "slack", bad).catch((e) => e);
      expect(err, bad).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(422);
    }
    expect(mocks.db.integration.upsert).not.toHaveBeenCalled();
  });
});

describe("normaliseChannelHint", () => {
  it("前後の空白を落とし、空欄は null にする", () => {
    expect(normaliseChannelHint("  #営業  ")).toBe("#営業");
    expect(normaliseChannelHint("   ")).toBeNull();
    expect(normaliseChannelHint("")).toBeNull();
  });

  it("記号の付け方は矯正しない（宛先ではなく控えなので）", () => {
    expect(normaliseChannelHint("営業チーム")).toBe("営業チーム");
    expect(normaliseChannelHint("@yamada")).toBe("@yamada");
  });

  it("長すぎる入力を切り詰め、文字列以外は null にする", () => {
    expect(normaliseChannelHint("あ".repeat(200))).toHaveLength(
      CHANNEL_HINT_MAX,
    );
    expect(normaliseChannelHint(42)).toBeNull();
    expect(normaliseChannelHint(null)).toBeNull();
  });

  it("readChannelHint は壊れた config を読み飛ばす", () => {
    expect(readChannelHint({ channelHint: 12 })).toBeNull();
    expect(readChannelHint({})).toBeNull();
    expect(readChannelHint(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. ルート
// ---------------------------------------------------------------------------

interface RouteUser {
  name: string;
  workspace: { id: string; name: string };
}
type RouteResult = { ok: true; data: unknown };
type RouteHandler = (
  req: { json: () => Promise<unknown> },
  ctx: { user: RouteUser; params: Record<string, string> },
) => Promise<RouteResult>;

const CTX = {
  user: { name: "山田", workspace: { id: "ws-1", name: "テスト商店" } },
  params: {},
};

function reqWith(body: unknown): { json: () => Promise<unknown> } {
  return { json: async () => body };
}

async function connectRoute(): Promise<RouteHandler> {
  const mod = await import("@/app/api/integrations/slack/route");
  return mod.POST as unknown as RouteHandler;
}

async function testRoute(): Promise<RouteHandler> {
  const mod = await import("@/app/api/integrations/slack/test/route");
  return mod.POST as unknown as RouteHandler;
}

describe("POST /api/integrations/slack", () => {
  it("実際に送ってみて、通ったものだけを保存する", async () => {
    const read = wireStore();
    const handler = await connectRoute();

    const res = await handler(
      reqWith({ webhookUrl: WEBHOOK, channelHint: " #売上アラート " }),
      CTX,
    );

    expect(mocks.postToSlack).toHaveBeenCalledTimes(1);
    expect(mocks.db.integration.upsert).toHaveBeenCalledTimes(1);
    const summary = res.data as IntegrationSummary;
    expect(summary.connected).toBe(true);
    expect(readChannelHint(summary.config)).toBe("#売上アラート");
    // 疎通したテスト送信そのものが、このWebhookにとっての最初の「最終送信」。
    expect(summary.lastOkAt).not.toBeNull();
    expect(read()?.lastError).toBeNull();
  });

  it("形は正しいが死んでいるWebhookは保存せず、理由を返す", async () => {
    wireStore();
    mocks.postToSlack.mockResolvedValue({
      ok: false,
      error: "Webhookが無効です。Slack側で再作成してください。",
    });
    const handler = await connectRoute();

    const err = await handler(reqWith({ webhookUrl: WEBHOOK }), CTX).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.message).toContain("Webhookが無効です");
    // 黙って捨てるのではなく、保存しなかったことまで伝える。
    expect(err.message).toContain("保存していません");
    expect(mocks.db.integration.upsert).not.toHaveBeenCalled();
  });

  it("差し替えに失敗しても、いま使えている接続は壊さない", async () => {
    const existing = row({ lastOkAt: new Date("2026-08-01T00:00:00.000Z") });
    const read = wireStore(existing);
    mocks.postToSlack.mockResolvedValue({ ok: false, error: "だめでした" });
    const handler = await connectRoute();

    await handler(reqWith({ webhookUrl: OTHER_WEBHOOK }), CTX).catch(() => {});

    // 古い認証情報も、その送信履歴もそのまま。
    expect(mocks.db.integration.upsert).not.toHaveBeenCalled();
    expect(read()?.secret).toBe(existing.secret);
    expect(read()?.lastOkAt).toEqual(new Date("2026-08-01T00:00:00.000Z"));
  });

  it("hooks.slack.com 以外にはそもそも送りに行かない（SSRF対策）", async () => {
    wireStore();
    const handler = await connectRoute();

    const err = await handler(
      reqWith({ webhookUrl: "https://internal.test/hook" }),
      CTX,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(mocks.postToSlack).not.toHaveBeenCalled();
    expect(mocks.db.integration.upsert).not.toHaveBeenCalled();
  });
});

describe("POST /api/integrations/slack/test", () => {
  it("Slackに拒否されたら失敗のステータスで返す", async () => {
    wireStore(row());
    mocks.postToSlack.mockResolvedValue({
      ok: false,
      error: "通知先のチャンネルが見つかりません。",
    });
    const handler = await testRoute();

    const err = await handler(reqWith({}), CTX).catch((e) => e);

    // 以前はここが HTTP 200 + { ok:false } で、カード以外の呼び出し元には
    // 成功と区別がつかなかった。
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.message).toBe("通知先のチャンネルが見つかりません。");
    // 理由は行にも残る（カードの「前回のエラー」がこれ）。
    expect(mocks.db.integration.update).toHaveBeenCalled();
  });

  it("成功したら送信時刻を返す", async () => {
    wireStore(row());
    const handler = await testRoute();

    const res = await handler(reqWith({}), CTX);

    const data = res.data as { ok: boolean; sentAt: string };
    expect(data.ok).toBe(true);
    expect(Number.isNaN(Date.parse(data.sentAt))).toBe(false);
  });

  it("未接続なら送らずに400", async () => {
    wireStore(null);
    const handler = await testRoute();

    const err = await handler(reqWith({}), CTX).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(mocks.postToSlack).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// カード
// ---------------------------------------------------------------------------

const realFetch = global.fetch;

afterEach(() => {
  cleanup();
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

function summary(over: Partial<IntegrationSummary> = {}): IntegrationSummary {
  return {
    provider: "slack",
    connected: true,
    enabled: true,
    masked: "http…brij",
    config: {},
    lastOkAt: "2026-08-18T05:00:00.000Z",
    lastError: null,
    status: "connected",
    ...over,
  };
}

/** fetch を1回ぶんだけ差し替える。送信本文を検査できるよう init も受け取る。 */
function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init?: { body?: string }) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function renderCard(initial: IntegrationSummary | null) {
  return render(createElement(SlackCard, { initial }));
}

describe("SlackCard", () => {
  it("未接続では、Webhook URL の取り方を4手順で示す", () => {
    renderCard(null);

    expect(screen.getByText("未接続")).toBeInTheDocument();
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    expect(steps[1].textContent).toContain("Incoming Webhooks");
    expect(steps[2].textContent).toContain("チャンネル");
    expect(screen.getByLabelText("Webhook URL")).toBeInTheDocument();
  });

  it("Slackに送られるもの・送られないものを言い切る", () => {
    renderCard(null);

    const body = document.body.textContent ?? "";
    expect(body).toContain("アラート");
    // レポートはSlackを一切通らない（sendWorkspaceSlack の呼び出し元は
    // アラート評価だけ）。
    expect(body).toContain("レポートはSlackには送信されません");
    // ベルはSlackの設定に関係なく必ず鳴る。
    expect(body).toContain("必ず届き");
  });

  it("enabled:false の行では接続済みと表示しない", () => {
    renderCard(
      summary({ connected: false, enabled: false, status: "disabled", masked: null }),
    );

    expect(screen.queryByText("接続済み")).toBeNull();
    expect(screen.getByText("未接続")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "テスト送信" })).toBeNull();
  });

  it("復号できないときは、未接続の画面でも理由と次の一手を出す", () => {
    renderCard(
      summary({ connected: false, status: "unreadable", masked: null }),
    );

    expect(screen.getByText("未接続")).toBeInTheDocument();
    const body = document.body.textContent ?? "";
    expect(body).toContain("読み取れなくなった");
    expect(body).toContain("暗号鍵");
    expect(body).toContain("もう一度貼り付ける");
    // 説明だけで終わらせず、貼り直せる欄も一緒に出す。
    expect(screen.getByLabelText("Webhook URL")).toBeInTheDocument();
  });

  it("記録済みのエラーは1か所にだけ出す", async () => {
    const message = "通知先のチャンネルが見つかりません。";
    stubFetch(502, { ok: false, error: message });
    renderCard(summary());

    fireEvent.click(screen.getByRole("button", { name: "テスト送信" }));

    await waitFor(() =>
      expect(screen.getAllByText(new RegExp(message))).toHaveLength(1),
    );
  });

  it("送信中は他の操作を受け付けない", async () => {
    // 応答を止めたまま「送信中」の状態を作る。
    let release = (): void => {};
    global.fetch = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          release = () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ ok: true, data: { ok: true } }),
            });
        }),
    ) as unknown as typeof fetch;

    renderCard(summary());
    fireEvent.click(screen.getByRole("button", { name: "テスト送信" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "解除" })).toBeDisabled(),
    );
    expect(
      screen.getByRole("button", { name: "Webhook を変更" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "送信中…" })).toBeDisabled();

    release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "解除" })).toBeEnabled(),
    );
  });

  it("接続したまま Webhook を差し替えられる", async () => {
    const next = summary({
      masked: "http…zzzz",
      config: { channelHint: "#新チャンネル" },
      lastOkAt: "2026-08-19T01:02:00.000Z",
    });
    const fetchMock = stubFetch(200, { ok: true, data: next });
    renderCard(summary({ config: { channelHint: "#旧チャンネル" } }));

    expect(screen.getByText("#旧チャンネル")).toBeInTheDocument();
    // 解除せずに変更できる。
    fireEvent.click(screen.getByRole("button", { name: "Webhook を変更" }));
    fireEvent.change(screen.getByLabelText("Webhook URL"), {
      target: { value: OTHER_WEBHOOK },
    });
    fireEvent.change(screen.getByLabelText("通知先チャンネル名（任意）"), {
      target: { value: "#新チャンネル" },
    });
    fireEvent.click(screen.getByRole("button", { name: "変更して接続" }));

    await waitFor(() =>
      expect(screen.getByText("#新チャンネル")).toBeInTheDocument(),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body ?? "{}") as {
      webhookUrl: string;
      channelHint: string;
    };
    expect(body.webhookUrl).toBe(OTHER_WEBHOOK);
    expect(body.channelHint).toBe("#新チャンネル");
    expect(screen.getByText("http…zzzz")).toBeInTheDocument();
  });

  it("保存できなかったときは、貼り付けた値を消さない", async () => {
    stubFetch(502, {
      ok: false,
      error: "Webhookが無効です。（この Webhook URL は保存していません）",
    });
    renderCard(null);

    const input = screen.getByLabelText("Webhook URL");
    fireEvent.change(input, { target: { value: OTHER_WEBHOOK } });
    fireEvent.click(screen.getByRole("button", { name: "接続" }));

    await waitFor(() =>
      expect(screen.getByText(/保存していません/)).toBeInTheDocument(),
    );
    expect((input as HTMLInputElement).value).toBe(OTHER_WEBHOOK);
  });

  it("解除の確認文は、実際に止まるものだけを述べる", () => {
    const confirmed: string[] = [];
    vi.spyOn(window, "confirm").mockImplementation((msg?: string) => {
      confirmed.push(String(msg));
      return false;
    });
    renderCard(summary());

    fireEvent.click(screen.getByRole("button", { name: "解除" }));

    expect(confirmed[0]).toContain("アラート");
    expect(confirmed[0]).not.toContain("レポート");
    expect(confirmed[0]).toContain("アプリ内の通知は続きます");
  });

  it("エラーと結果の読み上げ領域は、中身より先に存在する", () => {
    renderCard(summary());

    // 空でも領域そのものは置いておく（後から現れる領域は読み上げられない）。
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toBe("");
    expect(screen.getByRole("status")).toBeInTheDocument();
    // 入力欄はそのエラー領域を指す。
    fireEvent.click(screen.getByRole("button", { name: "Webhook を変更" }));
    expect(
      screen.getByLabelText("Webhook URL").getAttribute("aria-describedby"),
    ).toContain(alert.id);
  });
});
