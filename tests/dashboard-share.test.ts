/**
 * ダッシュボードを Slack / Notion へ共有する。
 *
 * 利用者の依頼:「Slackで共有、Notionで共有もできるよう共有ボタンのところで」。
 *
 * グラフそのものは送れないので、送れるのは数字と言葉だけ。ここで固定したいのは
 * 「送った先に何が届くか」で、とくに次の3つ。
 *
 *  1. 画面と同じ数字・同じ書式が届く（¥1,329,000 が 1329000 にならない）。
 *  2. 送るのは1つの要約から。Slackにだけ出る数字、を作らない。
 *  3. 送れないときは「なぜ送れないか」まで返す（未接続・作成先未選択）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildDigest, breakdownLines, isEmptyDigest } from "@/lib/dashboard-digest";
import { listPages, createPage } from "@/lib/notion";
import { buildMessage } from "@/lib/slack";
import type { WidgetSpec, WidgetData } from "@/lib/widgets";

/* --------------------------------- 要約 --------------------------------- */

const kpi = (id: string, title: string, value: number, unit: "currency" | "number") =>
  ({
    widget: { id, type: "kpi", title, collection: "s", measure: { kind: "count" } } as WidgetSpec,
    data: { type: "kpi", value, unit } as WidgetData,
  });

const donut = (id: string, title: string, slices: Array<[string, number]>) => ({
  widget: {
    id,
    type: "donut",
    title,
    collection: "s",
    groupBy: "g",
    measure: { kind: "count" },
    limit: 6,
  } as WidgetSpec,
  data: {
    type: "donut",
    slices: slices.map(([label, value]) => ({ label, value, key: label })),
    total: slices.reduce((n, [, v]) => n + v, 0),
  } as WidgetData,
});

describe("共有用の要約", () => {
  const computed = [
    kpi("k1", "受注一覧の件数", 60, "number"),
    kpi("k2", "単価の合計", 1_329_000, "currency"),
    donut("d1", "ステータス別の単価", [
      ["失注", 338_000],
      ["見積提出", 334_000],
      ["商談中", 331_000],
    ]),
  ];

  it("画面と同じ書式の数字を載せる", () => {
    const d = buildDigest(computed);
    expect(d.kpis).toEqual([
      { label: "受注一覧の件数", value: "60" },
      { label: "単価の合計", value: "¥1,329,000" },
    ]);
  });

  it("内訳は上位だけを、軸と同じ 万・億 でそろえる", () => {
    const d = buildDigest(computed);
    expect(d.breakdowns).toHaveLength(1);
    expect(breakdownLines(d.breakdowns[0])).toEqual([
      "失注: 33.8万",
      "見積提出: 33.4万",
      "商談中: 33.1万",
    ]);
  });

  it("指標は10個まで（Slackのfieldsの上限に合わせる）", () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      kpi(`k${i}`, `指標${i}`, i, "number"),
    );
    expect(buildDigest(many).kpis).toHaveLength(10);
  });

  it("数字が1つも無いことを、空とは別に言えるようにする", () => {
    // 何も言わずに空の投稿が飛ぶと、受け取る側には故障に見える。
    expect(isEmptyDigest(buildDigest([]))).toBe(true);
    expect(isEmptyDigest(buildDigest(computed))).toBe(false);
  });

  it("表やクロス集計は載せない（文章で読めないため）", () => {
    const table = {
      widget: { id: "t", type: "table", title: "明細", collection: "s", columns: ["a"], limit: 8 } as WidgetSpec,
      data: { type: "table", columns: [], rows: [] } as WidgetData,
    };
    const d = buildDigest([table]);
    expect(d.kpis).toHaveLength(0);
    expect(d.breakdowns).toHaveLength(0);
    // 枚数は数える。「10枚のうち要約したのは一部」と分かるように。
    expect(d.widgetCount).toBe(1);
  });
});

/* -------------------------------- Slack --------------------------------- */

describe("Slackに送る形", () => {
  it("指標は Block Kit の fields に、リンクは行き先を名乗って入る", () => {
    const d = buildDigest([
      kpi("k1", "単価の合計", 1_329_000, "currency"),
      kpi("k2", "件数", 60, "number"),
    ]);
    const msg = buildMessage({
      title: "受注データ ダッシュボード",
      body: "2026年8月20日 15:00 時点",
      url: "https://example.test/share/d/tok",
      linkLabel: "ダッシュボードを開く",
      fields: d.kpis.map((k) => ({ label: k.label, value: k.value })),
    });

    const json = JSON.stringify(msg.blocks);
    expect(json).toContain("¥1,329,000");
    expect(json).toContain("ダッシュボードを開く");
    // 通知・読み上げ用の fallback text が空だと、Slackの通知欄が空白になる。
    expect(msg.text).toContain("受注データ ダッシュボード");
  });
});

/* -------------------------------- Notion -------------------------------- */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const TOKEN = "secret_test_token_0123456789";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Notionの作成先", () => {
  it("データベースの行は作成先に出さない", async () => {
    /*
     * Notion では「データベースの行」もオブジェクトとしては page なので、
     * search の結果にそのまま混ざる。行の下にサブページは作れないので、
     * ここで外しておかないと、選んだ先が原因で作成が 400 で落ちる。
     */
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            object: "page",
            id: "page-1",
            parent: { type: "workspace" },
            url: "https://notion.so/page-1",
            properties: { Name: { type: "title", title: [{ plain_text: "社内Wiki" }] } },
          },
          {
            object: "page",
            id: "row-1",
            parent: { type: "database_id", database_id: "db-1" },
            properties: { 名前: { type: "title", title: [{ plain_text: "案件A" }] } },
          },
          {
            object: "page",
            id: "page-2",
            parent: { type: "page_id", page_id: "page-1" },
            properties: {},
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const pages = await listPages(TOKEN);
    expect(pages.map((p) => p.id)).toEqual(["page-1", "page-2"]);
    // タイトルのプロパティ名は決まっていない（"Name" のことも）。型で探す。
    expect(pages[0].title).toBe("社内Wiki");
    // タイトルが無いページも選べる形にする（無題として出す）。
    expect(pages[1].title).toBe("無題");
  });
});

describe("Notionにページを作る", () => {
  it("作成先が未選択なら、送る前に日本語で止める", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    await expect(createPage(TOKEN, "  ", "題", [])).rejects.toThrow(
      /作成先のNotionページを選択してください/,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("作ったページのURLを返す", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ id: "new-1", url: "https://notion.so/new-1" }),
    ) as unknown as typeof fetch;

    const page = await createPage(TOKEN, "page-1", "受注データ ダッシュボード", []);
    expect(page).toEqual({ id: "new-1", url: "https://notion.so/new-1" });

    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as { body: string }).body);
    expect(body.parent).toEqual({ type: "page_id", page_id: "page-1" });
    expect(body.properties.title.title[0].text.content).toBe(
      "受注データ ダッシュボード",
    );
  });

  it("200でもページが返ってこなければ、成功として扱わない", async () => {
    // 「Notionに作りました」と言った先に何も無い、がいちばん困る。
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({})) as unknown as typeof fetch;
    await expect(createPage(TOKEN, "page-1", "題", [])).rejects.toThrow(
      /ページを作成できませんでした/,
    );
  });

  it("Notionのエラーは日本語にして返す", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "unauthorized" }, 401)) as unknown as typeof fetch;
    await expect(createPage(TOKEN, "page-1", "題", [])).rejects.toThrow(
      /トークンが無効です/,
    );
  });
});
