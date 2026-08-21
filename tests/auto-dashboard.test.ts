/**
 * 自動ダッシュボードの重複対策。
 *
 * 利用者の指摘:「ダッシュボード重複しているやつとかわかりづらくなるね、
 * 同じExcel名なら上書きとかが良さそうだよ」。
 *
 * 同じファイルを入れ直すたびに「◯◯ ダッシュボード」が増えると、サイドバーに
 * まったく同じ名前が並ぶ。名前で区別できない以上、利用者はどれが最新かを
 * 選べない——増やさないことが答えになる。
 *
 * ここで固定したいのは3つ。
 *  1. 同名の自動ダッシュボードがあれば、新しく作らずに中身を差し替える（URL維持）。
 *  2. 過去に増えてしまった同名の重複は、まとめて1本にする。
 *  3. ただし共有リンクを配ってあるものは消さない。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    workbook: { findFirst: vi.fn() },
    collection: { findFirst: vi.fn(), findMany: vi.fn() },
    record: { findMany: vi.fn() },
    dashboard: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
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

const { createAutoDashboard } = await import("@/lib/apply-template");

const AUTO_DESCRIPTION = "取り込んだデータから自動作成しました。";

const user = {
  id: "u-1",
  email: "a@example.com",
  name: "テスト",
  workspace: { id: "ws-1", name: "WS", slug: "ws", plan: "business", role: "owner" },
} as unknown as Parameters<typeof createAutoDashboard>[0];

const FIELDS = [
  { key: "torihikisaki", name: "取引先", type: "text" },
  { key: "kingaku", name: "金額", type: "number" },
  { key: "hizuke", name: "日付", type: "date" },
];

const ROWS = Array.from({ length: 6 }, (_, i) => ({
  torihikisaki: ["山田商事", "鈴木工業"][i % 2],
  kingaku: (i + 1) * 100000,
  hizuke: `2026-0${(i % 3) + 1}-10`,
}));

beforeEach(() => {
  for (const group of Object.values(mocks.db)) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
  mocks.logActivity.mockReset();
  mocks.logActivity.mockResolvedValue(undefined);

  mocks.db.workbook.findFirst.mockResolvedValue({
    id: "wb-1",
    name: "受注データ",
    collections: [
      { slug: "juchu", name: "受注一覧", fields: FIELDS },
    ],
  });
  mocks.db.collection.findFirst.mockResolvedValue({ id: "col-1" });
  mocks.db.record.findMany.mockResolvedValue(ROWS.map((data) => ({ data })));
  mocks.db.collection.findMany.mockResolvedValue([{ slug: "juchu" }]);
  mocks.db.dashboard.findMany.mockResolvedValue([]);
  mocks.db.dashboard.create.mockResolvedValue({ id: "dash-new" });
  mocks.db.dashboard.count.mockResolvedValue(0);
  mocks.db.dashboard.deleteMany.mockResolvedValue({ count: 0 });
  mocks.db.dashboard.update.mockResolvedValue({});
});

describe("createAutoDashboard", () => {
  it("初回は新しく作る", async () => {
    const res = await createAutoDashboard(user, { workbookId: "wb-1" });

    expect(res.dashboardId).toBe("dash-new");
    expect(res.replaced).toBe(false);
    expect(mocks.db.dashboard.create).toHaveBeenCalled();
  });

  it("同じ名前の自動ダッシュボードがあれば、作らずに中身を差し替える", async () => {
    mocks.db.dashboard.findMany.mockResolvedValue([
      { id: "dash-old", shareToken: null },
    ]);
    mocks.db.dashboard.findFirst.mockResolvedValue({
      id: "dash-old",
      workspaceId: "ws-1",
      collectionSlugs: ["juchu"],
    });

    const res = await createAutoDashboard(user, { workbookId: "wb-1" });

    // URL が変わらないことが肝。ブックマークも共有リンクもそのまま生きる。
    expect(res.dashboardId).toBe("dash-old");
    expect(res.replaced).toBe(true);
    expect(mocks.db.dashboard.create).not.toHaveBeenCalled();
    expect(mocks.db.dashboard.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "dash-old" } }),
    );
  });

  it("過去に増えた同名の重複は1本にまとめる", async () => {
    mocks.db.dashboard.findMany.mockResolvedValue([
      { id: "dash-1", shareToken: null },
      { id: "dash-2", shareToken: null },
      { id: "dash-3", shareToken: null },
    ]);
    mocks.db.dashboard.findFirst.mockResolvedValue({
      id: "dash-1",
      workspaceId: "ws-1",
      collectionSlugs: ["juchu"],
    });

    const res = await createAutoDashboard(user, { workbookId: "wb-1" });

    expect(res.dashboardId).toBe("dash-1"); // いちばん古いものを残す
    expect(res.merged).toBe(2);
    expect(mocks.db.dashboard.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["dash-2", "dash-3"] } },
    });
  });

  it("共有リンクを配ってあるものは消さない", async () => {
    // こちらの都合で、外の人が見ているページを消してよい理由にはならない。
    mocks.db.dashboard.findMany.mockResolvedValue([
      { id: "dash-1", shareToken: null },
      { id: "dash-2", shareToken: "tok-abc" },
    ]);
    mocks.db.dashboard.findFirst.mockResolvedValue({
      id: "dash-1",
      workspaceId: "ws-1",
      collectionSlugs: ["juchu"],
    });

    const res = await createAutoDashboard(user, { workbookId: "wb-1" });

    expect(res.merged).toBe(0);
    expect(mocks.db.dashboard.deleteMany).not.toHaveBeenCalled();
  });

  it("利用者が自分で作った同名のダッシュボードには触らない", async () => {
    // 目印は説明文。findMany の条件にそれが入っていることを固定する
    // （名前だけで探すと、手作りのダッシュボードを上書きしてしまう）。
    await createAutoDashboard(user, { workbookId: "wb-1" });

    expect(mocks.db.dashboard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ description: AUTO_DESCRIPTION }),
      }),
    );
  });
});
