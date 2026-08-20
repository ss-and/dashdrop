/**
 * データの削除。
 *
 * 利用者の指摘:「ダッシュボードは消せるけど、データも消せるようにしてほしい」。
 *
 * 消すこと自体より、**消した後に何が壊れるかを先に言えること**が要点になる。
 * スプレッドシートを消すと、それを見ていたダッシュボードは中身が空になり、
 * 通知ルールは存在しないシートを見張り続ける。どちらもエラーにならないので、
 * 黙って消すと後から原因を辿れない。ここで固定するのは3つ。
 *
 *  1. 消える行数と、空になるダッシュボードを、消す前に数えられること。
 *  2. 通知ルールを一緒に片付けること（外部キーでは消えない）。
 *  3. ファイルを消すときは、**シートを先に**消すこと。逆にすると
 *     Collection.workbookId が SetNull なので、親の無いシートが一覧に残る。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    record: { count: vi.fn() },
    dashboard: { findMany: vi.fn(), deleteMany: vi.fn() },
    alertRule: { findMany: vi.fn(), deleteMany: vi.fn() },
    collection: { deleteMany: vi.fn(), findFirst: vi.fn() },
    workbook: { findFirst: vi.fn(), delete: vi.fn() },
    activity: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  logActivity: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db, toJson: (v: unknown) => v }));

const { collectDeleteImpact, deleteCollections } = await import("@/lib/data-delete");

beforeEach(() => {
  for (const group of Object.values(mocks.db)) {
    if (typeof group === "function") {
      (group as ReturnType<typeof vi.fn>).mockReset();
      continue;
    }
    for (const fn of Object.values(group)) (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  mocks.db.record.count.mockResolvedValue(0);
  mocks.db.dashboard.findMany.mockResolvedValue([]);
  mocks.db.alertRule.findMany.mockResolvedValue([]);
  mocks.db.$transaction.mockResolvedValue([]);
});

describe("消す前に、巻き添えを数える", () => {
  it("そのシートを見ているダッシュボードを名指しで返す", async () => {
    mocks.db.record.count.mockResolvedValue(120);
    mocks.db.dashboard.findMany.mockResolvedValue([
      { name: "受注データ ダッシュボード", collectionSlugs: ["juchu", "getsuji"] },
      { name: "別のダッシュボード", collectionSlugs: ["kokyaku"] },
      // 壊れた保存値。落ちずに無視できること。
      { name: "壊れたもの", collectionSlugs: null },
    ]);

    const impact = await collectDeleteImpact("ws-1", ["col-1"], ["juchu"]);

    expect(impact.recordCount).toBe(120);
    expect(impact.affectedDashboards).toEqual(["受注データ ダッシュボード"]);
  });

  it("一緒に消える通知ルールを返す", async () => {
    mocks.db.alertRule.findMany.mockResolvedValue([{ name: "未対応が10件超え" }]);
    const impact = await collectDeleteImpact("ws-1", ["col-1"], ["juchu"]);
    expect(impact.affectedAlerts).toEqual(["未対応が10件超え"]);
  });

  it("対象が空なら、行も通知ルールも数えに行かない", async () => {
    const impact = await collectDeleteImpact("ws-1", [], []);
    expect(impact.recordCount).toBe(0);
    expect(mocks.db.record.count).not.toHaveBeenCalled();
    expect(mocks.db.alertRule.findMany).not.toHaveBeenCalled();
  });
});

describe("シートを消す", () => {
  it("通知ルールを同じトランザクションで片付ける", async () => {
    // 外部キーでは消えないので、ここで消さないと存在しないシートを
    // 見張り続ける壊れたルールが残る。
    await deleteCollections("ws-1", ["col-1", "col-2"]);

    const ops = mocks.db.$transaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(2);
    expect(mocks.db.alertRule.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", collectionId: { in: ["col-1", "col-2"] } },
    });
    expect(mocks.db.collection.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", id: { in: ["col-1", "col-2"] } },
    });
  });

  it("対象が無ければ何もしない", async () => {
    await deleteCollections("ws-1", []);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});

describe("ファイルを消す — DELETE /api/workbooks/[id]", () => {
  async function route() {
    vi.doMock("@/lib/api", async () => {
      const { ApiError } = await import("@/lib/errors");
      return {
        ApiError,
        ok: (data: unknown) => ({ ok: true, data }),
        withAuth:
          (h: (req: unknown, ctx: unknown) => unknown) =>
          (req: unknown, ctx: unknown) =>
            h(req, ctx),
      };
    });
    vi.doMock("@/lib/workspace", () => ({ logActivity: mocks.logActivity }));
    const mod = await import("@/app/api/workbooks/[id]/route");
    return mod.DELETE as unknown as (
      req: unknown,
      ctx: { user: { workspace: { id: string } }; params: { id: string } },
    ) => Promise<{ ok: boolean; data: Record<string, unknown> }>;
  }

  const ctx = { user: { workspace: { id: "ws-1" } }, params: { id: "wb-1" } };
  /** ルートは ?dashboards=delete を読むので、URL を持つ最小の req を渡す。 */
  const req = (query = "") => ({ url: `http://x/api/workbooks/wb-1${query}` });

  beforeEach(() => {
    vi.resetModules();
    mocks.logActivity.mockReset();
    mocks.logActivity.mockResolvedValue(undefined);
    mocks.db.workbook.findFirst.mockResolvedValue({
      id: "wb-1",
      name: "受注データ",
      collections: [
        { id: "col-1", name: "受注一覧", slug: "juchu" },
        { id: "col-2", name: "月次サマリー", slug: "getsuji" },
      ],
    });
    mocks.db.workbook.delete.mockResolvedValue({});
  });

  it("シートを先に消してから、ファイルを消す", async () => {
    /*
     * 逆順にすると Collection.workbookId が SetNull になり、親の無いシートが
     * 一覧に残る——利用者から見れば「消したのに残っている」。
     */
    const order: string[] = [];
    mocks.db.$transaction.mockImplementation(async () => {
      order.push("collections");
      return [];
    });
    mocks.db.workbook.delete.mockImplementation(async () => {
      order.push("workbook");
      return {};
    });

    const handler = await route();
    const res = await handler(req(), ctx);

    expect(res.ok).toBe(true);
    expect(order).toEqual(["collections", "workbook"]);
  });

  it("何をどれだけ消したかを返す", async () => {
    mocks.db.record.count.mockResolvedValue(72);
    mocks.db.dashboard.findMany.mockResolvedValue([
      { name: "受注データ ダッシュボード", collectionSlugs: ["juchu"] },
    ]);

    const handler = await route();
    const res = await handler(req(), ctx);

    expect(res.data).toMatchObject({
      deleted: "受注データ",
      sheets: 2,
      rows: 72,
      affectedDashboards: ["受注データ ダッシュボード"],
    });
  });

  it("消した記録を残す", async () => {
    // 「無くなっている」に気づいたとき、誰がいつ消したのかを辿れる場所が
    // ここしか無い。
    const handler = await route();
    await handler(req(), ctx);
    expect(mocks.logActivity).toHaveBeenCalledWith(
      "ws-1",
      "collection.deleted",
      expect.objectContaining({ name: "受注データ" }),
    );
  });

  it("他のワークスペースのファイルは404で止める", async () => {
    mocks.db.workbook.findFirst.mockResolvedValue(null);
    const handler = await route();
    await expect(handler(req(), ctx)).rejects.toThrow(/見つかりません/);
    expect(mocks.db.workbook.delete).not.toHaveBeenCalled();
  });
});

