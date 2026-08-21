/**
 * 配色テーマが、選んだとおりに保存されるか。
 *
 * 【なぜこのテストがあるか】
 * 「作成」の API はスキーマで `theme` を受け付けていたのに、ハンドラが項目を
 * 1つずつ書き写していて、そこへ足すのを忘れていた。**400 にもならず静かに
 * 標準の配色で保存される**ので、ビルダーで色を選んだ人には「選べるのに
 * 効かない」としか見えない。しかも保存自体は成功するので、エラーを探しても
 * 何も出てこない。ブラウザで作って色を見るまで気づけなかった。
 *
 * 検証の順序も大事で、`createCustomDashboard` を直接呼ぶだけでは見つからない
 * （そちらは最初から正しかった）。落ちていたのは**ルートから lib への受け渡し**
 * なので、ルートを通して確かめる。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    collection: { findMany: vi.fn() },
    dashboard: { create: vi.fn(), count: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
  logActivity: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db, toJson: (v: unknown) => v }));
vi.mock("@/lib/workspace", () => ({
  logActivity: mocks.logActivity,
  assertCanCreateCollection: vi.fn(),
  // プランの判定は本物を通さない。ここで確かめたいのは取り込みの中身。
  assertCanCreateWorkbook: vi.fn(),
  assertCapability: vi.fn(),
}));

const user = {
  id: "u-1",
  email: "a@example.com",
  name: "テスト",
  emailVerified: true,
  workspace: { id: "ws-1", name: "WS", slug: "ws", plan: "business", role: "owner", aiEnabled: true },
};

/** 認証を通してハンドラ本体だけを試す。 */
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    withAuth:
      (handler: (req: Request, ctx: { user: typeof user; params: Record<string, string> }) => unknown) =>
      (req: Request, ctx?: { params?: Record<string, string> }) =>
        handler(req, { user, params: ctx?.params ?? {} }),
  };
});

const { POST } = await import("@/app/api/dashboards/route");
const { PATCH } = await import("@/app/api/dashboards/[id]/route");

const LAYOUT = [
  {
    id: "w1",
    type: "kpi",
    title: "件数",
    collection: "sales",
    span: 1,
    measure: { kind: "count" },
  },
];

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://x/api/dashboards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    undefined as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.collection.findMany.mockResolvedValue([{ slug: "sales" }]);
  mocks.db.dashboard.count.mockResolvedValue(0);
  mocks.db.dashboard.create.mockResolvedValue({ id: "d-1" });
  mocks.db.dashboard.findFirst.mockResolvedValue({
    id: "d-1",
    workspaceId: "ws-1",
    collectionSlugs: ["sales"],
    layout: LAYOUT,
  });
  mocks.db.dashboard.update.mockResolvedValue({ id: "d-1" });
});

const created = () => mocks.db.dashboard.create.mock.calls[0][0].data;
const updated = () => mocks.db.dashboard.update.mock.calls[0][0].data;

describe("作成時の配色", () => {
  it("選んだテーマがそのまま保存される", async () => {
    await post({
      name: "売上",
      theme: "ocean",
      collectionSlugs: ["sales"],
      layout: LAYOUT,
    });
    expect(created().theme).toBe("ocean");
  });

  it("指定しなければ標準", async () => {
    await post({ name: "売上", collectionSlugs: ["sales"], layout: LAYOUT });
    expect(created().theme).toBe("standard");
  });

  it("消したテーマを指していても、保存は通って標準に落ちる", async () => {
    // 保存そのものを失敗させない。配色は本題ではないので、ここで止めるのは過剰。
    await post({
      name: "売上",
      theme: "むかしのテーマ",
      collectionSlugs: ["sales"],
      layout: LAYOUT,
    });
    expect(created().theme).toBe("standard");
  });
});

describe("編集時の配色", () => {
  const patch = (body: Record<string, unknown>) =>
    PATCH(
      new Request("http://x/api/dashboards/d-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: { id: "d-1" } } as never,
    );

  it("あとから配色だけを変えられる", async () => {
    await patch({ theme: "mono" });
    expect(updated().theme).toBe("mono");
    // 配色だけを送ったのに、レイアウトが空で上書きされたりしないこと。
    expect(updated().layout).toBeUndefined();
  });

  it("配色を送らなければ、今の配色に触らない", async () => {
    await patch({ name: "新しい名前" });
    expect(updated()).not.toHaveProperty("theme");
  });
});

describe("ウィジェットの上限", () => {
  it("48枚まで保存できる（自動作成が25枚を超えても編集できる）", async () => {
    const many = Array.from({ length: 48 }, (_, i) => ({
      ...LAYOUT[0],
      id: `w${i}`,
      title: `件数${i}`,
    }));
    const res = (await post({
      name: "多い",
      collectionSlugs: ["sales"],
      layout: many,
    })) as Response;
    expect(res.status).toBe(200);
    expect(created().layout).toHaveLength(48);
  });
});
