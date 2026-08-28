/**
 * 外部AIを叩く経路の線引き。
 *
 * ## なぜこのテストが要るのか
 *
 * ホームの「Excelを置く」は、**ファイルを置くたび毎回** `/api/import/analyze`
 * を通り、その先で Anthropic を叩いていた。この経路には回数制限もプラン判定も
 * 無く、既定モデルは最高単価。15MB まで詰めたファイルを1時間100回投げれば
 * 無料アカウント1つで ¥7,500 が積める——請求が来るまで誰も気づかない種類の穴。
 *
 * ここで固定したい契約は4つ。
 *
 * 1. **値付けとして Free に AI は含まれない**（`planIncludes` の側）。
 * 2. **閉じているときは通信そのものが起きない。** 「呼んでから捨てる」では
 *    課金も情報の流出も止まらないので、fetch の呼び出し回数で見る。
 * 3. **閉じても機能は無くならない。** 403 で断らず、決定的なヒューリスティックで
 *    最後まで通る。Free でも取り込めるし、ダッシュボードも作れる。
 * 4. **開いている側にも上限がある。** 1ワークスペース 1時間20回、21回目は 429。
 *    ただし**外部へ飛ぶときだけ数える**——お金が動いていない呼び出しまで
 *    数えると、止めているのは課金ではなく利用になってしまう。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as XLSX from "xlsx";
import { readAllSheets } from "@/lib/excel";
import {
  planIncludes,
  can,
  CAPABILITY_LABEL,
  PLANS,
  plansEnforced,
} from "@/lib/plans";

/* ----------------------------- 土台 ----------------------------- */

/**
 * 回数制限の置き場（DB）を、メモリ上の同じ振る舞いに差し替える。
 * ルート越しの検証と `consume` 単体の検証で**同じ1つの数え場**を共有させたい
 * ので、テスト全体で1つだけ持つ。
 */
const mocks = vi.hoisted(() => {
  type Row = {
    key: string;
    count: number;
    windowStart: Date;
    blockedUntil: Date | null;
  };
  const rows = new Map<string, Row>();
  return {
    rows,
    db: {
      rateLimit: {
        findUnique: async ({ where }: { where: { key: string } }) =>
          rows.get(where.key) ?? null,
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { key: string };
          create: Row;
          update: Partial<Row>;
        }) => {
          const cur = rows.get(where.key);
          rows.set(
            where.key,
            cur ? { ...cur, ...update } : { ...create, key: where.key },
          );
        },
        update: async ({
          where,
          data,
        }: {
          where: { key: string };
          data: Partial<Row>;
        }) => {
          const cur = rows.get(where.key);
          if (cur) rows.set(where.key, { ...cur, ...data });
        },
        deleteMany: async ({ where }: { where: { key: string } }) => {
          rows.delete(where.key);
          return { count: 1 };
        },
      },
      // 下見は「同名のファイルが既にあるか」を見るだけ。常に無しで良い。
      workbook: { findFirst: async () => null },
    },
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db, toJson: (v: unknown) => v }));

/**
 * next/server を読み込まずにルートを直接叩く（tests/records-api.test.ts と同じ手）。
 * ApiError は本物を使い、ルート側の instanceof 判定と一致させる。
 */
vi.mock("@/lib/api", async () => {
  const errors = await import("@/lib/errors");
  type Ctx = { user: unknown; params: Record<string, string> };
  type Handler = (req: unknown, ctx: Ctx) => Promise<unknown>;
  return {
    ApiError: errors.ApiError,
    ok: (data: unknown) => ({ ok: true, data }),
    fail: (error: string, status: number) => ({ ok: false, error, status }),
    withAuth: (handler: Handler) => async (req: unknown, ctx: Ctx) => {
      try {
        return await handler(req, ctx);
      } catch (err) {
        if (err instanceof errors.ApiError) {
          return { ok: false, error: err.message, status: err.status };
        }
        throw err;
      }
    },
  };
});

