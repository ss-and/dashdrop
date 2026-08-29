/**
 * 同名ファイルの置き換えを、2つある取り込みの入口で揃えたことの回帰テスト。
 *
 * 【何が起きていたか】
 * 「Excelを取り込む」入口はホームのドロップゾーン（/api/import/analyze →
 * ImportReview）と /import の画面（/api/import/preview → ImportWizard）の2つ。
 * 前者だけが同名ファイルの上書きに対応していて、後者は mode を送っていなかった
 * ため、/api/import は常に既定の "add" で動いていた。毎月同じ「売上台帳」を
 * 入れ直す人のファイルが1つずつ増え、同名のシートとダッシュボードが並ぶ。
 * しかも設定ガイド（src/lib/onboarding.ts）が案内するのは /import の方だった。
 *
 * ここで固定したい契約:
 *   1. /api/import/preview が analyze と同じ形の `existing` を返す
 *   2. その照合は必ずワークスペース内で閉じる（他社のブック名を覗けない）
 *   3. ImportWizard が mode を送る（送らないと常に追加になる回帰）
 *   4. 既定は「上書きして更新する」＝ホーム側（ImportReview）と同じ
 *   5. 同名が無いときは選択肢を出さない（迷わせない）
 *
 * Prisma には触れない。db は「ワークスペースで絞る」ことを実際に確かめられる
 * 最小の偽物に差し替える（絞りを外すと他社のブックが返る＝テストが落ちる）。
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
import { ImportWizard } from "@/components/import/ImportWizard";

/* ------------------------------ 偽の DB ------------------------------ */

interface FakeWorkbook {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
  collections: Array<{
    name: string;
    slug: string;
    position: number;
    _count: { records: number };
  }>;
}

