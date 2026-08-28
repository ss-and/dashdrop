/**
 * 取り込み確定パス（Excel / CSV / Google Sheets）の回帰テスト。
 *
 * ここで固定したい契約は2つ。
 *
 * 1. 列とフィールドの対応 — 列名を空にしても、別の列と同じ名前に変えても、
 *    重複した列名でも、フィールドが「別の列の値」を読むことは絶対に無い。
 *    元のバグは並び順（添え字）で突き合わせていたことで、列名を1つ空にすると
 *    以降のフィールドが1つずつ後ろの列を読み、最後の列は丸ごと消えていた。
 * 2. 打ち切り・未変換セルの申告 — 「成功」の裏で行やセルが落ちたことを、
 *    レスポンス・操作ログ・画面のすべてで黙らせない。
 *
 * Prisma には触れない（db はモック）。パーサ（@/lib/excel）は本物を使い、
 * 打ち切りの注入が必要なテストでだけ readSheet を差し替える。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import * as XLSX from "xlsx";
import { ImportWizard } from "@/components/import/ImportWizard";
import { ApiError } from "@/lib/errors";
import { buildWorkbook, MARK, MARK_RE } from "./helpers/excel-fixtures";

// パーサ本体は本物。readSheet だけ差し替え可能にして、5万行のファイルを
// 作らずに「打ち切られた解析結果」を注入できるようにする。
const actualExcel = await vi.importActual<typeof import("@/lib/excel")>(
  "@/lib/excel",
);

const mocks = vi.hoisted(() => ({
  db: {
    collection: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    workbook: { create: vi.fn(), delete: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    // 行の書き込みは createMany（1バッチ＝1文）。以前の
    // 「create を $transaction に詰める」形ではないので、ここも合わせる。
    record: { createMany: vi.fn() },
    alertRule: { updateMany: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  logActivity: vi.fn(),
  assertCanCreateCollection: vi.fn(),
  fetchSheetCsv: vi.fn(),
  readSheet: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db, toJson: (v: unknown) => v }));
vi.mock("@/lib/workspace", () => ({
  logActivity: mocks.logActivity,
  assertCanCreateCollection: mocks.assertCanCreateCollection,
  // プランの判定は本物を通さない。ここで確かめたいのは取り込みの中身。
  assertCanCreateWorkbook: vi.fn(),
  assertCapability: vi.fn(),
}));
vi.mock("@/lib/api", async () => {
  // next/server を読み込まずに withAuth を素通しにする。ApiError は本物を使い、
  // instanceof 判定がルート側と一致するようにする。
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
vi.mock("@/lib/gsheets", () => ({
  toCsvExportUrl: (url: string) => (url.trim() ? "https://example.test/export" : null),
  fetchSheetCsv: mocks.fetchSheetCsv,
}));
vi.mock("@/lib/excel", async () => {
  const actual = await vi.importActual<typeof import("@/lib/excel")>("@/lib/excel");
  return { ...actual, readSheet: mocks.readSheet };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

interface RouteUser {
  id: string;
  workspace: { id: string; plan: string };
}
interface RouteOk {
  ok: true;
  data: Record<string, unknown>;
}
/** ルートが実際に使う FormData の一部だけ。jsdom の File は arrayBuffer を持たない。 */
interface FakeForm {
  get: (key: string) => unknown;
}
type FileRoute = (
  req: { formData: () => Promise<FakeForm> },
  ctx: { user: RouteUser; params: Record<string, string> },
) => Promise<RouteOk>;
type JsonRoute = (
  req: { json: () => Promise<unknown> },
  ctx: { user: RouteUser; params: Record<string, string> },
) => Promise<RouteOk>;

/** 画面が送るのと同じ形のフィールド定義。 */
interface SentField {
  name: string;
  key: string;
  type: string;
  sourceHeader?: string;
  required?: boolean;
}

function ctx(plan = "business"): {
  user: RouteUser;
  params: Record<string, string>;
} {
  return { user: { id: "u-1", workspace: { id: "ws-1", plan } }, params: {} };
}

function toBuffer(csv: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(csv);
  return bytes.buffer.slice(0) as ArrayBuffer;
}

/**
 * multipart の代わりに、ルートが読む分だけの FormData を渡す。
 * jsdom の File には arrayBuffer() が無いので、最小限の代役を立てる。
 */
function fileReq(
  csv: string,
  sheets?: Array<{ sheetName: string; collectionName?: string; fields?: SentField[] }>,
): { formData: () => Promise<FakeForm> } {
  const buffer = toBuffer(csv);
  const file = {
    name: "社員名簿.csv",
    size: buffer.byteLength,
    arrayBuffer: async () => buffer,
  };
  const entries: Record<string, unknown> = { file };
  if (sheets) entries.sheets = JSON.stringify(sheets);
  return {
    formData: async () => ({ get: (key: string) => entries[key] ?? null }),
  };
}

function gsheetsReq(body: unknown): { json: () => Promise<unknown> } {
  return { json: async () => body };
}

