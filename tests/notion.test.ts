/**
 * Notion client + property-mapping tests.
 *
 * `global.fetch` is mocked throughout: no network, no token, no Prisma. The
 * emphasis is on the two things that break real imports — hostile/partial API
 * responses, and failures that must surface as Japanese ApiErrors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ImportWizard } from "@/components/import/ImportWizard";
import { ApiError } from "@/lib/errors";
import {
  listDatabases,
  fetchDatabase,
  queryDatabase,
  databaseTitle,
  notionFields,
  mapPropertyType,
  readPropertyValue,
  notionSelectOptions,
  notionError,
  truncationMessage,
  MAX_QUERY_PAGES,
  DEFAULT_MAX_ROWS,
  NOTION_IMPORT_BUDGET_MS,
  MIN_QUERY_SLICE_MS,
} from "@/lib/notion";

const TOKEN = "secret_test_token_0123456789";

// ---------------------------------------------------------------------------
// Module mocks for the route + wizard regression tests.
//
// `@/lib/notion` itself is NEVER mocked: the point of these tests is that the
// real client, driven by a mocked `fetch`, reaches the route and the UI.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  db: {
    collection: { findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
    workbook: { create: vi.fn(), delete: vi.fn() },
    // 行の書き込みは createMany（1バッチ＝1文）。以前の
    // 「create を $transaction に詰める」形ではないので、ここも合わせる。
    record: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
  logActivity: vi.fn(),
  assertCanCreateCollection: vi.fn(),
  getSecret: vi.fn(),
  recordResult: vi.fn(),
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
vi.mock("@/lib/integrations", () => ({
  getSecret: mocks.getSecret,
  recordResult: mocks.recordResult,
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

/** A JSON Response like Notion's. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A response whose body is not JSON at all (Cloudflare/HTML error pages). */
function brokenResponse(status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "text/html" }),
    json: async () => {
      throw new SyntaxError("Unexpected token <");
    },
    text: async () => "<!doctype html><html><body>oops</body></html>",
  } as unknown as Response;
}