const mocks = vi.hoisted(() => ({
  workbooks: [] as unknown[],
  findFirst: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { workbook: { findFirst: mocks.findFirst } },
  toJson: (v: unknown) => v,
}));
vi.mock("@/lib/api", async () => {
  // next/server を読み込まずに withAuth を素通しにする。
  const errors = await import("@/lib/errors");
  return {
    ApiError: errors.ApiError,
    ok: (data: unknown) => ({ ok: true, data }),
    fail: (error: string, status: number) => ({ ok: false, error, status }),
    withAuth: (handler: unknown) => handler,
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

/**
 * findFirst の代役。**where をそのまま解釈する**のが肝。
 * ルート側が workspaceId を渡さなくなったら、他社のブックが素通りして返る＝
 * 「ワークスペースをまたいで漏れない」テストが落ちる。
 */
function seedWorkbooks(rows: FakeWorkbook[]) {
  mocks.workbooks = rows;
  mocks.findFirst.mockImplementation(
    async (args: { where: { workspaceId?: string; name?: string } }) => {
      const where = args?.where ?? {};
      const hit = (mocks.workbooks as FakeWorkbook[])
        .filter(
          (w) =>
            (where.name === undefined || w.name === where.name) &&
            (where.workspaceId === undefined ||
              w.workspaceId === where.workspaceId),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return hit ?? null;
    },
  );
}

function workbook(over: Partial<FakeWorkbook> = {}): FakeWorkbook {
  return {
    id: "wb-1",
    workspaceId: "ws-1",
    name: "売上台帳",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    collections: [
      { name: "売上", slug: "uriage", position: 0, _count: { records: 120 } },
    ],
    ...over,
  };
}

/* --------------------------- ルートを直接叩く --------------------------- */

interface RouteOk {
  ok: true;
  data: Record<string, unknown>;
}
type PreviewRoute = (
  req: { formData: () => Promise<{ get: (key: string) => unknown }> },
  ctx: { user: { workspace: { id: string } }; params: Record<string, string> },
) => Promise<RouteOk>;

async function previewRoute(): Promise<PreviewRoute> {
  const mod = await import("@/app/api/import/preview/route");
  return mod.POST as unknown as PreviewRoute;
}

const LEDGER_CSV = "得意先,金額\n山田商事,12000\n田中工業,8000\n";

function fileReq(fileName: string, csv = LEDGER_CSV) {
  const bytes = new TextEncoder().encode(csv);
  const buffer = bytes.buffer.slice(0) as ArrayBuffer;
  const entries: Record<string, unknown> = {
    file: {
      name: fileName,
      size: buffer.byteLength,
      arrayBuffer: async () => buffer,
    },
  };
  return { formData: async () => ({ get: (k: string) => entries[k] ?? null }) };
}

function ctx(workspaceId = "ws-1") {
  return { user: { workspace: { id: workspaceId } }, params: {} };
}

beforeEach(() => {
  mocks.findFirst.mockReset();
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  seedWorkbooks([]);
});

/* ------------------------ 1〜2. preview の existing ------------------------ */

describe("同名ファイルの検出 — POST /api/import/preview", () => {
  it("同じ名前のファイルがあれば、analyze と同じ形で返す", async () => {
    seedWorkbooks([
      workbook({
        collections: [
          { name: "売上", slug: "uriage", position: 0, _count: { records: 120 } },
          { name: "返品", slug: "henpin", position: 1, _count: { records: 4 } },
        ],
      }),
    ]);
    const handler = await previewRoute();

    const res = await handler(fileReq("売上台帳.csv"), ctx());

    expect(res.ok).toBe(true);
    // 形は /api/import/analyze の existing と同一。画面が分岐せずに済むように。
    expect(res.data.existing).toEqual({
      workbookId: "wb-1",
      name: "売上台帳",
      importedAt: "2026-07-01T00:00:00.000Z",
      sheets: [
        { name: "売上", slug: "uriage", rowCount: 120 },
        { name: "返品", slug: "henpin", rowCount: 4 },
      ],
    });
    // 取り込み後に付くブック名（拡張子を落としたもの）も返す。
    expect(res.data.fileBase).toBe("売上台帳");
  });

  it("同じ名前が無ければ null（従来どおりの新規追加）", async () => {
    seedWorkbooks([workbook({ name: "経費精算" })]);
    const handler = await previewRoute();

    const res = await handler(fileReq("売上台帳.csv"), ctx());

    expect(res.data.existing).toBeNull();
  });

  it("他のワークスペースの同名ファイルは見えない", async () => {
    // 他社のブック名・シート名・行数が「同名のファイルがあります」の形で
    // 漏れてはいけない。where から workspaceId が抜けたらここで落ちる。
    seedWorkbooks([workbook({ id: "wb-other", workspaceId: "ws-2" })]);
    const handler = await previewRoute();

    const res = await handler(fileReq("売上台帳.csv"), ctx("ws-1"));

    expect(res.data.existing).toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws-1" }),
      }),
    );
  });

  it("同名が複数あるときは、いちばん新しいものを置き換え先にする", async () => {
    seedWorkbooks([
      workbook({ id: "wb-old", createdAt: new Date("2026-05-01T00:00:00.000Z") }),
      workbook({ id: "wb-new", createdAt: new Date("2026-08-01T00:00:00.000Z") }),
    ]);
    const handler = await previewRoute();

    const res = await handler(fileReq("売上台帳.csv"), ctx());

    expect((res.data.existing as { workbookId: string }).workbookId).toBe("wb-new");
  });
});

/* --------------------- 3〜5. ImportWizard の選択と送信 --------------------- */

function sheetPreview(): Record<string, unknown> {
  return {
    sheetName: "売上",
    headers: ["得意先", "金額"],
    rowCount: 2,
    previewRows: [],
    empty: false,
    hidden: false,
    warnings: [],
    inferredFields: [
      { name: "得意先", key: "tokuisaki", type: "text" },
      { name: "金額", key: "kingaku", type: "number" },
    ],
  };
}

const EXISTING = {
  workbookId: "wb-9",
  name: "売上台帳",
  importedAt: "2026-07-01T00:00:00.000Z",
  sheets: [
    { name: "売上", slug: "uriage", rowCount: 120 },
    { name: "旧データ", slug: "kyu-data", rowCount: 7 },
  ],
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** マッピング画面まで進める。返り値は fetch モック。 */
async function renderAtMapStep(
  existing: unknown,
): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes("/api/import/preview")) {
      return Promise.resolve(
        jsonResponse({ ok: true, data: { sheets: [sheetPreview()], existing } }),
      );
    }
    if (url.includes("/api/dashboards/auto")) {
      return Promise.resolve(
        jsonResponse({ ok: true, data: { dashboardId: "dash-1" } }),
      );
    }
    return Promise.resolve(
      jsonResponse({
        ok: true,
        data: {
          collectionId: "col-1",
          workbookId: "wb-9",
          sheetsImported: 1,
          skipped: 0,
          warning: null,
        },
      }),
    );
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  const { container } = render(createElement(ImportWizard));
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: {
      files: [new File([LEDGER_CSV], "売上台帳.csv", { type: "text/csv" })],
    },
  });
  await screen.findByText("スプレッドシート名");
  return fetchMock;
}