describe("見るものが無くなるダッシュボード", () => {
  it("データ元が全部消えるものだけを、片付け候補にする", async () => {
    // 他のシートも見ているダッシュボードは、欠けるだけで用は足りる。
    mocks.db.dashboard.findMany.mockResolvedValue([
      { id: "d1", name: "受注だけ", collectionSlugs: ["juchu"], shareToken: null },
      {
        id: "d2",
        name: "受注と顧客",
        collectionSlugs: ["juchu", "kokyaku"],
        shareToken: null,
      },
    ]);

    const impact = await collectDeleteImpact("ws-1", ["col-1"], ["juchu"]);

    expect(impact.affectedDashboards).toEqual(["受注だけ", "受注と顧客"]);
    expect(impact.emptiedDashboards).toEqual([{ id: "d1", name: "受注だけ" }]);
  });

  it("共有リンクを配ってあるものは候補にしない", async () => {
    // こちらの都合で、外の人が見ているページを消してよい理由にはならない。
    mocks.db.dashboard.findMany.mockResolvedValue([
      { id: "d1", name: "共有中", collectionSlugs: ["juchu"], shareToken: "tok" },
    ]);
    const impact = await collectDeleteImpact("ws-1", ["col-1"], ["juchu"]);
    expect(impact.affectedDashboards).toEqual(["共有中"]);
    expect(impact.emptiedDashboards).toEqual([]);
  });

  it("選ばれたときだけ消す（既定では消さない）", async () => {
    vi.resetModules();
    mocks.db.workbook.findFirst.mockResolvedValue({
      id: "wb-1",
      name: "受注データ",
      collections: [{ id: "col-1", name: "受注一覧", slug: "juchu" }],
    });
    mocks.db.workbook.delete.mockResolvedValue({});
    mocks.db.dashboard.findMany.mockResolvedValue([
      { id: "d1", name: "受注だけ", collectionSlugs: ["juchu"], shareToken: null },
    ]);
    mocks.db.dashboard.deleteMany.mockResolvedValue({ count: 1 });

    vi.doMock("@/lib/api", async () => {
      const { ApiError } = await import("@/lib/errors");
      return {
        ApiError,
        ok: (data: unknown) => ({ ok: true, data }),
        withAuth:
          (h: (req: unknown, ctx: unknown) => unknown) =>
          (req: unknown, ctx: unknown) =>
            h(req, ctx),
      };
    });
    vi.doMock("@/lib/workspace", () => ({ logActivity: mocks.logActivity }));
    const mod = await import("@/app/api/workbooks/[id]/route");
    const handler = mod.DELETE as unknown as (
      req: unknown,
      ctx: unknown,
    ) => Promise<{ data: Record<string, unknown> }>;
    const ctx = { user: { workspace: { id: "ws-1" } }, params: { id: "wb-1" } };

    const plain = await handler({ url: "http://x/api/workbooks/wb-1" }, ctx);
    expect(plain.data.removedDashboards).toBe(0);
    expect(mocks.db.dashboard.deleteMany).not.toHaveBeenCalled();

    const asked = await handler(
      { url: "http://x/api/workbooks/wb-1?dashboards=delete" },
      ctx,
    );
    expect(asked.data.removedDashboards).toBe(1);
    expect(mocks.db.dashboard.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", id: { in: ["d1"] } },
    });
  });
});
