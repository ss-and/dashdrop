/**
 * DataGrid（表計算グリッド）の回帰テスト。
 *
 * 実際に起きていた不具合は 2 つ。どちらも「画面は正しく見えるのに、裏で
 * 別のことをしている」たぐいで、気付きにくいまま出荷されていた。
 *
 * 1) 下書き行（最下段の新規入力行）が「セル 1 つ = 1 レコード」で保存されて
 *    いた。氏名 → Tab → メール → Tab と入れると 2 行できる（5 列なら 5 行）。
 *    セルをクリックして何も入力せずに離れただけでも空の行が 1 行できていた。
 *    さらに、前の POST が終わる前に次のセルを確定すると {A} と {A,B} の
 *    2 行ができた。必須項目のあるシートでは最初の POST が 422 で弾かれるため
 *    症状が隠れており、必須なしで取り込まれたシートだけが直撃していた。
 *    → 行が増える経路は「行を追加」ボタンだけ、というモデルに変えた。
 *
 * 2) 保存に成功したとき data だけを差し替え、computed（計算列）は古いまま
 *    持ち回っていた。粗利 = {売上} - {原価} のシートで売上を直しても、粗利は
 *    再読み込みするまで古い数字を表示し続けていた。追加直後の行も computed が
 *    空で、計算列が「—」のままだった。
 *    → 書き込み後に計算列だけを取り直す（連続編集はまとめて 1 回）。
 *
 * このファイルは .ts なので JSX ではなく createElement で組む
 * （tests/relations-display.test.ts と同じ）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { DataGrid } from "@/components/grid/DataGrid";

/* --------------------------------- 道具 ----------------------------------- */

interface TestField {
  id: string;
  key: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
  config?: unknown;
  position: number;
}

function field(
  key: string,
  name: string,
  type: string,
  extra: Partial<TestField> = {},
): TestField {
  return {
    id: `f-${key}`,
    key,
    name,
    type,
    required: false,
    options: null,
    config: null,
    position: 0,
    ...extra,
  };
}

interface TestRecord {
  id: string;
  data: Record<string, unknown>;
  computed?: Record<string, unknown>;
}

function renderGrid(fields: TestField[], records: TestRecord[] = []) {
  return render(
    createElement(DataGrid, {
      collection: { id: "col-1", template: "custom" },
      fields: fields.map((f, i) => ({ ...f, position: i })),
      initialRecords: records,
      relationLabels: {},
      lookupLabels: {},
      workspaceCollections: [],
    }),
  );
}

/** 行 id と列 key でセル（読み取り時のボタン）を引く。 */
function cell(container: HTMLElement, rowId: string, key: string): HTMLElement {
  const el = container.querySelector(
    `[data-cell-row="${rowId}"][data-cell-key="${key}"]`,
  );
  if (!el) throw new Error(`セルが見つかりません: ${rowId} / ${key}`);
  return el as HTMLElement;
}

const DRAFT = "__draft__";

