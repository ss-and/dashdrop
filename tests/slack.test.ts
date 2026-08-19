import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildMessage, postToSlack } from "@/lib/slack";

/** A fetch stub returning one canned response. */
function mockFetch(
  init: { status?: number; body?: string; ok?: boolean } = {},
): ReturnType<typeof vi.fn> {
  const status = init.status ?? 200;
  const fn = vi.fn(async () => ({
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    text: async () => init.body ?? "ok",
  }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const realFetch = global.fetch;
const WEBHOOK = "https://hooks.slack.com/services/T000/B000/abcdefg";

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("buildMessage", () => {
  it("always produces a non-empty text fallback", () => {
    expect(buildMessage({ title: "売上アラート" }).text.length).toBeGreaterThan(0);
    expect(buildMessage({ title: "" }).text.length).toBeGreaterThan(0);
    expect(buildMessage({ title: "   " }).text.length).toBeGreaterThan(0);
  });

  it("includes the title in both the fallback and a section block", () => {
    const msg = buildMessage({ title: "在庫が不足しています" });
    expect(msg.text).toContain("在庫が不足しています");
    const json = JSON.stringify(msg.blocks);
    expect(json).toContain("在庫が不足しています");
    expect(json).toContain("*在庫が不足しています*");
  });

  it("includes the body when given", () => {
    const msg = buildMessage({ title: "T", body: "現在 12 件です" });
    expect(msg.text).toContain("現在 12 件です");
    expect(JSON.stringify(msg.blocks)).toContain("現在 12 件です");
  });

  it("renders fields as a two-column fields block", () => {
    const msg = buildMessage({
      title: "T",
      fields: [
        { label: "現在の値", value: "120" },
        { label: "しきい値", value: "100" },
      ],
    });
    const blocks = msg.blocks as { type: string; fields?: unknown[] }[];
    const fieldBlock = blocks.find((b) => Array.isArray(b.fields));
    expect(fieldBlock).toBeTruthy();
    expect(fieldBlock!.fields).toHaveLength(2);
    expect(JSON.stringify(fieldBlock)).toContain("しきい値");
    expect(msg.text).toContain("現在の値: 120");
  });

  it("omits the fields block when the list is empty", () => {
    const msg = buildMessage({ title: "T", fields: [] });
    const blocks = msg.blocks as { fields?: unknown[] }[];
    expect(blocks.some((b) => Array.isArray(b.fields))).toBe(false);
  });

  it("includes the url as a link and in the fallback", () => {
    const url = "https://app.example.com/c/abc123";
    const msg = buildMessage({ title: "T", url });
    expect(msg.text).toContain(url);
    expect(JSON.stringify(msg.blocks)).toContain(url);
  });

  it("labels the link with the destination the caller names", () => {
    const url = "https://app.example.com/c/abc123";
    const msg = buildMessage({ title: "T", url, linkLabel: "売上台帳を開く" });
    const link = JSON.stringify(msg.blocks);
    expect(link).toContain(`<${url}|売上台帳を開く>`);
    // 行き先を名乗ったなら、汎用の文言は出さない。
    expect(link).not.toContain("DashDrop で開く");
  });

  it("falls back to the generic link label when none is given", () => {
    const msg = buildMessage({ title: "T", url: "https://app.example.com/c/1" });
    expect(JSON.stringify(msg.blocks)).toContain("|DashDrop で開く>");
  });

  it("escapes and clamps a hostile or overlong link label", () => {
    const msg = buildMessage({
      title: "T",
      url: "https://app.example.com/c/1",
      linkLabel: `<!channel> ${"あ".repeat(5000)}を開く`,
    });
    const json = JSON.stringify(msg.blocks);
    expect(json).not.toContain("<!channel>");
    expect(json).toContain("&lt;!channel&gt;");
    for (const b of msg.blocks as { text?: { text?: string } }[]) {
      if (b.text?.text) expect(b.text.text.length).toBeLessThanOrEqual(3000);
    }
  });

  it("always appends a DashDrop context line", () => {
    const blocks = buildMessage({ title: "T" }).blocks as { type: string }[];
    expect(blocks[blocks.length - 1].type).toBe("context");
    expect(JSON.stringify(blocks)).toContain("DashDrop");
  });

  it("does not throw on very long text and keeps blocks within Slack limits", () => {
    const huge = "あ".repeat(50_000);
    const msg = buildMessage({
      title: huge,
      body: huge,
      url: `https://example.com/${huge}`,
      fields: Array.from({ length: 40 }, (_, i) => ({
        label: `ラベル${i}`,
        value: huge,
      })),
    });
    expect(msg.text.length).toBeLessThanOrEqual(2000);
    const blocks = msg.blocks as { fields?: unknown[] }[];
    const fieldBlock = blocks.find((b) => Array.isArray(b.fields));
    expect(fieldBlock!.fields!.length).toBeLessThanOrEqual(10);
    for (const b of blocks) {
      const text = (b as { text?: { text?: string } }).text?.text;
      if (text) expect(text.length).toBeLessThanOrEqual(3000);
    }
  });

  it("escapes Slack mrkdwn control characters", () => {
    const msg = buildMessage({ title: "<script> & </script>" });
    expect(JSON.stringify(msg.blocks)).not.toContain("<script>");
  });
});

describe("postToSlack", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns ok on Slack's plain-text 'ok' response", async () => {
    mockFetch({ status: 200, body: "ok" });
    await expect(postToSlack(WEBHOOK, buildMessage({ title: "T" }))).resolves.toEqual({
      ok: true,
    });
  });

  it("POSTs JSON to exactly the given URL with a Content-Type header", async () => {
    const fetchMock = mockFetch({ status: 200, body: "ok" });
    const msg = buildMessage({ title: "テスト", body: "本文" });
    await postToSlack(WEBHOOK, msg);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toBeTruthy();
    expect(JSON.parse(init.body as string)).toEqual(JSON.parse(JSON.stringify(msg)));
  });

  it("maps a 404 to the 'webhook invalid' message", async () => {
    mockFetch({ status: 404, body: "no_service" });
    const res = await postToSlack(WEBHOOK, buildMessage({ title: "T" }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe(
      "Webhookが無効です。Slack側で再作成してください。",
    );
  });

  it("maps no_service on any status to the 'webhook invalid' message", async () => {
    mockFetch({ status: 400, body: "no_service" });
    const res = await postToSlack(WEBHOOK, buildMessage({ title: "T" }));
    expect(res.ok === false && res.error).toContain("Webhookが無効です");
  });

  it("maps invalid_payload to its own message", async () => {
    mockFetch({ status: 400, body: "invalid_payload" });
    const res = await postToSlack(WEBHOOK, buildMessage({ title: "T" }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("送信内容の形式");
    expect(res.ok === false && res.error).not.toContain("400");
  });

  it("maps channel_not_found to its own message", async () => {
    mockFetch({ status: 404, body: "channel_not_found" });
    const res = await postToSlack(WEBHOOK, buildMessage({ title: "T" }));
    expect(res.ok === false && res.error).toContain("チャンネル");
  });

  it("maps no_team to a re-create-the-webhook message", async () => {
    mockFetch({ status: 400, body: "no_team" });
    const res = await postToSlack(WEBHOOK, buildMessage({ title: "T" }));
    expect(res.ok === false && res.error).toContain("Webhook");
  });

  it("reports the status and a truncated excerpt for unknown 500s", async () => {
    const long = "E".repeat(5000);
    mockFetch({ status: 500, body: long });
    const res = await postToSlack(WEBHOOK, buildMessage({ title: "T" }));
    expect(res.ok).toBe(false);
    const error = res.ok === false ? res.error : "";
    expect(error).toContain("500");
    expect(error).toContain("EEEE");
    expect(error.length).toBeLessThan(300);
  });

  it("returns ok:false without throwing on a network rejection", async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const res = await postToSlack(WEBHOOK, buildMessage({ title: "T" }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error.length).toBeGreaterThan(0);
  });

  it("returns ok:false without throwing on a timeout/abort", async () => {
    global.fetch = vi.fn(async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }) as unknown as typeof fetch;
    const res = await postToSlack(WEBHOOK, buildMessage({ title: "T" }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("タイムアウト");
  });

  it("never throws for hostile inputs", async () => {
    const cases: { label: string; url: string; setup: () => void }[] = [
      {
        label: "empty url",
        url: "",
        setup: () => mockFetch({ status: 200, body: "ok" }),
      },
      {
        label: "whitespace url",
        url: "   ",
        setup: () => mockFetch({ status: 200, body: "ok" }),
      },
      {
        label: "non-JSON response body",
        url: WEBHOOK,
        setup: () => mockFetch({ status: 200, body: "not json at all" }),
      },
      {
        label: "HTML error page",
        url: WEBHOOK,
        setup: () =>
          mockFetch({ status: 502, body: "<html><body>Bad Gateway</body></html>" }),
      },
      {
        label: "huge body",
        url: WEBHOOK,
        setup: () => mockFetch({ status: 500, body: "x".repeat(200_000) }),
      },
      {
        label: "empty body with 200",
        url: WEBHOOK,
        setup: () => mockFetch({ status: 200, body: "" }),
      },
      {
        label: "text() rejects",
        url: WEBHOOK,
        setup: () => {
          global.fetch = vi.fn(async () => ({
            ok: false,
            status: 500,
            text: async () => {
              throw new Error("stream closed");
            },
          })) as unknown as typeof fetch;
        },
      },
      {
        label: "fetch rejects with a non-Error",
        url: WEBHOOK,
        setup: () => {
          global.fetch = vi.fn(async () => {
            throw "boom";
          }) as unknown as typeof fetch;
        },
      },
      {
        label: "rate limited",
        url: WEBHOOK,
        setup: () => mockFetch({ status: 429, body: "rate_limited" }),
      },
      {
        label: "403 with token error",
        url: WEBHOOK,
        setup: () => mockFetch({ status: 403, body: "invalid_token" }),
      },
    ];

    for (const c of cases) {
      c.setup();
      const res = await postToSlack(
        c.url,
        buildMessage({ title: c.label, body: "あ".repeat(10_000) }),
      );
      expect(typeof res.ok, c.label).toBe("boolean");
      if (!res.ok) expect(res.error.length, c.label).toBeGreaterThan(0);
    }
  });
});

describe("buildMessage — フォールバック text のエスケープ", () => {
  /**
   * 回帰テスト: blocks 側だけエスケープしていたため、シート名やアラート名に
   * `<!channel>` と入れると text 経由でチャンネル全員をメンションできた。
   */
  it("<!channel> をタイトル・本文・フィールド・URL のどこに入れても素通ししない", () => {
    const msg = buildMessage({
      title: "<!channel> 緊急",
      body: "<!here> 至急確認",
      fields: [{ label: "<!everyone>", value: "<!channel>" }],
      url: "https://example.com/?x=<!channel>",
    });
    expect(msg.text).not.toContain("<!channel>");
    expect(msg.text).not.toContain("<!here>");
    expect(msg.text).not.toContain("<!everyone>");
    expect(msg.text).toContain("&lt;!channel&gt;");
    expect(JSON.stringify(msg.blocks)).not.toContain("<!channel>");
  });

  it("普通の日本語はそのまま読める", () => {
    const msg = buildMessage({
      title: "売上アラート",
      body: "今月の売上が目標を下回っています",
      fields: [{ label: "現在", value: "¥1,200,000" }],
    });
    expect(msg.text).toContain("売上アラート");
    expect(msg.text).toContain("¥1,200,000");
  });
});