/** /api/import へ送られた FormData。 */
async function sentImportForm(
  fetchMock: ReturnType<typeof vi.fn>,
): Promise<FormData> {
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/api/import")),
    ).toBe(true),
  );
  const call = fetchMock.mock.calls.find((c) =>
    String(c[0]).endsWith("/api/import"),
  );
  return (call?.[1] as { body: FormData }).body;
}

describe("ImportWizard — 同名ファイルの扱い", () => {
  afterEach(() => {
    cleanup();
  });

  it("同名があるときは2択を出し、既定は上書き（ホームの確認画面と同じ）", async () => {
    await renderAtMapStep(EXISTING);

    expect(screen.getByText("同じ名前のファイルが既にあります")).toBeInTheDocument();
    const replace = screen.getByRole("radio", { name: /上書きして更新する/ });
    const add = screen.getByRole("radio", { name: /別のファイルとして追加する/ });
    // 既定を "add" にすると、同名ファイルが黙って増え続ける（元の不具合）。
    expect(replace).toBeChecked();
    expect(add).not.toBeChecked();
    // 選んだ結果の1行が必ず添えられていること。
    expect(screen.getByText(/ダッシュボードとURLはそのまま使えます/)).toBeInTheDocument();
    expect(screen.getByText(/名前には \(2\) が付きます/)).toBeInTheDocument();
    // 何が入れ替わり、何が残るのかを押す前に見せる。
    expect(screen.getByText(/売上（120行）— 入れ替え/)).toBeInTheDocument();
    expect(screen.getByText(/旧データ（7行）— そのまま残ります/)).toBeInTheDocument();
  });

  it("既定のまま取り込むと mode=replace と置き換え先 id を送る", async () => {
    const fetchMock = await renderAtMapStep(EXISTING);

    fireEvent.click(screen.getByRole("button", { name: "取り込む" }));

    const body = await sentImportForm(fetchMock);
    expect(body.get("mode")).toBe("replace");
    // 名前ではなく id で指定する（下見のあとに同名が増えても取り違えない）。
    expect(body.get("workbookId")).toBe("wb-9");
  });

  it("「別のファイルとして追加する」を選べば mode=add で、置き換え先は送らない", async () => {
    const fetchMock = await renderAtMapStep(EXISTING);

    fireEvent.click(screen.getByRole("radio", { name: /別のファイルとして追加する/ }));
    fireEvent.click(screen.getByRole("button", { name: "取り込む" }));

    const body = await sentImportForm(fetchMock);
    expect(body.get("mode")).toBe("add");
    expect(body.get("workbookId")).toBeNull();
  });

  it("同名が無いときは選択肢を出さず、mode=add を送る", async () => {
    const fetchMock = await renderAtMapStep(null);

    expect(screen.queryByText("同じ名前のファイルが既にあります")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "取り込む" }));

    // mode を送らないこと自体が回帰（サーバ既定に落ちる）。明示して送る。
    const body = await sentImportForm(fetchMock);
    expect(body.get("mode")).toBe("add");
  });

  it("Google スプレッドシート経由では選択肢を出さない", async () => {
    // /api/import/gsheets は mode を受け取らず必ず新規作成する。押せるのに
    // 効かない選択肢を出すのが最悪なので、こちらは出さないことを固定する。
    const fetchMock = vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes("/api/import/gsheets/preview")) {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            data: { sheets: [sheetPreview()], existing: EXISTING },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ ok: true, data: {} }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(createElement(ImportWizard));
    fireEvent.change(
      screen.getByPlaceholderText("https://docs.google.com/spreadsheets/d/…"),
      { target: { value: "https://docs.google.com/spreadsheets/d/abc/edit" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "読み込む" }));
    await screen.findByText("スプレッドシート名");

    expect(screen.queryByText("同じ名前のファイルが既にあります")).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });
});