async function importRoute(): Promise<FileRoute> {
  const mod = await import("@/app/api/import/route");
  return mod.POST as unknown as FileRoute;
}
async function gsheetsRoute(): Promise<JsonRoute> {
  const mod = await import("@/app/api/import/gsheets/route");
  return mod.POST as unknown as JsonRoute;
}

/**
 * 書き込まれたレコードの data だけを、渡された順に取り出す。
 *
 * createMany は1回の呼び出しに複数行を積むので、呼び出しをまたいで平らにする。
 * 行の順序は取り込み順そのもの——ここが崩れると「1行目が消えた」「順番が
 * 入れ替わった」を検出できなくなるので、call の順・data の順の両方を保つ。
 */
function writtenRecords(): Record<string, unknown>[] {
  return mocks.db.record.createMany.mock.calls.flatMap((call) =>
    (call[0] as { data: Array<{ data: Record<string, unknown> }> }).data.map(
      (row) => row.data,
    ),
  );
}

const STAFF_CSV = "氏名,部署,入社日\n田中,営業部,2024-04-01\n佐藤,開発部,2024-05-01\n";

/** 画面が既定で送る、3列そのままのマッピング。 */
function staffFields(): SentField[] {
  return [
    { name: "氏名", key: "shimei", type: "text", sourceHeader: "氏名" },
    { name: "部署", key: "busho", type: "text", sourceHeader: "部署" },
    { name: "入社日", key: "nyushabi", type: "date", sourceHeader: "入社日" },
  ];
}

