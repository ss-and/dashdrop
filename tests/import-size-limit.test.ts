/**
 * アップロード上限（MAX_IMPORT_BYTES）の回帰テスト。
 *
 * 【なぜこのテストが要るのか】
 * 上限は 15MB と宣言していたが、Vercel のサーバーレス関数はリクエストボディを
 * 4.5MB で打ち切る。その判定はハンドラが起動する**前**にあるので、4.5〜15MB の
 * ファイルは「丁寧に書いた日本語のメッセージが一度も出ないまま、本文の無い 413
 * だけが返る」——利用者から見れば原因不明の失敗だった。
 *
 * そこで上限を自分で断れる 4MB まで下げた。ここで固定したいのは2つ。
 *   1. 4MB を超えるファイルは、どの入口（確定・下見・解析）でも 413 で断ること
 *   2. その文面が「何が起きたか＋どうすれば直るか」を日本語で言うこと
 *      （断るだけの文面に戻すと、上限を下げたぶん行き止まりが増える）
 *
 * 実バイト列は作らない。ルートはサイズ判定を `file.size` だけで、しかも
 * `arrayBuffer()` を読む前に行う——そこが崩れれば下の「解析していないこと」の
 * 検証が落ちる。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "@/lib/errors";
import { MAX_IMPORT_BYTES } from "@/lib/excel";

const mocks = vi.hoisted(() => ({
  db: {
    collection: { findMany: vi.fn() },
    workbook: { create: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    record: { createMany: vi.fn() },
  },
  adviseImport: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db, toJson: (v: unknown) => v }));
vi.mock("@/lib/api", async () => {
  // next/server を読み込まずに withAuth を素通しにする。ApiError は本物を使い、
  // instanceof 判定がルート側と一致するようにする。
  const errors = await import("@/lib/errors");
  return {
    ApiError: errors.ApiError,
    ok: (data: unknown) => ({ ok: true, data }),
    fail: (error: string, status: number) => ({ ok: false, error, status }),
    withAuth: (handler: unknown) => handler,
  };
});
vi.mock("@/lib/import-advisor", () => ({ adviseImport: mocks.adviseImport }));

type FakeForm = { get: (key: string) => unknown };
type FileRoute = (
  req: { formData: () => Promise<FakeForm> },
  ctx: unknown,
) => Promise<{ ok: boolean; data?: unknown }>;

function ctx() {
  return {
    user: {
      id: "u-1",
      workspace: { id: "ws-1", plan: "free", aiEnabled: false },
    },
    params: {},
  };
}

/** サイズだけを名乗るファイル。中身を読もうとしたら分かるようにしてある。 */
function fileOfSize(bytes: number, name = "売上台帳.xlsx") {
  const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
  return {
    file: { name, size: bytes, arrayBuffer },
    /** ルートが中身を読みに行ったか（＝サイズ判定より後まで進んだか）。 */
    read: arrayBuffer,
  };
}

function reqWith(file: unknown, extra: Record<string, unknown> = {}) {
  const entries: Record<string, unknown> = { file, ...extra };
  return {
    formData: async () => ({ get: (key: string) => entries[key] ?? null }),
  };
}

const ROUTES: Array<{ label: string; load: () => Promise<FileRoute> }> = [
  {
    label: "POST /api/import（確定）",
    load: async () =>
      (await import("@/app/api/import/route")).POST as unknown as FileRoute,
  },
  {
    label: "POST /api/import/preview（下見）",
    load: async () =>
      (await import("@/app/api/import/preview/route"))
        .POST as unknown as FileRoute,
  },
  {
    label: "POST /api/import/analyze（解析）",
    load: async () =>
      (await import("@/app/api/import/analyze/route"))
        .POST as unknown as FileRoute,
  },
];