/** セルを開いて文字を入れ、フォーカスを外して確定する（＝ふつうの入力）。 */
function typeInCell(
  container: HTMLElement,
  rowId: string,
  key: string,
  text: string,
) {
  const td = cell(container, rowId, key).closest("td") as HTMLElement;
  fireEvent.click(td.querySelector("button") as HTMLElement);
  const input = td.querySelector("input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
}

/** レスポンスの体裁だけ整えた偽の Response。 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function okResponse(data: unknown): Response {
  return jsonResponse({ ok: true, data });
}

function errorResponse(message: string, status = 422): Response {
  return jsonResponse({ ok: false, error: message }, status);
}

/** 計算列を取り直す GET への応答。 */
function recordsResponse(records: TestRecord[]): Response {
  return okResponse({
    records,
    relationLabels: {},
    lookupLabels: {},
    nextCursor: null,
  });
}

type FetchCall = { url: string; method: string; body: unknown };

let calls: FetchCall[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = global.fetch;

function installFetch(
  handler: (call: FetchCall) => Response | Promise<Response>,
) {
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return handler(call);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}

const postCalls = () => calls.filter((c) => c.method === "POST");
const patchCalls = () => calls.filter((c) => c.method === "PATCH");
const getCalls = () => calls.filter((c) => c.method === "GET");

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  cleanup();
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

/* ------------------------- 下書き行 = 1 行 = 1 レコード -------------------- */

describe("下書き行（最下段の新規入力行）", () => {
  const fields = [
    field("name", "氏名", "text"),
    field("email", "メール", "email"),
    field("done", "完了", "checkbox"),
  ];

  it("複数の列に入力しても、作られるレコードは 1 件だけ", async () => {
    installFetch(() => okResponse({ id: "rec-new", data: { name: "佐藤 花子", email: "sato@example.com" } }));
    const { container } = renderGrid(fields);

    typeInCell(container, DRAFT, "name", "佐藤 花子");
    typeInCell(container, DRAFT, "email", "sato@example.com");

    // セルを確定しただけでは、まだ 1 度も通信していない
    //（以前はここまでで 2 レコードできていた）。
    expect(calls).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "行を追加" }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0].url).toContain("/api/collections/col-1/records");
    expect(postCalls()[0].body).toEqual({
      data: { name: "佐藤 花子", email: "sato@example.com" },
    });
    // 画面にも 1 行だけ増える。
    await waitFor(() =>
      expect(cell(container, "rec-new", "name")).toHaveTextContent("佐藤 花子"),
    );
    expect(calls).toHaveLength(1);
    // 下書きは空に戻る。
    expect(
      screen.getByRole("button", { name: "行を追加" }),
    ).toBeDisabled();
  });

  it("セルを触っただけ（入力なし）では、空のレコードを作らない", async () => {
    installFetch(() => okResponse({ id: "rec-x", data: {} }));
    const { container } = renderGrid(fields);

    // クリックして、何も打たずに離れる。
    const td = cell(container, DRAFT, "name").closest("td") as HTMLElement;
    fireEvent.click(td.querySelector("button") as HTMLElement);
    fireEvent.blur(td.querySelector("input") as HTMLElement);

    expect(calls).toHaveLength(0);
    // 何も入っていないので「行を追加」は押せない。
    expect(screen.getByRole("button", { name: "行を追加" })).toBeDisabled();
  });

  it("チェックボックスを 1 回押しても、その場でレコードは作られない", async () => {
    installFetch(() => okResponse({ id: "rec-x", data: { done: true } }));
    const { container } = renderGrid(fields);

    const td = cell(container, DRAFT, "done").closest("td") as HTMLElement;
    fireEvent.click(td.querySelector("button") as HTMLElement);
    const box = td.querySelector("input[type=checkbox]") as HTMLInputElement;
    fireEvent.click(box);

    // 即時確定するエディタでも、下書きに貯まるだけ。
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "行を追加" })).toBeEnabled(),
    );
    expect(calls).toHaveLength(0);
  });

  it("「行を追加」を連打しても 2 行にならない", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    installFetch(async () => {
      await held;
      return okResponse({ id: "rec-new", data: { name: "田中" } });
    });
    const { container } = renderGrid(fields);

    typeInCell(container, DRAFT, "name", "田中");
    const addButton = screen.getByRole("button", { name: "行を追加" });
    fireEvent.click(addButton);
    fireEvent.click(addButton);
    fireEvent.click(addButton);

    expect(postCalls()).toHaveLength(1);
    release();
    await waitFor(() =>
      expect(cell(container, "rec-new", "name")).toHaveTextContent("田中"),
    );
    expect(postCalls()).toHaveLength(1);
  });

  it("保存に失敗したら下書きは消さず、理由を知らせる", async () => {
    installFetch(() => errorResponse("氏名は必須項目です"));
    const { container } = renderGrid([
      field("name", "氏名", "text", { required: true }),
      field("memo", "メモ", "text"),
    ]);

    typeInCell(container, DRAFT, "memo", "あとで書く");
    fireEvent.click(screen.getByRole("button", { name: "行を追加" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("氏名は必須項目です"),
    );
    // 下書きは残っているので、続きを入力できる。
    expect(cell(container, DRAFT, "memo")).toHaveTextContent("あとで書く");
  });
});

/* ----------------------------- 計算列の取り直し ---------------------------- */