function mockFetch(...responses: Response[]) {
  const fn = vi.fn();
  for (const res of responses) fn.mockResolvedValueOnce(res);
  fn.mockResolvedValue(responses[responses.length - 1] ?? jsonResponse({}));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** Build a fake query page of N rows. */
function queryPage(count: number, hasMore: boolean, cursor: string | null) {
  return jsonResponse({
    object: "list",
    results: Array.from({ length: count }, (_, i) => ({
      object: "page",
      id: `page-${cursor ?? "0"}-${i}`,
      properties: {},
    })),
    has_more: hasMore,
    next_cursor: hasMore ? (cursor ?? "cursor-1") : null,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// mapPropertyType
// ---------------------------------------------------------------------------

describe("mapPropertyType", () => {
  it("maps text-ish Notion types to text", () => {
    expect(mapPropertyType("title")).toBe("text");
    expect(mapPropertyType("rich_text")).toBe("text");
  });

  it("maps scalar Notion types to their DashDrop equivalents", () => {
    expect(mapPropertyType("number")).toBe("number");
    expect(mapPropertyType("select")).toBe("select");
    expect(mapPropertyType("status")).toBe("select");
    expect(mapPropertyType("multi_select")).toBe("multiselect");
    expect(mapPropertyType("date")).toBe("date");
    expect(mapPropertyType("checkbox")).toBe("checkbox");
    expect(mapPropertyType("email")).toBe("email");
    expect(mapPropertyType("phone_number")).toBe("phone");
    expect(mapPropertyType("url")).toBe("url");
  });

  it("flattens derived/linked Notion types to text", () => {
    for (const t of ["people", "files", "relation", "rollup", "formula"]) {
      expect(mapPropertyType(t)).toBe("text");
    }
  });

  it("falls back to text for unknown, missing, or nonsense types", () => {
    expect(mapPropertyType("verification")).toBe("text");
    expect(mapPropertyType(undefined)).toBe("text");
    expect(mapPropertyType(null)).toBe("text");
    expect(mapPropertyType(42)).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// readPropertyValue
// ---------------------------------------------------------------------------

describe("readPropertyValue", () => {
  it("reads title and rich_text as joined plain text", () => {
    expect(
      readPropertyValue({
        type: "title",
        title: [{ plain_text: "山田" }, { plain_text: "商店" }],
      }),
    ).toBe("山田商店");
    expect(
      readPropertyValue({ type: "rich_text", rich_text: [{ plain_text: "メモ" }] }),
    ).toBe("メモ");
  });

  it("reads numbers, including zero", () => {
    expect(readPropertyValue({ type: "number", number: 1200 })).toBe(1200);
    expect(readPropertyValue({ type: "number", number: 0 })).toBe(0);
  });

  it("reads select and status as the option name", () => {
    expect(
      readPropertyValue({ type: "select", select: { name: "進行中", color: "blue" } }),
    ).toBe("進行中");
    expect(
      readPropertyValue({ type: "status", status: { name: "完了", color: "green" } }),
    ).toBe("完了");
  });

  it("reads multi_select as an array of names", () => {
    const value = readPropertyValue({
      type: "multi_select",
      multi_select: [{ name: "A" }, { name: "B" }, { name: "C" }],
    });
    expect(Array.isArray(value)).toBe(true);
    expect(value).toEqual(["A", "B", "C"]);
  });

  it("truncates a date to YYYY-MM-DD", () => {
    expect(
      readPropertyValue({ type: "date", date: { start: "2024-03-05" } }),
    ).toBe("2024-03-05");
    expect(
      readPropertyValue({
        type: "date",
        date: { start: "2024-03-05T10:30:00.000+09:00", end: null },
      }),
    ).toBe("2024-03-05");
  });

  it("reads checkbox as a boolean, including false", () => {
    expect(readPropertyValue({ type: "checkbox", checkbox: true })).toBe(true);
    expect(readPropertyValue({ type: "checkbox", checkbox: false })).toBe(false);
  });

  it("reads email, phone_number and url", () => {
    expect(readPropertyValue({ type: "email", email: "a@example.com" })).toBe(
      "a@example.com",
    );
    expect(
      readPropertyValue({ type: "phone_number", phone_number: "03-1234-5678" }),
    ).toBe("03-1234-5678");
    expect(readPropertyValue({ type: "url", url: "https://example.com" })).toBe(
      "https://example.com",
    );
  });

  it("flattens people and files to readable strings", () => {
    expect(
      readPropertyValue({
        type: "people",
        people: [{ name: "田中" }, { name: "佐藤" }],
      }),
    ).toBe("田中、佐藤");
    expect(
      readPropertyValue({
        type: "files",
        files: [{ name: "見積.pdf" }, { name: "図面.png" }],
      }),
    ).toBe("見積.pdf、図面.png");
  });

  it("flattens relation to its linked ids", () => {
    expect(
      readPropertyValue({ type: "relation", relation: [{ id: "a1" }, { id: "b2" }] }),
    ).toBe("a1、b2");
  });

  it("stringifies formula and rollup inner values", () => {
    expect(
      readPropertyValue({ type: "formula", formula: { type: "number", number: 42 } }),
    ).toBe("42");
    expect(
      readPropertyValue({ type: "formula", formula: { type: "string", string: "OK" } }),
    ).toBe("OK");
    expect(
      readPropertyValue({
        type: "formula",
        formula: { type: "date", date: { start: "2024-01-02T00:00:00.000Z" } },
      }),
    ).toBe("2024-01-02");
    expect(
      readPropertyValue({ type: "rollup", rollup: { type: "number", number: 3 } }),
    ).toBe("3");
    expect(
      readPropertyValue({
        type: "rollup",
        rollup: {
          type: "array",
          array: [
            { type: "title", title: [{ plain_text: "X" }] },
            { type: "number", number: 7 },
          ],
        },
      }),
    ).toBe("X、7");
  });

  it("returns null for every empty value", () => {
    expect(readPropertyValue({ type: "title", title: [] })).toBeNull();
    expect(readPropertyValue({ type: "rich_text", rich_text: [] })).toBeNull();
    expect(readPropertyValue({ type: "number", number: null })).toBeNull();
    expect(readPropertyValue({ type: "select", select: null })).toBeNull();
    expect(readPropertyValue({ type: "status", status: null })).toBeNull();
    expect(readPropertyValue({ type: "multi_select", multi_select: [] })).toBeNull();
    expect(readPropertyValue({ type: "date", date: null })).toBeNull();
    expect(readPropertyValue({ type: "checkbox", checkbox: null })).toBeNull();
    expect(readPropertyValue({ type: "email", email: null })).toBeNull();
    expect(readPropertyValue({ type: "phone_number", phone_number: "" })).toBeNull();
    expect(readPropertyValue({ type: "url", url: null })).toBeNull();
    expect(readPropertyValue({ type: "people", people: [] })).toBeNull();
    expect(readPropertyValue({ type: "files", files: [] })).toBeNull();
    expect(readPropertyValue({ type: "relation", relation: [] })).toBeNull();
    expect(readPropertyValue({ type: "formula", formula: null })).toBeNull();
    expect(readPropertyValue({ type: "rollup", rollup: {} })).toBeNull();
  });

  it("returns null (never throws) for malformed or missing shapes", () => {
    const hostile: unknown[] = [
      undefined,
      null,
      "",
      0,
      [],
      {},
      { type: "title" },
      { type: "title", title: "not-an-array" },
      { type: "number", number: "1,200" },
      { type: "number", number: Number.NaN },
      { type: "select", select: "進行中" },
      { type: "multi_select", multi_select: { name: "A" } },
      { type: "multi_select", multi_select: [null, 3, { nope: 1 }] },
      { type: "date", date: { start: 20240305 } },
      { type: "date", date: { start: "not a date" } },
      { type: "checkbox", checkbox: "true" },
      { type: "people", people: "田中" },
      { type: "relation", relation: [{}, null] },
      { type: "formula", formula: { type: "date", date: null } },
      { type: "rollup", rollup: { type: "unknown" } },
      { type: 12345 },
      { type: "future_type_we_dont_know" },
    ];
    for (const prop of hostile) {
      expect(() => readPropertyValue(prop)).not.toThrow();
      expect(readPropertyValue(prop)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// notionSelectOptions / notionFields
// ---------------------------------------------------------------------------

describe("notionSelectOptions", () => {
  it("builds options from a select property", () => {
    expect(
      notionSelectOptions({
        id: "x",
        type: "select",
        select: {
          options: [
            { id: "1", name: "見込み", color: "blue" },
            { id: "2", name: "受注", color: "green" },
          ],
        },
      }),
    ).toEqual([
      { label: "見込み", value: "見込み", color: "info" },
      { label: "受注", value: "受注", color: "success" },
    ]);
  });

  it("builds options from a multi_select property", () => {
    expect(
      notionSelectOptions({
        type: "multi_select",
        multi_select: { options: [{ name: "重要" }, { name: "保留" }] },
      }),
    ).toEqual([
      { label: "重要", value: "重要" },
      { label: "保留", value: "保留" },
    ]);
  });

  it("returns [] for other property types and junk", () => {
    expect(notionSelectOptions({ type: "number", number: { format: "yen" } })).toEqual([]);
    expect(notionSelectOptions({ type: "rich_text", rich_text: {} })).toEqual([]);
    expect(notionSelectOptions({ type: "select" })).toEqual([]);
    expect(notionSelectOptions({ type: "select", select: { options: null } })).toEqual([]);
    expect(notionSelectOptions(null)).toEqual([]);
    expect(notionSelectOptions("select")).toEqual([]);
  });
});

describe("notionFields", () => {
  const database = {
    object: "database",
    id: "db-1",
    title: [{ plain_text: "顧客" }],
    properties: {
      売上: { id: "a", type: "number", number: { format: "yen" } },
      ステータス: {
        id: "b",
        type: "select",
        select: { options: [{ name: "見込み", color: "blue" }] },
      },
      名前: { id: "c", type: "title", title: {} },
      期日: { id: "d", type: "date", date: {} },
    },
  };

  it("puts the title property first and maps every type", () => {
    const fields = notionFields(database);
    expect(fields.map((f) => f.notionName)).toEqual([
      "名前",
      "売上",
      "ステータス",
      "期日",
    ]);
    expect(fields.map((f) => f.type)).toEqual(["text", "number", "select", "date"]);
    expect(fields[2].options).toEqual([
      { label: "見込み", value: "見込み", color: "info" },
    ]);
    // Every field has a non-empty, unique machine key.
    const keys = fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.length > 0)).toBe(true);
  });

  it("returns [] for a database with no usable schema", () => {
    expect(notionFields(null)).toEqual([]);
    expect(notionFields({})).toEqual([]);
    expect(notionFields({ properties: null })).toEqual([]);
    expect(notionFields({ properties: { bad: "nope" } })).toEqual([]);
  });

  it("reads the database title, falling back to 無題", () => {
    expect(databaseTitle(database)).toBe("顧客");
    expect(databaseTitle({ title: [] })).toBe("無題");
    expect(databaseTitle(null)).toBe("無題");
  });
});

// ---------------------------------------------------------------------------
// listDatabases
// ---------------------------------------------------------------------------

describe("listDatabases", () => {
  it("maps search results to id/title/url", async () => {
    const fetchMock = mockFetch(
      jsonResponse({
        results: [
          {
            object: "database",
            id: "db-1",
            title: [{ plain_text: "顧客" }, { plain_text: "台帳" }],
            url: "https://notion.so/db-1",
          },
          { object: "database", id: "db-2", title: [], url: "https://notion.so/db-2" },
        ],
      }),
    );

    const list = await listDatabases(TOKEN);
    expect(list).toEqual([
      { id: "db-1", title: "顧客台帳", url: "https://notion.so/db-1" },
      { id: "db-2", title: "無題", url: "https://notion.so/db-2" },
    ]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.notion.com/v1/search");
    expect(init.method).toBe("POST");
    expect(init.headers["Notion-Version"]).toBe("2022-06-28");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({
      filter: { value: "database", property: "object" },
      page_size: 100,
    });
  });

  it("survives hostile response bodies", async () => {
    const bodies: unknown[] = [
      {},
      { results: null },
      { results: "nope" },
      { results: [null, 3, "x", []] },
      { results: [{ id: 7 }, { object: "page", id: "p1" }] },
      { results: [{ id: "db", title: "not-an-array", url: 42 }] },
      { results: [{ id: "db", title: [{ nope: true }, null] }] },
      [1, 2, 3],
    ];
    for (const body of bodies) {
      mockFetch(jsonResponse(body));
      await expect(listDatabases(TOKEN)).resolves.toBeInstanceOf(Array);
    }
    // Non-JSON body (HTML) on a 200 must not throw either.
    mockFetch(brokenResponse(200));
    await expect(listDatabases(TOKEN)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fetchDatabase
// ---------------------------------------------------------------------------

describe("fetchDatabase", () => {
  it("GETs the database endpoint", async () => {
    const fetchMock = mockFetch(jsonResponse({ id: "db-1", properties: {} }));
    const db = await fetchDatabase(TOKEN, "db-1");
    expect(db.id).toBe("db-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.notion.com/v1/databases/db-1");
    expect(init.method).toBe("GET");
  });

  it("rejects an empty database id without calling the API", async () => {
    const fetchMock = mockFetch(jsonResponse({}));
    await expect(fetchDatabase(TOKEN, "  ")).rejects.toThrow(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// queryDatabase — pagination and caps
// ---------------------------------------------------------------------------

describe("queryDatabase", () => {
  it("follows has_more / next_cursor across pages", async () => {
    const fetchMock = mockFetch(
      queryPage(100, true, "cursor-1"),
      queryPage(20, false, null),
    );

    const result = await queryDatabase(TOKEN, "db-1");
    expect(result.pages).toHaveLength(120);
    expect(result.truncated).toBe(false);
    expect(result.stoppedBy).toBe("complete");
    expect(truncationMessage(result)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.page_size).toBe(100);
    expect(firstBody.start_cursor).toBeUndefined();
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.start_cursor).toBe("cursor-1");
  });

  it("stops at maxRows and truncates the last page", async () => {
    const fetchMock = mockFetch(queryPage(100, true, "cursor-1"));
    const result = await queryDatabase(TOKEN, "db-1", { maxRows: 30 });
    expect(result.pages).toHaveLength(30);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).page_size).toBe(30);
  });

  it("never exceeds the default row cap", async () => {
    // Always "one more page" — only DEFAULT_MAX_ROWS may come back.
    mockFetch(queryPage(100, true, "cursor-1"));
    const result = await queryDatabase(TOKEN, "db-1", { maxRows: 999_999 });
    expect(result.pages.length).toBeLessThanOrEqual(DEFAULT_MAX_ROWS);
  });

  it("stops at the page cap for a database that never ends", async () => {
    // 1 row per page, always has_more: rows can never hit maxRows, so only the
    // page cap can stop the loop.
    const fetchMock = mockFetch(queryPage(1, true, "cursor-1"));
    const result = await queryDatabase(TOKEN, "db-1", { maxRows: DEFAULT_MAX_ROWS });
    expect(fetchMock).toHaveBeenCalledTimes(MAX_QUERY_PAGES);
    expect(result.pages).toHaveLength(MAX_QUERY_PAGES);
  });

  it("survives hostile query bodies that are still recognisable pages", async () => {
    const bodies: unknown[] = [
      { results: [], has_more: "yes" },
      { results: [null, "x", 1], has_more: false },
      { results: [{ id: "p1" }], has_more: true, next_cursor: null },
      { results: [{ id: "p1", properties: null }], has_more: false },
    ];
    for (const body of bodies) {
      mockFetch(jsonResponse(body));
      const result = await queryDatabase(TOKEN, "db-1");
      expect(Array.isArray(result.pages)).toBe(true);
    }
  });

  it("refuses a query page with no results array instead of calling it the end", async () => {
    // results が配列でない応答を `[]` と同一視すると has_more も消え、
    // 「きれいに読み切った」と誤って報告される。
    const bodies: unknown[] = [
      {},
      { results: null, has_more: true, next_cursor: "x" },
      { results: {}, has_more: true, next_cursor: "x" },
      "<!doctype html>",
      null,
    ];
    for (const body of bodies) {
      mockFetch(jsonResponse(body));
      const err = await queryDatabase(TOKEN, "db-1").catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(502);
      expect(err.message).toContain("行データ");
    }
  });
});

// ---------------------------------------------------------------------------
// F2 — truncation must never be silent
// ---------------------------------------------------------------------------

describe("queryDatabase truncation reporting", () => {
  it("reports the row cap, with a Japanese message naming the cap and the rows kept", async () => {
    // 5,000行のデータベースを2,000行で打ち切る典型ケース。
    mockFetch(queryPage(100, true, "cursor-1"));
    const result = await queryDatabase(TOKEN, "db-1", { maxRows: DEFAULT_MAX_ROWS });

    expect(result.pages).toHaveLength(DEFAULT_MAX_ROWS);
    expect(result.truncated).toBe(true);
    expect(result.stoppedBy).toBe("maxRows");
    expect(result.limit).toBe(DEFAULT_MAX_ROWS);

    const message = truncationMessage(result);
    expect(message).not.toBeNull();
    expect(message).toContain("2,000");
    expect(message).toContain("取り込まれていません");
  });

  it("reports the page cap separately from the row cap", async () => {
    mockFetch(queryPage(1, true, "cursor-1"));
    const result = await queryDatabase(TOKEN, "db-1");
    expect(result.truncated).toBe(true);
    expect(result.stoppedBy).toBe("maxPages");
    expect(truncationMessage(result)).toContain(String(MAX_QUERY_PAGES));
  });

  it("does not cry truncation when the last page lands exactly on maxRows", async () => {
    // ちょうど上限で本当に終わっている場合まで警告するとノイズになる。
    mockFetch(queryPage(30, false, null));
    const result = await queryDatabase(TOKEN, "db-1", { maxRows: 30 });
    expect(result.pages).toHaveLength(30);
    expect(result.truncated).toBe(false);
    expect(result.stoppedBy).toBe("maxRows");
    expect(truncationMessage(result)).toBeNull();
  });

  it("marks a database read in full as complete", async () => {
    mockFetch(queryPage(10, false, null));
    const result = await queryDatabase(TOKEN, "db-1");
    expect(result.truncated).toBe(false);
    expect(result.stoppedBy).toBe("complete");
    expect(truncationMessage(result)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F6 — an overall request budget
// ---------------------------------------------------------------------------

/** 中断されるまで永久に解決しないfetch（＝本当にタイムアウトする問い合わせ）。 */
function abortingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_input: unknown, init?: { signal?: AbortSignal }): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        signal.addEventListener("abort", () => {
          // AbortSignal.timeout が投げるのと同じ形。
          const err = new Error("The operation was aborted due to timeout");
          err.name = "TimeoutError";
          reject(err);
        });
      }),
  );
}

/** 本文の生成に実時間を使うページ（締め切りを跨がせるため）。 */
function slowQueryPage(delayMs: number): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        results: [{ object: "page", id: "p1", properties: {} }],
        has_more: true,
        next_cursor: "cursor-1",
      };
    },
    text: async () => "",
  } as unknown as Response;
}

describe("import budget", () => {
  it("does not start a page it cannot finish, and reports the deadline", async () => {
    // 残り時間がわずかなまま次のページを取りに行くと、`notionFetch` はその
    // 残り時間でタイムアウトし、例外がここまでの行を巻き添えにする。
    // 2ページ目は「絶対に返ってこない」応答にしてあり、始めた時点で全滅する。
    const fetchMock = abortingFetch();
    fetchMock.mockResolvedValueOnce(slowQueryPage(120));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await queryDatabase(TOKEN, "db-1", {
      deadlineAt: Date.now() + MIN_QUERY_SLICE_MS + 50,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.pages).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.stoppedBy).toBe("deadline");
    expect(truncationMessage(result)).toContain("制限時間");
  });

  it("keeps the rows already read when a page is aborted at the deadline", async () => {
    // 締め切りぎりぎりで始まったページが実際に中断されるケース。以前は
    // TimeoutError がそのまま上がり、読めていた100行ごと捨てて504になった。
    const fetchMock = abortingFetch();
    fetchMock.mockResolvedValueOnce(queryPage(100, true, "cursor-1"));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await queryDatabase(TOKEN, "db-1", {
      deadlineAt: Date.now() + MIN_QUERY_SLICE_MS + 400,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.pages).toHaveLength(100);
    expect(result.truncated).toBe(true);
    expect(result.stoppedBy).toBe("deadline");
  });

  it("fails instead of returning an empty success when no page fits the budget", async () => {
    // 1行も読めていないのに「打ち切り」として成功を返すと、空のスプレッドシートが
    // できてしまう。ここはエラーで伝える。
    const fetchMock = mockFetch(queryPage(1, false, null));
    const err = await queryDatabase(TOKEN, "db-1", {
      deadlineAt: Date.now() + 5,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(504);
    expect(err.message).toContain("制限時間");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to start a request whose budget is already spent", async () => {
    const fetchMock = mockFetch(jsonResponse({ results: [] }));
    const err = await fetchDatabase(TOKEN, "db-1", {
      deadlineAt: Date.now() - 1,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(504);
    expect(err.message).toContain("制限時間");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the budget under the route's maxDuration", () => {
    expect(NOTION_IMPORT_BUDGET_MS).toBeLessThan(MAX_QUERY_PAGES * 15_000);
  });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe("error mapping", () => {
  const cases: Array<[number, number, string]> = [
    [401, 401, "Notionのトークンが無効です。"],
    [
      404,
      404,
      "データベースが見つかりません。インテグレーションに共有されているか確認してください。",
    ],
    [429, 429, "Notion側のレート制限です。しばらくして再度お試しください。"],
  ];

  for (const [httpStatus, apiStatus, message] of cases) {
    it(`maps HTTP ${httpStatus} to a Japanese ApiError`, async () => {
      mockFetch(jsonResponse({ object: "error", status: httpStatus }, httpStatus));
      const err = await listDatabases(TOKEN).catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(apiStatus);
      expect(err.message).toBe(message);
    });
  }

  it("maps HTTP 500 to a generic Japanese error carrying the status", async () => {
    mockFetch(jsonResponse({ object: "error" }, 500));
    const err = await queryDatabase(TOKEN, "db-1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.message).toContain("500");
    expect(err.message).toContain("Notion");
  });

  it("maps 403 to the sharing hint", () => {
    const err = notionError(403);
    expect(err.status).toBe(403);
    expect(err.message).toContain("共有");
  });

  it("turns an HTML error page into the status-based message", async () => {
    mockFetch(brokenResponse(502));
    const err = await fetchDatabase(TOKEN, "db-1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toContain("Notion");
  });

  it("turns a timeout into a Japanese error, not a raw AbortError", async () => {
    const abort = new Error("The operation timed out.");
    abort.name = "TimeoutError";
    global.fetch = vi.fn().mockRejectedValue(abort) as unknown as typeof fetch;

    const err = await listDatabases(TOKEN).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe("ApiError");
    expect(err.status).toBe(504);
    expect(err.message).toBe(
      "Notionへの接続がタイムアウトしました。時間をおいて再度お試しください。",
    );
  });

  it("turns an AbortError into the same Japanese timeout error", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    global.fetch = vi.fn().mockRejectedValue(abort) as unknown as typeof fetch;
    const err = await queryDatabase(TOKEN, "db-1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(504);
  });

  it("turns a DNS/connection failure into a Japanese error", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;
    const err = await listDatabases(TOKEN).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.message).toContain("Notion");
  });
});

// ---------------------------------------------------------------------------
// F1 — a body read that never finished must never look like an empty success
// ---------------------------------------------------------------------------

/** A 200 whose body read rejects — the timeout firing after the headers. */
function bodyFailsResponse(err: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => {
      throw err;
    },
    text: async () => "",
  } as unknown as Response;
}

function namedError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("notionFetch body reads", () => {
  it("fails the whole query when a later page times out mid-body", async () => {
    // 30ページ中の途中でタイムアウト。以前はここで `{}` になり、has_more が
    // undefined になってループが静かに終わり、部分インポートが「完了」になった。
    const fetchMock = mockFetch(
      queryPage(100, true, "cursor-1"),
      bodyFailsResponse(namedError("TimeoutError", "The operation timed out.")),
    );

    const err = await queryDatabase(TOKEN, "db-1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(504);
    expect(err.message).toBe(
      "Notionへの接続がタイムアウトしました。時間をおいて再度お試しください。",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("turns an aborted body read into the Japanese timeout error", async () => {
    mockFetch(bodyFailsResponse(namedError("AbortError", "aborted")));
    const err = await fetchDatabase(TOKEN, "db-1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(504);
  });

  it("throws — not {} — when the body is truncated mid-stream", async () => {
    // undici の途中切断は TypeError("terminated")。構文エラーではない以上、
    // 中身が全部届いた保証はないので成功扱いにしてはいけない。
    mockFetch(bodyFailsResponse(new TypeError("terminated")));
    const err = await fetchDatabase(TOKEN, "db-1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.message).toContain("途中で切断");
  });

  it("still treats a genuine non-JSON body as an empty object", async () => {
    // 本文は最後まで届いており「JSONではない」と分かる。ここは従来どおり {}。
    // ——ただし「情報なし」として扱える呼び出し側（422にする fetchDatabase、
    // 空一覧にする listDatabases）に限る。
    mockFetch(brokenResponse(200));
    await expect(fetchDatabase(TOKEN, "db-1")).resolves.toEqual({});
  });

  it("still treats a genuine non-JSON body as an empty database list", async () => {
    mockFetch(brokenResponse(200));
    await expect(listDatabases(TOKEN)).resolves.toEqual([]);
  });

  it("never accepts that same empty object as a query page", async () => {
    // WAF/Cloudflareの割り込みは「HTTP 200＋HTMLの本文」で来る。30ページ中の
    // 5ページ目がこれになると、{} は results なし＝has_more なしと同じに見え、
    // 400行だけの取り込みが truncated:false の「完了」として確定してしまう。
    const fetchMock = mockFetch(
      queryPage(100, true, "cursor-1"),
      brokenResponse(200),
    );

    const err = await queryDatabase(TOKEN, "db-1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.message).toContain("行データ");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Import route — F1 / F2 / F5 / F6
// ---------------------------------------------------------------------------

interface RouteUser {
  id: string;
  workspace: { id: string; plan: string };
}
interface RouteOk {
  ok: true;
  data: Record<string, unknown>;
}
type RouteHandler = (
  req: { json: () => Promise<unknown> },
  ctx: { user: RouteUser; params: Record<string, string> },
) => Promise<RouteOk>;

async function loadRoute(): Promise<{
  handler: RouteHandler;
  maxDuration: number;
}> {
  const mod = await import("@/app/api/import/notion/route");
  return {
    handler: mod.POST as unknown as RouteHandler,
    maxDuration: mod.maxDuration,
  };
}

function dbSchema(): Response {
  return jsonResponse({
    object: "database",
    id: "db-1",
    title: [{ plain_text: "顧客" }],
    properties: { 名前: { id: "t", type: "title", title: {} } },
  });
}

const routeReq = { json: async () => ({ databaseId: "db-1" }) };

function routeCtx(plan: string): { user: RouteUser; params: Record<string, string> } {
  return {
    user: { id: "u-1", workspace: { id: "ws-1", plan } },
    params: {},
  };
}

describe("POST /api/import/notion", () => {
  beforeEach(() => {
    const all = [
      mocks.db.collection.findMany,
      mocks.db.collection.create,
      mocks.db.collection.delete,
      mocks.db.workbook.create,
      mocks.db.workbook.delete,
      mocks.db.record.createMany,
      mocks.db.$transaction,
      mocks.logActivity,
      mocks.assertCanCreateCollection,
      mocks.getSecret,
      mocks.recordResult,
    ];
    for (const fn of all) fn.mockReset();

    mocks.getSecret.mockResolvedValue(TOKEN);
    mocks.assertCanCreateCollection.mockResolvedValue(undefined);
    mocks.recordResult.mockResolvedValue(undefined);
    mocks.logActivity.mockResolvedValue(undefined);
    mocks.db.collection.findMany.mockResolvedValue([]);
    mocks.db.workbook.create.mockResolvedValue({ id: "wb-1" });
    mocks.db.collection.create.mockResolvedValue({ id: "col-1" });
    mocks.db.record.createMany.mockResolvedValue({ count: 0 });
    mocks.db.$transaction.mockResolvedValue([]);
    mocks.db.collection.delete.mockResolvedValue({});
    mocks.db.workbook.delete.mockResolvedValue({});
  });

  it("F1: a timeout mid-pagination fails the import instead of committing part of it", async () => {
    mockFetch(
      dbSchema(),
      queryPage(100, true, "cursor-1"),
      bodyFailsResponse(namedError("TimeoutError", "timed out")),
    );
    const { handler } = await loadRoute();

    const err = await handler(routeReq, routeCtx("business")).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(504);
    // 何も書き込まれていないこと（＝「部分インポートの完了」になっていない）。
    expect(mocks.db.workbook.create).not.toHaveBeenCalled();
    expect(mocks.db.collection.create).not.toHaveBeenCalled();
    expect(mocks.recordResult).toHaveBeenCalledWith("ws-1", "notion", false, err.message);
  });

  it("F1: an HTML interstitial on a later page fails the import instead of committing part of it", async () => {
    // 200＋HTML本文。以前はこのページが「空の最終ページ」に化け、100行だけの
    // 取り込みが warning なし・truncated:false で成功していた。
    mockFetch(dbSchema(), queryPage(100, true, "cursor-1"), brokenResponse(200));
    const { handler } = await loadRoute();

    const err = await handler(routeReq, routeCtx("business")).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(mocks.db.workbook.create).not.toHaveBeenCalled();
    expect(mocks.db.collection.create).not.toHaveBeenCalled();
    expect(mocks.recordResult).toHaveBeenCalledWith("ws-1", "notion", false, err.message);
  });

  it("F2: surfaces truncation in the response and in the activity log", async () => {
    // 常に has_more のデータベース → 2,000行で打ち切られる。
    mockFetch(dbSchema(), queryPage(100, true, "cursor-1"));
    const { handler } = await loadRoute();

    const res = await handler(routeReq, routeCtx("business"));
    expect(res.ok).toBe(true);
    expect(res.data.imported).toBe(DEFAULT_MAX_ROWS);
    expect(res.data.truncated).toBe(true);
    expect(res.data.truncationReason).toBe("maxRows");
    expect(String(res.data.warning)).toContain("2,000");
    expect(String(res.data.warning)).toContain("取り込まれていません");

    const logged = mocks.logActivity.mock.calls.find(
      (call) => call[1] === "import.completed",
    );
    expect(logged).toBeDefined();
    expect(logged?.[2].truncated).toBe(true);
    expect(logged?.[2].truncationReason).toBe("maxRows");
    expect(String(logged?.[2].truncationMessage)).toContain("2,000");
  });

  it("F2: reports a fully-read database as untruncated with no warning", async () => {
    mockFetch(dbSchema(), queryPage(3, false, null));
    const { handler } = await loadRoute();

    const res = await handler(routeReq, routeCtx("business"));
    expect(res.data.imported).toBe(3);
    // 「3件読んだ」と「3件書いた」は別の話。imported は読み取った件数から
    // 作っているので、書き込み側で行が落ちても気づけない——実際に
    // createMany に渡した行数まで見る（1バッチ＝1文なので、呼び出しを
    // またいで数える）。
    const written = mocks.db.record.createMany.mock.calls.flatMap(
      (call) => (call[0] as { data: unknown[] }).data,
    );
    expect(written).toHaveLength(3);
    expect(res.data.truncated).toBe(false);
    expect(res.data.warning).toBeNull();
  });

  it("F5: keeps the workbook when the collection delete fails, and says cleanup failed", async () => {
    mockFetch(dbSchema(), queryPage(2, false, null));
    mocks.db.record.createMany.mockRejectedValue(new Error("db is gone"));
    mocks.db.collection.delete.mockRejectedValue(new Error("delete failed"));
    const { handler } = await loadRoute();

    const err = await handler(routeReq, routeCtx("business")).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    // Collection.workbookId は SetNull。Collection を消せていない以上、
    // Workbook を消すと中途半端なシートが独立して残る。
    expect(mocks.db.collection.delete).toHaveBeenCalledTimes(1);
    expect(mocks.db.workbook.delete).not.toHaveBeenCalled();
    // 残っているのは中途半端なスプレッドシート。案内先はスプレッドシート一覧。
    expect(err.message).toContain("スプレッドシート一覧");
    expect(err.message).toContain("削除できませんでした");
  });

  it("F5: when only an empty workbook survives, says so instead of sending the user to the sheet list", async () => {
    // Collection は消せている＝行は1件も残っていない。残骸は空のファイルだけ。
    // 「スプレッドシート一覧をご確認ください」と案内すると、存在しないシートを
    // 探させることになる。
    mockFetch(dbSchema(), queryPage(2, false, null));
    mocks.db.record.createMany.mockRejectedValue(new Error("db is gone"));
    mocks.db.workbook.delete.mockRejectedValue(new Error("delete failed"));
    const { handler } = await loadRoute();

    const err = await handler(routeReq, routeCtx("business")).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(mocks.db.collection.delete).toHaveBeenCalledTimes(1);
    expect(mocks.db.workbook.delete).toHaveBeenCalledTimes(1);
    expect(err.message).toContain("空のファイル");
    expect(err.message).not.toContain("スプレッドシート一覧");
  });

  it("F5: when the collection was never created, the leftover is still only an empty workbook", async () => {
    mockFetch(dbSchema(), queryPage(2, false, null));
    mocks.db.collection.create.mockRejectedValue(new Error("create failed"));
    mocks.db.workbook.delete.mockRejectedValue(new Error("delete failed"));
    const { handler } = await loadRoute();

    const err = await handler(routeReq, routeCtx("business")).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(mocks.db.collection.delete).not.toHaveBeenCalled();
    expect(err.message).toContain("空のファイル");
    expect(err.message).not.toContain("スプレッドシート一覧");
  });

  it("F5: deletes the workbook only after the collection delete succeeded", async () => {
    mockFetch(dbSchema(), queryPage(2, false, null));
    mocks.db.record.createMany.mockRejectedValue(new Error("db is gone"));
    const { handler } = await loadRoute();

    const err = await handler(routeReq, routeCtx("business")).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(mocks.db.collection.delete).toHaveBeenCalledWith({
      where: { id: "col-1" },
    });
    expect(mocks.db.workbook.delete).toHaveBeenCalledWith({
      where: { id: "wb-1" },
    });
    expect(err.message).not.toContain("削除できませんでした");
    expect(err.message).not.toContain("空のファイル");
  });

  it("F6: exports a maxDuration that covers the Notion read budget", async () => {
    const { maxDuration } = await loadRoute();
    expect(typeof maxDuration).toBe("number");
    expect(maxDuration * 1000).toBeGreaterThan(NOTION_IMPORT_BUDGET_MS);
  });
});

// ---------------------------------------------------------------------------
// ImportWizard — F2 (warning display), F4 (dead ends), F7 (source race)
// ---------------------------------------------------------------------------

/** A `fetch` mock that answers by URL. */
function wizardFetch(impl: (url: string) => Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn((input: unknown) => Promise.resolve(impl(String(input))));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const DB_LIST_URL = "/api/integrations/notion/databases";

describe("ImportWizard — Notion source", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.refresh.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("F4: offers a retry when the workspace can see no databases", async () => {
    const fetchMock = wizardFetch(() =>
      jsonResponse({ ok: true, data: { databases: [] } }),
    );
    render(createElement(ImportWizard));

    fireEvent.click(screen.getByRole("button", { name: "データベースを読み込む" }));
    const retry = await screen.findByRole("button", { name: "再読み込み" });

    // Notion側で共有し直した直後に、画面をリロードせず読み直せること。
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).toContain(DB_LIST_URL);
  });

  it("F4: offers a retry when Notion is not connected yet", async () => {
    const fetchMock = wizardFetch(() =>
      jsonResponse({ ok: false, error: "Notionが接続されていません。" }, 400),
    );
    render(createElement(ImportWizard));

    fireEvent.click(screen.getByRole("button", { name: "データベースを読み込む" }));
    const retry = await screen.findByRole("button", { name: "再読み込み" });
    expect(screen.getByText("Notionを接続してください")).toBeInTheDocument();

    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("F7: an ok envelope with no data does not blow up the list", async () => {
    wizardFetch(() => jsonResponse({ ok: true }));
    render(createElement(ImportWizard));

    fireEvent.click(screen.getByRole("button", { name: "データベースを読み込む" }));
    await screen.findByRole("button", { name: "再読み込み" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("F7: disables the file and Google Sheets sources while a Notion import runs", async () => {
    let releaseImport: (() => void) | null = null;
    const fn = vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes(DB_LIST_URL)) {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            data: { databases: [{ id: "db-1", title: "顧客", url: "u" }] },
          }),
        );
      }
      // 取り込みは解決させない — 「実行中」の状態を観察する。
      return new Promise<Response>((resolve) => {
        releaseImport = () =>
          resolve(jsonResponse({ ok: true, data: { collectionId: "col-1" } }));
      });
    });
    global.fetch = fn as unknown as typeof fetch;

    render(createElement(ImportWizard));
    fireEvent.click(screen.getByRole("button", { name: "データベースを読み込む" }));
    const runButton = await screen.findByRole("button", { name: /取り込む/ });
    fireEvent.click(runButton);

    const gsheetsInput = await screen.findByPlaceholderText(
      "https://docs.google.com/spreadsheets/d/…",
    );
    await waitFor(() => expect(gsheetsInput).toBeDisabled());
    expect(screen.getByRole("button", { name: "読み込む" })).toBeDisabled();
    // ドロップゾーンも操作できないこと（触れるとmapステップへ移り、
    // 解決したNotion取り込みのrouter.pushで入力が消える）。
    const dropzone = screen
      .getByText("ファイルをドラッグ＆ドロップ")
      .closest("[role='button']");
    expect(dropzone).toHaveAttribute("aria-disabled", "true");
    expect(releaseImport).not.toBeNull();
  });

  it("F2: shows the truncation warning instead of navigating away", async () => {
    wizardFetch((url) =>
      url.includes(DB_LIST_URL)
        ? jsonResponse({
            ok: true,
            data: { databases: [{ id: "db-1", title: "顧客", url: "u" }] },
          })
        : jsonResponse({
            ok: true,
            data: {
              collectionId: "col-1",
              truncated: true,
              warning: "1回の取り込みで読み込める上限（2,000行）に達したため…",
            },
          }),
    );
    render(createElement(ImportWizard));

    fireEvent.click(screen.getByRole("button", { name: "データベースを読み込む" }));
    fireEvent.click(await screen.findByRole("button", { name: /取り込む/ }));

    // 自動遷移すると警告ごと消え、「全行入った」と誤解される。
    const warning = await screen.findByRole("status");
    expect(warning.textContent).toContain("2,000行");
    expect(mocks.push).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "取り込んだスプレッドシートを開く" }),
    );
    expect(mocks.push).toHaveBeenCalledWith("/c/col-1");
  });

  it("F3: refuses to re-run the same database after a truncated import", async () => {
    const fetchMock = wizardFetch((url) =>
      url.includes(DB_LIST_URL)
        ? jsonResponse({
            ok: true,
            data: {
              databases: [
                { id: "db-1", title: "顧客", url: "u" },
                { id: "db-2", title: "案件", url: "u2" },
              ],
            },
          })
        : jsonResponse({
            ok: true,
            data: {
              collectionId: "col-1",
              truncated: true,
              warning: "1回の取り込みで読み込める上限（2,000行）に達したため…",
            },
          }),
    );
    render(createElement(ImportWizard));

    fireEvent.click(screen.getByRole("button", { name: "データベースを読み込む" }));
    const runButton = await screen.findByRole("button", { name: /取り込む/ });
    fireEvent.click(runButton);
    await screen.findByRole("status");

    // 押せたままだと、同じ先頭2,000行のスプレッドシートがもう1枚できるだけで、
    // 最初の取り込みへの唯一のリンク（警告＋開くボタン）も消える。
    const importCalls = () =>
      fetchMock.mock.calls.filter((c) => !String(c[0]).includes(DB_LIST_URL)).length;
    await waitFor(() => expect(runButton).toBeDisabled());
    fireEvent.click(runButton);
    expect(importCalls()).toBe(1);
    expect(
      screen.getByRole("button", { name: "取り込んだスプレッドシートを開く" }),
    ).toBeInTheDocument();

    // 再実行しても続きは取れない、と明言していること。
    const warning = screen.getByRole("status");
    expect(warning.textContent).toContain("取り込めなかった行は取得されません");

    // 別のデータベースを選べば取り込みは再開できる。
    fireEvent.change(screen.getByLabelText("データベース"), {
      target: { value: "db-2" },
    });
    await waitFor(() => expect(runButton).not.toBeDisabled());
  });

  it("F4: blocks the Notion import while a Google Sheets URL is being parsed", async () => {
    let releaseGsheets: (() => void) | null = null;
    const fn = vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes(DB_LIST_URL)) {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            data: { databases: [{ id: "db-1", title: "顧客", url: "u" }] },
          }),
        );
      }
      if (url.includes("/api/import/gsheets/preview")) {
        // 解析を解決させない — 「読み込み中」の状態を観察する。
        return new Promise<Response>((resolve) => {
          releaseGsheets = () => resolve(jsonResponse({ ok: true, data: { sheets: [] } }));
        });
      }
      return Promise.resolve(jsonResponse({ ok: true, data: { collectionId: "col-1" } }));
    });
    global.fetch = fn as unknown as typeof fetch;

    render(createElement(ImportWizard));
    fireEvent.click(screen.getByRole("button", { name: "データベースを読み込む" }));
    const runButton = await screen.findByRole("button", { name: /取り込む/ });

    fireEvent.change(
      screen.getByPlaceholderText("https://docs.google.com/spreadsheets/d/…"),
      { target: { value: "https://docs.google.com/spreadsheets/d/abc/edit" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "読み込む" }));

    // Notion側が先に終わると router.push で画面を奪い、解析中のSheetsが消える。
    await waitFor(() => expect(runButton).toBeDisabled());
    fireEvent.click(runButton);
    expect(
      fn.mock.calls.some((c) => String(c[0]).includes("/api/import/notion")),
    ).toBe(false);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(releaseGsheets).not.toBeNull();
  });
});