const {
  AI_RULE,
  consume,
  consumeOptional,
  workspaceKey,
  retryMessage,
} = await import("@/lib/rate-limit");

/** 3列の受注明細を1枚だけ持つ .xlsx を組み立てる。 */
function orderBytes(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["受注日", "取引先", "金額"],
    ["2026-04-01", "山田商事", 120000],
    ["2026-04-02", "高橋物流", 80000],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "受注明細");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

const ORDER_BYTES = orderBytes();
const ORDER_SHEETS = readAllSheets(
  ORDER_BYTES.buffer.slice(0) as ArrayBuffer,
);

/** ルートが実際に使うのは name / size / arrayBuffer の3つだけ。 */
function analyzeReq(bytes: Uint8Array) {
  const file = {
    name: "受注.xlsx",
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
  };
  return {
    formData: async () => ({
      get: (k: string) => (k === "file" ? file : null),
    }),
  };
}

type RouteResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; status: number };

function userOn(plan: string) {
  return {
    id: "u1",
    workspace: { id: "ws-ai", plan, aiEnabled: true },
  };
}

/**
 * Pro が買えるようになった世界（`plansEnforced: true`）でモジュールを読み直す。
 * plan-gates.test.ts と同じ手法。`can` を `planIncludes` に差し替えることで、
 * 「効かせたら何が起きるか」を今の設定のまま確かめられる。
 */
function enforcePlans(): void {
  vi.doMock("@/lib/plans", async () => {
    const actual =
      await vi.importActual<typeof import("@/lib/plans")>("@/lib/plans");
    return { ...actual, plansEnforced: true, can: actual.planIncludes };
  });
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  mocks.rows.clear();
  vi.resetModules();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.doUnmock("@/lib/plans");
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  vi.resetModules();
});

/* ----------------------------- 1. 値付け ----------------------------- */

describe("値付け: AI は有料側にある", () => {
  it("Free は aiAssist を含まない", () => {
    expect(planIncludes("free", "aiAssist")).toBe(false);
    expect(planIncludes(null, "aiAssist")).toBe(false);
    expect(planIncludes("enterprise-2030", "aiAssist")).toBe(false);
  });

  it("Pro と Business は含む", () => {
    expect(planIncludes("pro", "aiAssist")).toBe(true);
    expect(planIncludes("business", "aiAssist")).toBe(true);
    expect(PLANS.pro.capabilities).toContain("aiAssist");
  });

  it("断り文面に使う日本語の呼び名がある", () => {
    expect(CAPABILITY_LABEL.aiAssist).toBeTruthy();
    expect(CAPABILITY_LABEL.aiAssist).toContain("AI");
  });

  it("いまは効かせていないので、Free でも使える（行き止まりを作らない）", () => {
    // 他の5機能と同じ扱い。効かせ始めるのは Pro が買えるようになった瞬間。
    expect(plansEnforced).toBe(false);
    expect(can("free", "aiAssist")).toBe(true);
    // それでも値付けの側は閉じたまま。can と planIncludes が同じものに
    // なっていたら、この2つは両立しない。
    expect(planIncludes("free", "aiAssist")).toBe(false);
  });
});

/* -------------------- 2. 効かせたときに通信が起きない -------------------- */