describe("計算列（formula / lookup / rollup / vlookup）", () => {
  const profitFields = [
    field("sales", "売上", "number"),
    field("cost", "原価", "number"),
    field("profit", "粗利", "formula", {
      config: { expression: "{sales} - {cost}" },
    }),
  ];

  it("元の列を編集したら、計算列が新しい値になる", async () => {
    installFetch((call) => {
      if (call.method === "PATCH") {
        return okResponse({ data: { sales: 900, cost: 500 } });
      }
      // 計算はサーバー側でしか行われないので、書き込みの応答には含まれない。
      return recordsResponse([
        { id: "rec-1", data: { sales: 900, cost: 500 }, computed: { profit: 400 } },
      ]);
    });
    const { container } = renderGrid(profitFields, [
      { id: "rec-1", data: { sales: 800, cost: 500 }, computed: { profit: 300 } },
    ]);

    expect(screen.getByText("300")).toBeInTheDocument();

    typeInCell(container, "rec-1", "sales", "900");

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    // 古い粗利のまま放置しない（以前はここで 300 のままだった）。
    await waitFor(() => expect(screen.getByText("400")).toBeInTheDocument());
    expect(screen.queryByText("300")).toBeNull();
    // 取り直しは 1 回だけ。読み込み済みの件数ぶんを明示して取りに行く。
    expect(getCalls()).toHaveLength(1);
    expect(getCalls()[0].url).toContain("limit=");
  });

  it("続けて編集しても、取り直しは 1 回にまとまる", async () => {
    installFetch((call) =>
      call.method === "PATCH"
        ? okResponse({ data: { sales: 900, cost: 400 } })
        : recordsResponse([
            {
              id: "rec-1",
              data: { sales: 900, cost: 400 },
              computed: { profit: 500 },
            },
          ]),
    );
    const { container } = renderGrid(profitFields, [
      { id: "rec-1", data: { sales: 800, cost: 500 }, computed: { profit: 300 } },
    ]);

    typeInCell(container, "rec-1", "sales", "900");
    typeInCell(container, "rec-1", "cost", "400");

    await waitFor(() => expect(screen.getByText("500")).toBeInTheDocument());
    expect(patchCalls()).toHaveLength(2);
    expect(getCalls()).toHaveLength(1);
  });

  it("追加した行の計算列も、あとから埋まる", async () => {
    installFetch((call) =>
      call.method === "POST"
        ? okResponse({ id: "rec-new", data: { sales: 1000, cost: 200 } })
        : recordsResponse([
            {
              id: "rec-new",
              data: { sales: 1000, cost: 200 },
              computed: { profit: 800 },
            },
          ]),
    );
    const { container } = renderGrid(profitFields);

    typeInCell(container, DRAFT, "sales", "1000");
    typeInCell(container, DRAFT, "cost", "200");
    fireEvent.click(screen.getByRole("button", { name: "行を追加" }));

    await waitFor(() => expect(screen.getByText("800")).toBeInTheDocument());
    expect(postCalls()).toHaveLength(1);
  });

  it("計算列が無いシートでは、編集のたびに取り直したりしない", async () => {
    installFetch(() => okResponse({ data: { name: "鈴木" } }));
    const { container } = renderGrid([field("name", "氏名", "text")], [
      { id: "rec-1", data: { name: "佐藤" }, computed: {} },
    ]);

    typeInCell(container, "rec-1", "name", "鈴木");

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    // 取り直しの予約（250ms）より長く待っても、GET は飛ばない。
    await new Promise((r) => setTimeout(r, 400));
    expect(getCalls()).toHaveLength(0);
  });
});

/* ------------------------------ 保存の失敗と guard ------------------------- */

describe("保存の失敗", () => {
  const fields = [
    field("a", "列A", "text"),
    field("b", "列B", "text"),
  ];

  it("A の失敗で、先に保存できた B の値を消さない", async () => {
    let releaseA!: () => void;
    const heldA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    installFetch(async (call) => {
      const data = (call.body as { data: Record<string, unknown> }).data;
      if ("a" in data) {
        await heldA;
        return errorResponse("保存に失敗しました", 500);
      }
      return okResponse({ data: { b: "B新" } });
    });
    const { container } = renderGrid(fields, [
      { id: "rec-1", data: { a: "A旧", b: "B旧" }, computed: {} },
    ]);

    typeInCell(container, "rec-1", "a", "A新"); // 失敗する方（保留中）
    typeInCell(container, "rec-1", "b", "B新"); // 成功する方

    await waitFor(() =>
      expect(cell(container, "rec-1", "b")).toHaveTextContent("B新"),
    );
    releaseA();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // 失敗した列だけが元に戻る。保存済みの B は消えない。
    expect(cell(container, "rec-1", "a")).toHaveTextContent("A旧");
    expect(cell(container, "rec-1", "b")).toHaveTextContent("B新");
  });

  it("空の必須セルを素通りしただけでは保存しない", async () => {
    installFetch(() => errorResponse("氏名は必須項目です"));
    const { container } = renderGrid(
      [field("name", "氏名", "text", { required: true })],
      [{ id: "rec-1", data: {}, computed: {} }],
    );

    const td = cell(container, "rec-1", "name").closest("td") as HTMLElement;
    fireEvent.click(td.querySelector("button") as HTMLElement);
    fireEvent.blur(td.querySelector("input") as HTMLElement);

    expect(calls).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/* ------------------------- 読み込み範囲を偽らない -------------------------- */

describe("読み込み済みの範囲", () => {
  it("続きがあるときは件数を断り、追加読み込みができる", async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({
      id: `rec-${i}`,
      data: { name: `行${i}` },
      computed: {},
    }));
    installFetch(() =>
      okResponse({
        records: [{ id: "rec-100", data: { name: "行100" }, computed: {} }],
        relationLabels: {},
        lookupLabels: {},
        nextCursor: null,
      }),
    );
    const { container } = renderGrid([field("name", "氏名", "text")], first);

    // 「100 件」と言い切らず、読み込み済みであることを添える。
    expect(screen.getByText(/読み込み済み/)).toBeInTheDocument();

    const more = screen.getByRole("button", { name: /さらに/ });
    fireEvent.click(more);

    await waitFor(() =>
      expect(cell(container, "rec-100", "name")).toHaveTextContent("行100"),
    );
    // 続きは cursor 付きで取りに行く（最後に持っている行の id）。
    expect(getCalls()[0].url).toContain("cursor=rec-99");
  });
});