beforeEach(() => {
  for (const fn of [
    mocks.db.collection.findMany,
    mocks.db.collection.create,
    mocks.db.collection.deleteMany,
    mocks.db.collection.delete,
    mocks.db.collection.update,
    mocks.db.workbook.create,
    mocks.db.workbook.delete,
    mocks.db.workbook.count,
    mocks.db.workbook.findFirst,
    mocks.db.record.createMany,
    mocks.db.alertRule.updateMany,
    mocks.db.notification.create,
    mocks.db.$transaction,
    mocks.logActivity,
    mocks.assertCanCreateCollection,
    mocks.fetchSheetCsv,
    mocks.readSheet,
    mocks.push,
    mocks.refresh,
  ]) {
    fn.mockReset();
  }
  mocks.readSheet.mockImplementation(actualExcel.readSheet);
  mocks.assertCanCreateCollection.mockResolvedValue(undefined);
  mocks.logActivity.mockResolvedValue(undefined);
  mocks.db.collection.findMany.mockResolvedValue([]);
  mocks.db.workbook.create.mockResolvedValue({ id: "wb-1" });
  // 既定は「同名のファイルは無い」＝従来どおりの新規追加。
  mocks.db.workbook.count.mockResolvedValue(0);
  mocks.db.workbook.findFirst.mockResolvedValue(null);
  mocks.db.alertRule.updateMany.mockResolvedValue({ count: 0 });
  mocks.db.notification.create.mockResolvedValue({});
  mocks.db.collection.create.mockResolvedValue({ id: "col-1" });
  // createMany は書き込んだ件数だけを返す（作られた行は返さない）。
  mocks.db.record.createMany.mockImplementation(
    async (args: { data: unknown[] }) => ({ count: args.data.length }),
  );
  mocks.db.$transaction.mockResolvedValue([]);
  mocks.db.collection.deleteMany.mockResolvedValue({ count: 1 });
  mocks.db.collection.delete.mockResolvedValue({});
  mocks.db.collection.update.mockResolvedValue({});
  mocks.db.workbook.delete.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// P0-5 — 列とフィールドの対応
// ---------------------------------------------------------------------------

describe("列とフィールドの対応 — POST /api/import", () => {
  it("列名を空にした取り込みは400で止まり、1行も書き込まない", async () => {
    // 以前はこの入力が 200 で通り、fields が [氏名, 入社日] に詰まって
    // 入社日が row["部署"]（＝営業部）を読み、入社日の列は丸ごと消えていた。
    const fields = staffFields();
    fields[1].name = "";
    const handler = await importRoute();

    const err = await handler(
      fileReq(STAFF_CSV, [{ sheetName: "", fields }]),
      ctx(),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toContain("2列目");
    expect(err.message).toContain("列名");
    // 検証は書き込みの前。中途半端なシートも空のファイルも作らない。
    expect(mocks.db.workbook.create).not.toHaveBeenCalled();
    expect(mocks.db.collection.create).not.toHaveBeenCalled();
    expect(mocks.db.record.createMany).not.toHaveBeenCalled();
  });

  it("列名を変えても、値は元の列から読む", async () => {
    const fields = staffFields();
    fields[1].name = "所属"; // 表示名だけ変更（sourceHeader は 部署 のまま）
    const handler = await importRoute();

    const res = await handler(fileReq(STAFF_CSV, [{ sheetName: "", fields }]), ctx());

    expect(res.ok).toBe(true);
    expect(writtenRecords()).toEqual([
      { shimei: "田中", busho: "営業部", nyushabi: "2024-04-01" },
      { shimei: "佐藤", busho: "開発部", nyushabi: "2024-05-01" },
    ]);
    // フィールド名は変わっても、入社日に部署の値が入っていないこと。
    expect(writtenRecords()[0].nyushabi).not.toBe("営業部");
  });

  it("重複した列名に戻しても、空欄のセルが隣の列の値を継承しない", async () => {
    // 同名の列はパーサが「金額」「金額-2」に開く。画面で2列目を「金額」に
    // 戻すと、以前は 2列目の空欄セルが row["金額"] を拾って1列目の金額を
    // 静かに継承していた（?? row[f.name] のフォールバック）。
    const csv = "金額,金額\n1000,\n2000,3000\n";
    const fields: SentField[] = [
      { name: "金額", key: "kingaku", type: "number", sourceHeader: "金額" },
      { name: "金額", key: "kingaku_2", type: "number", sourceHeader: "金額-2" },
    ];
    const handler = await importRoute();

    const res = await handler(fileReq(csv, [{ sheetName: "", fields }]), ctx());

    expect(res.ok).toBe(true);
    const rows = writtenRecords();
    expect(rows[0]).toEqual({ kingaku: 1000, kingaku_2: null });
    expect(rows[1]).toEqual({ kingaku: 2000, kingaku_2: 3000 });
  });

  it("sourceHeader を送らない旧クライアントでも、元の並び順で対応する", async () => {
    const fields = staffFields().map(({ sourceHeader: _drop, ...rest }) => rest);
    const handler = await importRoute();

    const res = await handler(fileReq(STAFF_CSV, [{ sheetName: "", fields }]), ctx());

    expect(res.ok).toBe(true);
    expect(writtenRecords()[0]).toEqual({
      shimei: "田中",
      busho: "営業部",
      nyushabi: "2024-04-01",
    });
  });

  it("存在しない列を指定した取り込みは409で止まり、1行も書き込まない", async () => {
    const fields = staffFields();
    fields[1].sourceHeader = "部門"; // ファイルに無い列
    const handler = await importRoute();

    const err = await handler(
      fileReq(STAFF_CSV, [{ sheetName: "", fields }]),
      ctx(),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toContain("部門");
    expect(mocks.db.collection.create).not.toHaveBeenCalled();
    expect(mocks.db.record.createMany).not.toHaveBeenCalled();
  });

  it("マッピングを送らなければ、推定した列がそのまま自分の列を読む", async () => {
    const handler = await importRoute();

    const res = await handler(fileReq(STAFF_CSV), ctx());

    expect(res.ok).toBe(true);
    const rows = writtenRecords();
    expect(Object.values(rows[0])).toEqual(["田中", "営業部", "2024-04-01"]);
  });
});

// ---------------------------------------------------------------------------
// Google Sheets — 取り込み直前の再取得によるずれ（TOCTOU）
// ---------------------------------------------------------------------------

describe("Google Sheets の取り込み直前の列変更 — POST /api/import/gsheets", () => {
  it("プレビュー後に列が消えていたら409で止め、ずれたまま取り込まない", async () => {
    // プレビュー時は 氏名/部署/入社日。確定時のCSVからは 部署 が消えている。
    // 並び順で突き合わせると、入社日フィールドが入社日の列を飛ばして
    // 別の列を読む（＝全列が1つずつずれる）。
    mocks.fetchSheetCsv.mockResolvedValue(
      toBuffer("氏名,入社日\n田中,2024-04-01\n"),
    );
    const handler = await gsheetsRoute();

    const err = await handler(
      gsheetsReq({
        url: "https://docs.google.com/spreadsheets/d/abc/edit",
        sheets: [{ sheetName: "", fields: staffFields() }],
      }),
      ctx(),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toContain("部署");
    expect(mocks.db.collection.create).not.toHaveBeenCalled();
    expect(mocks.db.record.createMany).not.toHaveBeenCalled();
  });

  it("列が増えていても、対応済みの列は正しい値を読む", async () => {
    mocks.fetchSheetCsv.mockResolvedValue(
      toBuffer("備考,氏名,部署,入社日\n新規,田中,営業部,2024-04-01\n"),
    );
    const handler = await gsheetsRoute();

    const res = await handler(
      gsheetsReq({
        url: "https://docs.google.com/spreadsheets/d/abc/edit",
        sheets: [{ sheetName: "", fields: staffFields() }],
      }),
      ctx(),
    );

    expect(res.ok).toBe(true);
    // 先頭に列が挿入されても、氏名に「新規」が入らないこと。
    expect(writtenRecords()[0]).toEqual({
      shimei: "田中",
      busho: "営業部",
      nyushabi: "2024-04-01",
    });
  });

  it("列名を空にした取り込みは400で止まる", async () => {
    mocks.fetchSheetCsv.mockResolvedValue(toBuffer(STAFF_CSV));
    const fields = staffFields();
    fields[2].name = "   ";
    const handler = await gsheetsRoute();

    const err = await handler(
      gsheetsReq({
        url: "https://docs.google.com/spreadsheets/d/abc/edit",
        sheets: [{ sheetName: "", fields }],
      }),
      ctx(),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(mocks.db.collection.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// P1-6 / P1-12 — 打ち切りと未変換セルの申告
// ---------------------------------------------------------------------------

describe("打ち切りと未変換セルの申告", () => {
  it("パーサ自身が読み取り上限に当たったことを申告する", async () => {
    // ルートが頼っている信号そのものの確認（本物のパーサ）。
    const csv = "値\n1\n2\n3\n4\n5\n";
    const capped = actualExcel.readSheet(toBuffer(csv), undefined, 2);
    expect(capped.rows).toHaveLength(2);
    expect(capped.truncated).toBe(true);

    const whole = actualExcel.readSheet(toBuffer(csv), undefined, 50);
    expect(whole.rows).toHaveLength(5);
    expect(whole.truncated).toBe(false);
  });

  it("打ち切られたら truncated と warning を返し、操作ログにも残す", async () => {
    // 5万行のファイルを作らずに「打ち切られた解析結果」を注入する。
    const base = actualExcel.readSheet(toBuffer(STAFF_CSV));
    mocks.readSheet.mockReturnValue({ ...base, truncated: true, rowLimit: 50000 });
    const handler = await importRoute();

    const res = await handler(
      fileReq(STAFF_CSV, [{ sheetName: "", fields: staffFields() }]),
      ctx("pro"),
    );

    expect(res.ok).toBe(true);
    expect(res.data.truncated).toBe(true);
    // 「50,000行取り込めました」で終わらせず、残りが無いことを明言する。
    expect(String(res.data.warning)).toContain("50,000");
    expect(String(res.data.warning)).toContain("取り込まれていません");

    const logged = mocks.logActivity.mock.calls.find(
      (call) => call[1] === "import.completed",
    );
    expect(logged?.[2].truncated).toBe(true);
    expect(String(logged?.[2].truncationMessage)).toContain("50,000");
  });

  it("型に合わなかったセル数を skipped と warning と操作ログに載せる", async () => {
    // 数値列に「未定」。以前は skipped を返してはいたが画面が読まず、
    // 空欄になったセルに誰も気づけなかった。
    const csv = "金額\n1000\n未定\n未定\n";
    const fields: SentField[] = [
      { name: "金額", key: "kingaku", type: "number", sourceHeader: "金額" },
    ];
    const handler = await importRoute();

    const res = await handler(fileReq(csv, [{ sheetName: "", fields }]), ctx());

    expect(res.data.skipped).toBe(2);
    expect(res.data.imported).toBe(3);
    expect(String(res.data.warning)).toContain("2 件");
    expect(String(res.data.warning)).toContain("空欄");
    expect(writtenRecords()).toEqual([
      { kingaku: 1000 },
      { kingaku: null },
      { kingaku: null },
    ]);

    const logged = mocks.logActivity.mock.calls.find(
      (call) => call[1] === "import.completed",
    );
    expect(logged?.[2].skipped).toBe(2);
  });

  it("問題なく取り込めたときは warning を出さない", async () => {
    const handler = await importRoute();

    const res = await handler(
      fileReq(STAFF_CSV, [{ sheetName: "", fields: staffFields() }]),
      ctx(),
    );

    expect(res.data.warning).toBeNull();
    expect(res.data.skipped).toBe(0);
    expect(res.data.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P2 — ロールバック
// ---------------------------------------------------------------------------

describe("失敗時のロールバック — POST /api/import", () => {
  it("行の書き込みに失敗したら collection.created を記録しない", async () => {
    // 以前は try の中で記録していたため、取り消された取り込みでも /logs に
    // 記録が残り、既に削除されたスプレッドシートへのリンクになっていた。
    // 行の書き込みを失敗させる。createMany に変えても、巻き戻しの単位は
    // 「このリクエストが作った Collection 全部」のままであること。
    mocks.db.record.createMany.mockRejectedValue(new Error("db is gone"));
    const handler = await importRoute();

    const err = await handler(
      fileReq(STAFF_CSV, [{ sheetName: "", fields: staffFields() }]),
      ctx(),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(
      mocks.logActivity.mock.calls.some((c) => c[1] === "collection.created"),
    ).toBe(false);
    expect(
      mocks.logActivity.mock.calls.some((c) => c[1] === "import.completed"),
    ).toBe(false);
    // Collection を消してから Workbook を消す（順序が逆だと孤児が残る）。
    expect(mocks.db.collection.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["col-1"] } },
    });
    expect(mocks.db.workbook.delete).toHaveBeenCalledWith({ where: { id: "wb-1" } });
  });

  it("Collection を消せなかったら Workbook は消さず、残骸を伝える", async () => {
    // Collection.workbookId は SetNull。Collection が残ったまま Workbook を
    // 消すと、中途半端なシートが親のないままシート一覧に現れる。
    // 行の書き込みを失敗させる。createMany に変えても、巻き戻しの単位は
    // 「このリクエストが作った Collection 全部」のままであること。
    mocks.db.record.createMany.mockRejectedValue(new Error("db is gone"));
    mocks.db.collection.deleteMany.mockRejectedValue(new Error("delete failed"));
    const handler = await importRoute();

    const err = await handler(
      fileReq(STAFF_CSV, [{ sheetName: "", fields: staffFields() }]),
      ctx(),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(mocks.db.workbook.delete).not.toHaveBeenCalled();
    expect(err.message).toContain("スプレッドシート一覧");
  });

  it("Workbook だけ消せなかったときは「空のファイル」と案内する", async () => {
    // 行の書き込みを失敗させる。createMany に変えても、巻き戻しの単位は
    // 「このリクエストが作った Collection 全部」のままであること。
    mocks.db.record.createMany.mockRejectedValue(new Error("db is gone"));
    mocks.db.workbook.delete.mockRejectedValue(new Error("delete failed"));
    const handler = await importRoute();

    const err = await handler(
      fileReq(STAFF_CSV, [{ sheetName: "", fields: staffFields() }]),
      ctx(),
    ).catch((e) => e);

    expect(err.message).toContain("空のファイル");
    expect(err.message).not.toContain("スプレッドシート一覧");
  });
});

// ---------------------------------------------------------------------------
// ImportWizard — 画面側の歯止め
// ---------------------------------------------------------------------------

/** マッピング画面まで進める。返り値は fetch モック。 */
async function renderAtMapStep(
  sheets: Array<Record<string, unknown>>,
): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes("/api/import/preview")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, data: { sheets } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          data: { collectionId: "col-1", sheetsImported: 1, skipped: 0, warning: null },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  const { container } = render(createElement(ImportWizard));
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input as HTMLInputElement, {
    target: { files: [new File([STAFF_CSV], "社員名簿.csv", { type: "text/csv" })] },
  });
  await screen.findByText("スプレッドシート名");
  return fetchMock;
}

function sheetPreview(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sheetName: "社員",
    headers: ["氏名", "部署", "入社日"],
    rowCount: 2,
    previewRows: [],
    empty: false,
    hidden: false,
    warnings: [],
    inferredFields: [
      { name: "氏名", key: "shimei", type: "text" },
      { name: "部署", key: "busho", type: "text" },
      { name: "入社日", key: "nyushabi", type: "date" },
    ],
    ...over,
  };
}

describe("ImportWizard — マッピング画面", () => {
  afterEach(() => {
    cleanup();
  });

  it("列名を空にすると取り込みを止め、送信しない", async () => {
    const fetchMock = await renderAtMapStep([sheetPreview()]);

    const nameInput = screen.getByLabelText("部署 の列名");
    fireEvent.change(nameInput, { target: { value: "" } });

    const runButton = screen.getByRole("button", { name: "取り込む" });
    await waitFor(() => expect(runButton).toBeDisabled());
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    // 何が起きているかと、直し方（元の列名）まで伝えていること。
    expect(screen.getByRole("alert").textContent).toContain("部署");

    fireEvent.click(runButton);
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/api/import")),
    ).toBe(false);

    // 戻せば取り込める。
    fireEvent.change(nameInput, { target: { value: "所属" } });
    await waitFor(() => expect(runButton).not.toBeDisabled());
  });

  it("元の列名を保ったまま送るので、改名しても列がずれない", async () => {
    const fetchMock = await renderAtMapStep([sheetPreview()]);

    fireEvent.change(screen.getByLabelText("部署 の列名"), {
      target: { value: "所属" },
    });
    fireEvent.click(screen.getByRole("button", { name: "取り込む" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/api/import")),
      ).toBe(true),
    );
    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith("/api/import"),
    );
    const body = (call?.[1] as { body: FormData }).body;
    const sent = JSON.parse(String(body.get("sheets"))) as Array<{
      fields: SentField[];
    }>;
    expect(sent[0].fields[1]).toMatchObject({
      name: "所属",
      sourceHeader: "部署",
    });
  });

  it("非表示シートは既定で選択しない", async () => {
    await renderAtMapStep([
      sheetPreview(),
      sheetPreview({ sheetName: "作業用", hidden: true }),
    ]);

    expect(screen.getByRole("checkbox", { name: /社員/ })).toBeChecked();
    // 「作業用」タブが勝手にスプレッドシート化され、プラン枠を消費していた。
    expect(screen.getByRole("checkbox", { name: /作業用/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "取り込む" })).not.toBeDisabled();
  });

  it("打ち切られたシートは、取り込む前に警告を出す", async () => {
    await renderAtMapStep([
      sheetPreview({ warnings: ["行数が1回の取り込みの上限（50,000行）を超えたため…"] }),
    ]);

    expect(screen.getByRole("status").textContent).toContain("50,000行");
    // 「2 行」とだけ出すと、それが全部だと読めてしまう。
    expect(screen.getByText(/先頭/)).toBeInTheDocument();
  });

  it("未変換セルがあるときは自動遷移せず、警告を出す", async () => {
    const fetchMock = vi.fn((input: unknown) => {
      const url = String(input);
      const payload = url.includes("/api/import/preview")
        ? { ok: true, data: { sheets: [sheetPreview()] } }
        : {
            ok: true,
            data: {
              collectionId: "col-1",
              sheetsImported: 1,
              skipped: 200,
              warning: "200 件のセルが列の型に合わず、空欄として取り込まれました。",
            },
          };
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container } = render(createElement(ImportWizard));
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File([STAFF_CSV], "売上台帳.csv", { type: "text/csv" })] },
    });
    await screen.findByText("スプレッドシート名");

    const runButton = screen.getByRole("button", { name: "取り込む" });
    fireEvent.click(runButton);

    // 自動遷移すると、空欄になった200セルに誰も気づけない。
    const warning = await screen.findByRole("status");
    expect(warning.textContent).toContain("200 件");
    expect(mocks.push).not.toHaveBeenCalled();

    // 再実行は同じシートを増やすだけなので塞ぐ。
    await waitFor(() => expect(runButton).toBeDisabled());

    fireEvent.click(
      screen.getByRole("button", { name: "取り込んだスプレッドシートを開く" }),
    );
    expect(mocks.push).toHaveBeenCalledWith("/c/col-1");
  });
});

// ---------------------------------------------------------------------------
// ホームにファイルを置いただけの取り込み（シート指定なし）
// ---------------------------------------------------------------------------

/** 複数タブの .xlsx を組み立てて、ルートが読む分だけの FormData に包む。 */
function workbookReq(
  sheets: Record<string, unknown[][]>,
  extra: Record<string, unknown> = {},
): { formData: () => Promise<FakeForm> } {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const file = {
    name: "受注データ.xlsx",
    size: out.byteLength,
    arrayBuffer: async () => out,
  };
  const entries: Record<string, unknown> = { file, ...extra };
  return {
    formData: async () => ({ get: (key: string) => entries[key] ?? null }),
  };
}

/** 作られたスプレッドシートの名前。 */
function createdCollectionNames(): string[] {
  return mocks.db.collection.create.mock.calls.map(
    (call) => (call[0] as { data: { name: string } }).data.name,
  );
}

describe("シート指定なしの取り込み — POST /api/import", () => {
  const TWO_TABS = {
    受注一覧: [
      ["日付", "取引先", "金額"],
      ["2026-01-01", "山田商事", 12000],
    ],
    月次サマリー: [
      ["月", "売上"],
      ["2026-01", 3000000],
    ],
  };

  it("ホームにファイルを置いただけでも、全タブが取り込まれる", async () => {
    // 元のバグ: sheets が無い＝「1枚目だけ」という後方互換パスに落ち、
    // 2枚目以降が警告も無く捨てられていた。ホームの入口がまさにこの
    // 送り方をするので、複数タブのファイルは静かに欠けたまま取り込まれていた。
    const handler = await importRoute();

    const res = await handler(workbookReq(TWO_TABS), ctx());

    expect(res.ok).toBe(true);
    expect(createdCollectionNames()).toEqual(["受注一覧", "月次サマリー"]);
  });

  it("シート名を明示した呼び出しは、そのシートだけを取り込む", async () => {
    const handler = await importRoute();

    const res = await handler(
      workbookReq(TWO_TABS, {
        sheets: JSON.stringify([{ sheetName: "月次サマリー" }]),
      }),
      ctx(),
    );

    expect(res.ok).toBe(true);
    expect(createdCollectionNames()).toEqual(["月次サマリー"]);
  });

  it("名前を指定した1枚だけの取り込み（従来の契約）は変わらない", async () => {
    // collectionName / fields を送る呼び出しは「1枚目を、この名前で」という
    // 意味なので、全タブ取り込みに巻き込まない。
    const handler = await importRoute();

    const res = await handler(
      workbookReq(TWO_TABS, { collectionName: "受注データ" }),
      ctx(),
    );

    expect(res.ok).toBe(true);
    expect(createdCollectionNames()).toEqual(["受注データ"]);
  });
});

// ---------------------------------------------------------------------------
// 同じファイルを入れ直したとき（上書き）
// ---------------------------------------------------------------------------

/**
 * 利用者の言葉:「ダッシュボード重複しているやつとかわかりづらくなるね、
 * 同じExcel名なら上書きとかが良さそうだよ」。
 *
 * 毎月同じ台帳を入れ直すのが普通の使い方なのに、これまでは入れるたびに
 * 同じ名前のファイルとシートが増えていた。ここで固定したいのは3つ。
 *
 *  1. 上書きしても slug は変わらない（既存のダッシュボードとURLが生き残る）。
 *  2. **新しい中身を全部作り終えてから**入れ替える（途中で失敗しても
 *     古い方が消えない）。
 *  3. 失敗したときに、上書き先の既存ファイルを道連れにしない。
 */
describe("同名ファイルの上書き — POST /api/import", () => {
  const TABS = {
    受注一覧: [
      ["日付", "取引先", "金額"],
      ["2026-01-01", "山田商事", 12000],
    ],
  };

  /** 既に「受注データ」というファイルがあり、中に「受注一覧」がある状態。 */
  function withExistingWorkbook() {
    mocks.db.workbook.findFirst.mockResolvedValue({
      id: "wb-old",
      name: "受注データ",
      collections: [
        { id: "col-old", name: "受注一覧", slug: "juchu-ichiran", position: 3 },
      ],
    });
  }

  it("既存シートの slug と位置を引き継ぐ（ダッシュボードが生き残る）", async () => {
    withExistingWorkbook();
    mocks.db.collection.create.mockResolvedValue({ id: "col-new" });
    const handler = await importRoute();

    const res = await handler(
      workbookReq(TABS, { mode: "replace", workbookId: "wb-old" }),
      ctx(),
    );

    expect(res.ok).toBe(true);
    // 新しいファイルは作らない。既存のファイルの中身が入れ替わる。
    expect(mocks.db.workbook.create).not.toHaveBeenCalled();

    // 作るときは仮の slug。本来の slug はまだ古いシートが握っている。
    const created = mocks.db.collection.create.mock.calls[0][0] as {
      data: { slug: string; workbookId: string };
    };
    expect(created.data.slug).toBe("juchu-ichiran-tmp");
    expect(created.data.workbookId).toBe("wb-old");

    // 入れ替えは1つのトランザクションで（通知ルールの付け替え → 古い方を削除
    // → 新しい方が本来の slug を名乗る）。
    const ops = mocks.db.$transaction.mock.calls.at(-1)![0] as unknown[];
    expect(ops).toHaveLength(3);
    expect(mocks.db.alertRule.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", collectionId: "col-old" },
      data: { collectionId: "col-new" },
    });
    expect(mocks.db.collection.delete).toHaveBeenCalledWith({
      where: { id: "col-old" },
    });
    expect(mocks.db.collection.update).toHaveBeenCalledWith({
      where: { id: "col-new" },
      data: { slug: "juchu-ichiran", position: 3 },
    });
  });

  it("古いシートを消すのは、新しい中身を作り終えてから", async () => {
    // 先に消してしまうと、作成に失敗したときに「新しい方も古い方も無い」に
    // なる。順序そのものが安全装置なので、順序を固定する。
    withExistingWorkbook();
    mocks.db.collection.create.mockResolvedValue({ id: "col-new" });
    const order: string[] = [];
    mocks.db.collection.create.mockImplementation(async () => {
      order.push("create");
      return { id: "col-new" };
    });
    mocks.db.collection.delete.mockImplementation(async () => {
      order.push("delete");
      return {};
    });
    const handler = await importRoute();

    await handler(
      workbookReq(TABS, { mode: "replace", workbookId: "wb-old" }),
      ctx(),
    );

    expect(order).toEqual(["create", "delete"]);
  });

  it("取り込みに失敗しても、上書き先の既存ファイルは消さない", async () => {
    withExistingWorkbook();
    mocks.db.collection.create.mockRejectedValue(new Error("boom"));
    const handler = await importRoute();

    await expect(
      handler(workbookReq(TABS, { mode: "replace", workbookId: "wb-old" }), ctx()),
    ).rejects.toThrow();

    // ここで消すと、中の既存シートごと巻き添えになる。
    expect(mocks.db.workbook.delete).not.toHaveBeenCalled();
    expect(mocks.db.collection.delete).not.toHaveBeenCalled();
  });

  it("「追加」を選んだときは、同じ名前でも見分けが付くようにする", async () => {
    mocks.db.workbook.count.mockResolvedValue(1);
    const handler = await importRoute();

    await handler(workbookReq(TABS, { mode: "add" }), ctx());

    const call = mocks.db.workbook.create.mock.calls[0][0] as {
      data: { name: string };
    };
    expect(call.data.name).toBe("受注データ (2)");
  });

  it("今回のファイルに無かった既存シートは、消さずに知らせる", async () => {
    mocks.db.workbook.findFirst.mockResolvedValue({
      id: "wb-old",
      name: "受注データ",
      collections: [
        { id: "col-old", name: "受注一覧", slug: "juchu-ichiran", position: 0 },
        { id: "col-keep", name: "去年の実績", slug: "kyonen", position: 1 },
      ],
    });
    mocks.db.collection.create.mockResolvedValue({ id: "col-new" });
    const handler = await importRoute();

    const res = await handler(
      workbookReq(TABS, { mode: "replace", workbookId: "wb-old" }),
      ctx(),
    );

    expect(res.ok).toBe(true);
    // 勝手に消さない。ただし黙ってもいけない——古い数字が混ざったままになる。
    expect(mocks.db.collection.delete).not.toHaveBeenCalledWith({
      where: { id: "col-keep" },
    });
    // 何も失われていないので、グラフへの導線は止めない（warning ではなく
    // notice）。ただし黙ってもいけない——古い数字が混ざったままになる。
    expect(res.data.warning).toBeNull();
    expect(res.data.notice).toContain("去年の実績");
    // 画面から離れても後で読めるように、受信箱にも残す。
    expect(mocks.db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ url: "/f/wb-old" }),
      }),
    );
  });

  it("mode を送らない呼び出しは、これまでどおり新しいファイルとして増える", async () => {
    withExistingWorkbook();
    const handler = await importRoute();

    await handler(workbookReq(TABS), ctx());

    expect(mocks.db.workbook.create).toHaveBeenCalled();
    expect(mocks.db.collection.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Excel のいろいろな形を、実際のルートに通す
// ---------------------------------------------------------------------------

/**
 * 生成した .xlsx を、**本物の POST /api/import** に流し込む。
 *
 * これまでのパターンテスト（tests/excel-patterns.test.ts）はパーサから
 * 自動レイアウトまでを通していたが、ルートの中の「列の対応づけ」だけは
 * 別に書かれている。値がどの列から来るかを決めているのはそこなので、
 * 同じ生成器で本物のルートも叩いておく。
 *
 * 見るのは2つだけ、ただしいちばん大事な2つ。
 *   1. 生成した行が、1行ずつちょうど1回だけ書き込まれること。
 *   2. 各セルの値が、書いたときの列から読まれていること（1列ずれない）。
 */
function xlsxReq(
  buffer: Buffer,
  extra: Record<string, unknown> = {},
): { formData: () => Promise<FakeForm> } {
  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  const file = {
    name: "パターン.xlsx",
    size: ab.byteLength,
    arrayBuffer: async () => ab,
  };
  const entries: Record<string, unknown> = { file, ...extra };
  return { formData: async () => ({ get: (key: string) => entries[key] ?? null }) };
}

/** db.record.createMany に渡されたデータを、コレクション作成順にまとめる。 */
function writtenRecordsByCollection(): Array<Array<Record<string, unknown>>> {
  const perCollection = new Map<string, Array<Record<string, unknown>>>();
  for (const call of mocks.db.record.createMany.mock.calls) {
    const arg = call[0] as {
      data: Array<{ collectionId: string; data: Record<string, unknown> }>;
    };
    for (const row of arg.data) {
      const list = perCollection.get(row.collectionId) ?? [];
      list.push(row.data);
      perCollection.set(row.collectionId, list);
    }
  }
  return [...perCollection.values()];
}

describe("Excelのいろいろな形 — 本物の POST /api/import", () => {
  const BASE = Number(process.env.FUZZ_SEED ?? 1);
  const CASES = Number(process.env.ROUTE_FUZZ_CASES ?? 60);
  const seeds = Array.from({ length: CASES }, (_, i) => BASE + i);

  it.each(seeds)("seed %i — 行を落とさず、列がずれない", async (seed) => {
    const { buffer, sheets } = buildWorkbook(seed);

    // 生成したコレクションを1枚ずつ別IDにして、行の帰属を追えるようにする。
    let n = 0;
    mocks.db.collection.create.mockImplementation(async () => ({ id: `col-${n++}` }));

    const handler = await importRoute();
    const res = await handler(xlsxReq(buffer), ctx());
    expect(res.ok, `seed=${seed}: 取り込みに失敗`).toBe(true);

    const written = writtenRecordsByCollection();

    /*
     * 突き合わせは印だけで行う。シート名では追えない——1枚しかないタブは
     * ファイル名に付け替えられるし、名前が衝突することもある。印には
     * シート番号が入っているので、名前に一切依存しない。
     */
    const writtenMarks: string[] = [];
    for (const rows of written) {
      for (const rec of rows) {
        for (const v of Object.values(rec)) {
          if (typeof v === "string" && MARK_RE.test(v)) writtenMarks.push(v);
        }
      }
    }

    const expectedMarks = new Set<string>();
    for (const gen of sheets) {
      if (!gen.plan.columns.some((c) => c.header === MARK)) continue;
      for (const m of gen.expected.keys()) expectedMarks.add(m);
    }

    // 同じ行が2回書き込まれていないこと。
    expect(
      new Set(writtenMarks).size,
      `seed=${seed}: 同じ行が2回書き込まれた`,
    ).toBe(writtenMarks.length);

    // 1行も失われていないこと（印を持つシートの分だけ）。
    for (const m of expectedMarks) {
      expect(writtenMarks.includes(m), `seed=${seed}: 行「${m}」が失われた`).toBe(true);
    }

    // 無い行が生えていないこと。
    for (const m of writtenMarks) {
      expect(expectedMarks.has(m), `seed=${seed}: 覚えの無い行「${m}」`).toBe(true);
    }
  });
});