describe("効かせたとき: Free は外部へ1回も投げない", () => {
  async function enforced() {
    // キーが刺さっている＝「呼べる状態」を作る。ここで通信が起きないことに
    // 意味がある（キーが無いから呼ばなかった、では何も確かめていない）。
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    enforcePlans();
    return {
      ai: await import("@/lib/ai"),
      advisor: await import("@/lib/import-advisor"),
    };
  }

  it("プランと設定の両方を満たしたときだけ許す", async () => {
    const { ai } = await enforced();
    expect(ai.aiAllowedFor("free", true)).toBe(false);
    expect(ai.aiAllowedFor("pro", true)).toBe(true);
    expect(ai.aiAllowedFor("business", true)).toBe(true);
    // ワークスペースの「中身を外に出さない」設定は、プランより強い。
    expect(ai.aiAllowedFor("pro", false)).toBe(false);
  });

  it("Free の下見は fetch を呼ばず、提案はちゃんと返る", async () => {
    const { ai, advisor } = await enforced();
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    const res = await advisor.adviseImport(ORDER_SHEETS, {
      aiEnabled: ai.aiAllowedFor("free", true),
    });

    expect(spy).not.toHaveBeenCalled();
    expect(res.via).toBe("heuristic");
    // 閉じても機能は消えない。3列ぶんの提案が出て、取り込みは進める。
    expect(res.advice.columns["受注明細"]).toHaveLength(3);
    expect(res.advice.sheets[0].include).toBe(true);
  });

  it("Pro は同じ条件で外部へ投げる（上のテストが素通しでないことの担保）", async () => {
    const { ai, advisor } = await enforced();
    const spy = vi.fn(async () => new Response("boom", { status: 500 }));
    globalThis.fetch = spy as unknown as typeof fetch;

    const res = await advisor.adviseImport(ORDER_SHEETS, {
      aiEnabled: ai.aiAllowedFor("pro", true),
    });

    expect(spy).toHaveBeenCalledTimes(1);
    // 落ちてもヒューリスティックに戻るだけ。取り込みは止まらない。
    expect(res.via).toBe("heuristic");
  });

  it("Free のダッシュボード生成も fetch を呼ばず、テンプレートから作る", async () => {
    const { ai } = await enforced();
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    const res = await ai.generateDashboardTemplate(
      { description: "売上と受注のダッシュボード" },
      { aiEnabled: ai.aiAllowedFor("free", true) },
    );

    expect(spy).not.toHaveBeenCalled();
    expect(res.via).toBe("heuristic");
    expect(res.template.key.startsWith("ai-")).toBe(true);
    expect(res.template.collections.length).toBeGreaterThan(0);
  });

  it("外部へ飛ぶかどうかの判定が、プランとキーの両方を見ている", async () => {
    const { ai, advisor } = await enforced();
    expect(advisor.advisorCallsOut(ai.aiAllowedFor("free", true))).toBe(false);
    expect(advisor.advisorCallsOut(ai.aiAllowedFor("pro", true))).toBe(true);
    expect(ai.generationCallsOut(ai.aiAllowedFor("free", true))).toBe(false);
    expect(ai.generationCallsOut(ai.aiAllowedFor("pro", true))).toBe(true);
  });
});

/* ----------------------------- 3. 回数制限 ----------------------------- */

describe("回数制限: 1ワークスペース 1時間20回", () => {
  it("鍵はIPではなくワークスペースで作る", () => {
    expect(workspaceKey("ws-1", "ai")).toBe("ai:ws:ws-1");
    // 特定できないときは数えない（"unknown" に全社が集まる事故を作らない）。
    expect(workspaceKey(null, "ai")).toBeNull();
    expect(workspaceKey("   ", "ai")).toBeNull();
  });

  it("20回までは通し、21回目で止めて解除時刻を返す", async () => {
    const key = workspaceKey("ws-1", "ai")!;
    const now = new Date("2026-08-28T09:00:00Z");

    expect(AI_RULE.max).toBe(20);
    expect(AI_RULE.windowMs).toBe(60 * 60_000);

    for (let i = 1; i <= AI_RULE.max; i++) {
      const res = await consume(key, AI_RULE, now);
      expect(res.allowed, `${i}回目`).toBe(true);
    }

    const over = await consume(key, AI_RULE, now);
    expect(over.allowed).toBe(false);
    expect(over.retryAt!.getTime()).toBe(now.getTime() + AI_RULE.blockMs);
    expect(retryMessage(over.retryAt, now)).toContain("分後");
  });

  it("窓が明ければまた通る（永久に締め出さない）", async () => {
    const key = workspaceKey("ws-2", "ai")!;
    const now = new Date("2026-08-28T09:00:00Z");
    for (let i = 0; i <= AI_RULE.max; i++) await consume(key, AI_RULE, now);

    const later = new Date(now.getTime() + AI_RULE.blockMs + 1000);
    expect((await consume(key, AI_RULE, later)).allowed).toBe(true);
  });

  it("ワークスペースが違えば別枠（隣の会社の使い方で止まらない）", async () => {
    const now = new Date("2026-08-28T09:00:00Z");
    const a = workspaceKey("ws-a", "ai")!;
    for (let i = 0; i <= AI_RULE.max; i++) await consume(a, AI_RULE, now);
    expect((await consume(a, AI_RULE, now)).allowed).toBe(false);

    const b = workspaceKey("ws-b", "ai")!;
    expect((await consumeOptional(b, AI_RULE, now)).allowed).toBe(true);
  });
});