beforeEach(() => {
  for (const fn of [
    mocks.db.collection.findMany,
    mocks.db.workbook.create,
    mocks.db.workbook.count,
    mocks.db.workbook.findFirst,
    mocks.db.record.createMany,
    mocks.adviseImport,
  ]) {
    fn.mockReset();
  }
  mocks.db.collection.findMany.mockResolvedValue([]);
  mocks.db.workbook.count.mockResolvedValue(0);
  mocks.db.workbook.findFirst.mockResolvedValue(null);
  mocks.db.workbook.create.mockResolvedValue({ id: "wb-1" });
  mocks.db.record.createMany.mockResolvedValue({ count: 0 });
});

describe("アップロード上限 — 4MB を超えるファイル", () => {
  it("上限そのものが、プラットフォームが先に断る 4.5MB より小さい", () => {
    // ここが 4.5MB 以上に戻ると、下の日本語メッセージは本番で二度と出ない
    // （ハンドラが起動する前に、本文の無い 413 が返るため）。
    expect(MAX_IMPORT_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(MAX_IMPORT_BYTES).toBe(4 * 1024 * 1024);
  });

  for (const route of ROUTES) {
    it(`${route.label} は 413 で断り、理由と次の一手を日本語で返す`, async () => {
      const { file, read } = fileOfSize(MAX_IMPORT_BYTES + 1);
      const handler = await route.load();

      const err = await handler(
        reqWith(file, { sheets: JSON.stringify([{ sheetName: "" }]) }),
        ctx(),
      ).catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(413);
      // 何が起きたか（上限と、このファイルの大きさ）。
      expect(err.message).toContain("4MB");
      expect(err.message).toContain("上限");
      // どうすれば直るか。「大きすぎます」だけで終わらせない。
      expect(err.message).toMatch(/シートを分け|列や行を削/);
      // 判定は解析より前。大きいファイルを読み込んでから断ってはいけない。
      expect(read).not.toHaveBeenCalled();
      expect(mocks.db.record.createMany).not.toHaveBeenCalled();
    });

    it(`${route.label} は上限ちょうどのファイルは断らない`, async () => {
      // 境界の向きを固定する。`>=` に書き換えると、ちょうど 4MB の
      // ファイルが理由もなく弾かれるようになる。
      const { file, read } = fileOfSize(MAX_IMPORT_BYTES);
      const handler = await route.load();

      const err = await handler(
        reqWith(file, { sheets: JSON.stringify([{ sheetName: "" }]) }),
        ctx(),
      ).catch((e) => e);

      // 中身は空の ArrayBuffer なので解析の先で別のエラーにはなるが、
      // 「サイズを理由に断られていない」ことだけを見る。
      expect(err instanceof ApiError && err.status === 413).toBe(false);
      expect(read).toHaveBeenCalled();
    });
  }
});

describe("重い処理をするルートは maxDuration を宣言している", () => {
  /*
   * 宣言が無いと Vercel の既定（10〜15秒）で切られる。取り込みは
   * all-or-nothing で巻き戻すので、切られた利用者に残るのは
   * 「待たされた末に何も起きなかった」だけ——原因も次の一手も分からない。
   *
   * 値は 60。Vercel Pro は最大800秒まで伸ばせるが、Hobby でも他の
   * ホスティングでも通る値がここなので、全部これでそろえてある。
   * この export は1行なので、リファクタで静かに消えても誰も気づかない。
   */
  const HEAVY: Array<[string, () => Promise<{ maxDuration?: unknown }>]> = [
    ["/api/import", () => import("@/app/api/import/route")],
    ["/api/import/preview", () => import("@/app/api/import/preview/route")],
    ["/api/import/analyze", () => import("@/app/api/import/analyze/route")],
    ["/api/import/gsheets", () => import("@/app/api/import/gsheets/route")],
    ["/api/import/notion", () => import("@/app/api/import/notion/route")],
    ["/api/dashboards/auto", () => import("@/app/api/dashboards/auto/route")],
  ];

  for (const [label, load] of HEAVY) {
    it(`${label} は maxDuration を 60 で宣言する`, async () => {
      const mod = await load();
      expect(mod.maxDuration).toBe(60);
    });
  }
});
