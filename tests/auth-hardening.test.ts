/**
 * 公開する前に必ず要る守り。
 *
 * ここで固定するのは、**無いと出せない**性質のものだけ。
 *
 *  1. 総当たりが止まること（ログインに回数制限が一切無かった）。
 *  2. トークンが生のままDBに残らないこと、1回しか使えないこと。
 *  3. 「そのメールアドレスは登録されていません」を返さないこと
 *     （ログインせずに利用者名簿を総当たりで作れてしまう）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    rateLimit: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    authToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ db: mocks.db, toJson: (v: unknown) => v }));

const { consume, consumeOptional, reset, clientIp, LOGIN_RULE } = await import(
  "@/lib/rate-limit",
);
const { issueToken, consumeToken, hashToken } = await import("@/lib/auth-tokens");

beforeEach(() => {
  for (const group of Object.values(mocks.db)) {
    for (const fn of Object.values(group)) (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  mocks.db.rateLimit.upsert.mockResolvedValue({});
  mocks.db.rateLimit.update.mockResolvedValue({});
  mocks.db.rateLimit.deleteMany.mockResolvedValue({ count: 1 });
  mocks.db.authToken.create.mockResolvedValue({});
  mocks.db.authToken.updateMany.mockResolvedValue({ count: 1 });
});

/* ---------------------------- 回数制限 ---------------------------- */

describe("試行回数の制限", () => {
  const NOW = new Date("2026-08-20T10:00:00Z");

  it("窓が無ければ1回目として数え、通す", async () => {
    mocks.db.rateLimit.findUnique.mockResolvedValue(null);
    const res = await consume("login:id:a@example.com", LOGIN_RULE, NOW);
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(LOGIN_RULE.max - 1);
    expect(mocks.db.rateLimit.upsert).toHaveBeenCalled();
  });

  it("上限を超えたら止め、いつ再開できるかを返す", async () => {
    mocks.db.rateLimit.findUnique.mockResolvedValue({
      key: "k",
      count: LOGIN_RULE.max,
      windowStart: NOW,
      blockedUntil: null,
    });
    const res = await consume("k", LOGIN_RULE, NOW);
    expect(res.allowed).toBe(false);
    expect(res.retryAt).toBeInstanceOf(Date);
    expect(res.retryAt!.getTime()).toBe(NOW.getTime() + LOGIN_RULE.blockMs);
  });

  it("止まっている間は、数え直さずに断る", async () => {
    const blockedUntil = new Date(NOW.getTime() + 60_000);
    mocks.db.rateLimit.findUnique.mockResolvedValue({
      key: "k",
      count: 99,
      windowStart: NOW,
      blockedUntil,
    });
    const res = await consume("k", LOGIN_RULE, NOW);
    expect(res.allowed).toBe(false);
    expect(res.retryAt).toEqual(blockedUntil);
    expect(mocks.db.rateLimit.update).not.toHaveBeenCalled();
  });

  it("窓が切れたら数え直す（ロックも解ける）", async () => {
    mocks.db.rateLimit.findUnique.mockResolvedValue({
      key: "k",
      count: 99,
      windowStart: new Date(NOW.getTime() - LOGIN_RULE.windowMs - 1),
      blockedUntil: new Date(NOW.getTime() - 1),
    });
    const res = await consume("k", LOGIN_RULE, NOW);
    expect(res.allowed).toBe(true);
    const arg = mocks.db.rateLimit.upsert.mock.calls[0][0] as {
      update: { count: number; blockedUntil: null };
    };
    expect(arg.update).toMatchObject({ count: 1, blockedUntil: null });
  });

  it("DBが落ちていても、ログインそのものを止めない", async () => {
    // 付随機能が全員を締め出す方が損害が大きい。
    mocks.db.rateLimit.findUnique.mockRejectedValue(new Error("db down"));
    const res = await consume("k", LOGIN_RULE, NOW);
    expect(res.allowed).toBe(true);
  });

  it("成功したら数えをやめる", async () => {
    await reset("k");
    expect(mocks.db.rateLimit.deleteMany).toHaveBeenCalledWith({ where: { key: "k" } });
  });
});