/* ------------------- 4. ルート越し: 21回目が 429 になる ------------------- */

describe("/api/import/analyze の回数制限", () => {
  async function loadRoute() {
    const mod = await import("@/app/api/import/analyze/route");
    return mod.POST as unknown as (
      req: unknown,
      ctx: { user: unknown; params: Record<string, string> },
    ) => Promise<RouteResult>;
  }

  it("AIを叩く経路は、21回目で 429 と日本語の待ち時間を返す", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    // 外部は落ちている扱い。数えているのは「叩こうとした回数」なので、
    // 応答の中身はここでは関係ない。
    globalThis.fetch = (async () =>
      new Response("boom", { status: 500 })) as unknown as typeof fetch;

    const POST = await loadRoute();
    const ctx = { user: userOn("pro"), params: {} };

    for (let i = 1; i <= AI_RULE.max; i++) {
      const res = await POST(analyzeReq(ORDER_BYTES), ctx);
      expect(res.ok, `${i}回目`).toBe(true);
    }

    const over = await POST(analyzeReq(ORDER_BYTES), ctx);
    expect(over.ok).toBe(false);
    const failed = over as { ok: false; error: string; status: number };
    expect(failed.status).toBe(429);
    expect(failed.error).toContain("上限");
    expect(failed.error).toContain("分後");
  });

  it("AIを叩かない経路は数えない（Free の取り込みは何回でも通る）", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    enforcePlans();
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    const POST = await loadRoute();
    const ctx = { user: userOn("free"), params: {} };

    // 上限の倍を投げても止まらない。止めたいのは課金であって取り込みではない。
    for (let i = 1; i <= AI_RULE.max * 2; i++) {
      const res = await POST(analyzeReq(ORDER_BYTES), ctx);
      expect(res.ok, `${i}回目`).toBe(true);
      expect((res as { ok: true; data: { via: string } }).data.via).toBe(
        "heuristic",
      );
    }
    expect(spy).not.toHaveBeenCalled();
    expect(mocks.rows.size).toBe(0);
  });

  it("キーが無い自己ホストでも数えない（お金が動かないので）", async () => {
    const POST = await loadRoute();
    const ctx = { user: userOn("pro"), params: {} };
    for (let i = 1; i <= AI_RULE.max + 5; i++) {
      expect((await POST(analyzeReq(ORDER_BYTES), ctx)).ok, `${i}回目`).toBe(
        true,
      );
    }
    expect(mocks.rows.size).toBe(0);
  });
});

/* --------------------------- 5. 既定のモデル --------------------------- */

describe("既定のモデル", () => {
  it("最高単価のモデルを既定にしない", async () => {
    const { env } = await import("@/lib/env");
    // 列名の判定と、近いテンプレート選びに opus は要らない。
    expect(env.ANTHROPIC_MODEL).not.toContain("opus");
    expect(env.ANTHROPIC_MODEL).toBe("claude-haiku-4-5");
  });

  it("運用者は環境変数で上書きできる", async () => {
    process.env.ANTHROPIC_MODEL = "claude-sonnet-4-5";
    vi.resetModules();
    const { env } = await import("@/lib/env");
    expect(env.ANTHROPIC_MODEL).toBe("claude-sonnet-4-5");
    delete process.env.ANTHROPIC_MODEL;
  });
});
