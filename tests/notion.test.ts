/**
 * Notion client + property-mapping tests.
 *
 * `global.fetch` is mocked throughout: no network, no token, no Prisma. The
 * emphasis is on the two things that break real imports — hostile/partial API
 * responses, and failures that must surface as Japanese ApiErrors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  MAX_QUERY_PAGES,
  DEFAULT_MAX_ROWS,
} from "@/lib/notion";

const TOKEN = "secret_test_token_0123456789";

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

    const rows = await queryDatabase(TOKEN, "db-1");
    expect(rows).toHaveLength(120);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.page_size).toBe(100);
    expect(firstBody.start_cursor).toBeUndefined();
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.start_cursor).toBe("cursor-1");
  });

  it("stops at maxRows and truncates the last page", async () => {
    const fetchMock = mockFetch(queryPage(100, true, "cursor-1"));
    const rows = await queryDatabase(TOKEN, "db-1", { maxRows: 30 });
    expect(rows).toHaveLength(30);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).page_size).toBe(30);
  });

  it("never exceeds the default row cap", async () => {
    // Always "one more page" — only DEFAULT_MAX_ROWS may come back.
    mockFetch(queryPage(100, true, "cursor-1"));
    const rows = await queryDatabase(TOKEN, "db-1", { maxRows: 999_999 });
    expect(rows.length).toBeLessThanOrEqual(DEFAULT_MAX_ROWS);
  });

  it("stops at the page cap for a database that never ends", async () => {
    // 1 row per page, always has_more: rows can never hit maxRows, so only the
    // page cap can stop the loop.
    const fetchMock = mockFetch(queryPage(1, true, "cursor-1"));
    const rows = await queryDatabase(TOKEN, "db-1", { maxRows: DEFAULT_MAX_ROWS });
    expect(fetchMock).toHaveBeenCalledTimes(MAX_QUERY_PAGES);
    expect(rows).toHaveLength(MAX_QUERY_PAGES);
  });

  it("survives hostile query bodies", async () => {
    const bodies: unknown[] = [
      {},
      { results: null, has_more: true, next_cursor: "x" },
      { results: {}, has_more: "yes" },
      { results: [null, "x", 1], has_more: false },
      { results: [{ id: "p1" }], has_more: true, next_cursor: null },
      { results: [{ id: "p1", properties: null }], has_more: false },
      "<!doctype html>",
      null,
    ];
    for (const body of bodies) {
      mockFetch(jsonResponse(body));
      const rows = await queryDatabase(TOKEN, "db-1");
      expect(Array.isArray(rows)).toBe(true);
    }
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