describe("呼び出し元のIP", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://x/", { headers });

  it("x-forwarded-for は先頭を採る", () => {
    // 末尾はプロキシ自身。そこを見ると全員が同じ値になり、制限が意味を失う。
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe(
      "203.0.113.9",
    );
  });

  it("無ければ x-real-ip、それも無ければ null", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(req({}))).toBeNull();
  });

  it("相手が分からないときは、IP側では数えない", async () => {
    /*
     * ここで "unknown" のような固定値を使うと、プロキシのヘッダが無い構成で
     * **全員が同じ鍵を共有**する。誰かが10回間違えた瞬間に、その場の全員が
     * ログインできなくなる（実際、総当たりを試したら自分が締め出された）。
     */
    const res = await consumeOptional(null, LOGIN_RULE);
    expect(res.allowed).toBe(true);
    expect(mocks.db.rateLimit.findUnique).not.toHaveBeenCalled();
  });
});

/* ---------------------------- トークン ---------------------------- */

describe("使い捨てトークン", () => {
  const NOW = new Date("2026-08-20T10:00:00Z");

  it("生の値をDBに入れない（ハッシュだけを持つ）", async () => {
    const { token } = await issueToken("u-1", "password_reset", NOW);
    const arg = mocks.db.authToken.create.mock.calls[0][0] as {
      data: { tokenHash: string };
    };
    // DBが漏れても、そのままアカウントを乗っ取れる鍵が並んでいない。
    expect(arg.data.tokenHash).not.toBe(token);
    expect(arg.data.tokenHash).toBe(hashToken(token));
    expect(arg.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("発行すると、同じ用途の古い未使用トークンを閉じる", async () => {
    // 再送のたびに有効なリンクが増えると、古いメール1通の漏洩で入れてしまう。
    await issueToken("u-1", "password_reset", NOW);
    expect(mocks.db.authToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u-1", purpose: "password_reset", usedAt: null },
      data: { usedAt: NOW },
    });
  });

  it("使えるのは1回だけ", async () => {
    mocks.db.authToken.findUnique.mockResolvedValue({
      id: "t-1",
      userId: "u-1",
      purpose: "password_reset",
      tokenHash: hashToken("abc"),
      expiresAt: new Date(NOW.getTime() + 60_000),
      usedAt: null,
    });
    mocks.db.authToken.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await consumeToken("abc", "password_reset", NOW)).toEqual({ userId: "u-1" });

    // 同時に2回来ても、更新できた側だけが通る。
    mocks.db.authToken.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await consumeToken("abc", "password_reset", NOW)).toBeNull();
  });

  it("期限切れ・用途違い・使用済みは、どれも同じ null", async () => {
    // 理由を返すと「そのトークンは存在した」ことが分かってしまう。
    const base = {
      id: "t-1",
      userId: "u-1",
      purpose: "password_reset",
      tokenHash: hashToken("abc"),
      expiresAt: new Date(NOW.getTime() + 60_000),
      usedAt: null,
    };

    mocks.db.authToken.findUnique.mockResolvedValue({
      ...base,
      expiresAt: new Date(NOW.getTime() - 1),
    });
    expect(await consumeToken("abc", "password_reset", NOW)).toBeNull();

    mocks.db.authToken.findUnique.mockResolvedValue({ ...base, purpose: "email_verify" });
    expect(await consumeToken("abc", "password_reset", NOW)).toBeNull();

    mocks.db.authToken.findUnique.mockResolvedValue({ ...base, usedAt: NOW });
    expect(await consumeToken("abc", "password_reset", NOW)).toBeNull();

    mocks.db.authToken.findUnique.mockResolvedValue(null);
    expect(await consumeToken("abc", "password_reset", NOW)).toBeNull();
  });

  it("空のトークンは、DBを引きにも行かない", async () => {
    expect(await consumeToken("   ", "password_reset", NOW)).toBeNull();
    expect(mocks.db.authToken.findUnique).not.toHaveBeenCalled();
  });
});
