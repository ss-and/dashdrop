/**
 * 取り込み前の下見の回帰テスト。
 *
 * ここで固定したい契約は3つ。
 *
 * 1. **AI が無くても必ず提案が出る。** キー未設定・API 失敗・返答が壊れている、
 *    どの場合でも `adviseImport` は例外を投げず、決定的な提案を返す。取り込みは
 *    AI の可用性に依存してはいけない。
 * 2. **事実は AI に上書きさせない。** 結合セル・見出し行のずれ・空欄の列名は
 *    ファイルを読めば分かることなので、モデルの返答に関わらず必ず質問に出る。
 *    空のシートを「取り込む」に変えることもできない。
 * 3. **項目名とキーは必ず一意。** モデルが全列に同じ名前を返しても、突き合わせ用の
 *    `sourceHeader` は元の列のまま、名前とキーだけが一意に整えられる。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as XLSX from "xlsx";
import { readAllSheets } from "@/lib/excel";
import {
  adviseImport,
  heuristicAdvice,
  reconcileAdvice,
  structuralQuestions,
  stripFence,
} from "@/lib/import-advisor";

/** シート定義から .xlsx を組み立てて、パーサに通した結果を返す。 */
function scan(
  sheets: Array<{ name: string; rows: unknown[][]; merges?: XLSX.Range[] }>,
) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    if (s.merges) ws["!merges"] = s.merges;
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return readAllSheets(out);
}

const ORDERS = {
  name: "受注明細",
  rows: [
    ["受注日", "取引先", "金額"],
    ["2026-04-01", "山田商事", 120000],
    ["2026-04-02", "高橋物流", 80000],
  ],
};

describe("結合セル・見出し行・列名の指摘", () => {
  it("結合セルを、位置つきで指摘して質問を返す", () => {
    const sheets = scan([
      {
        name: "受注明細",
        rows: [
          ["2026年度 受注明細"],
          [],
          ["受注日", "取引先", "金額"],
          ["2026-04-01", "山田商事", 120000],
        ],
        merges: [{ s: { r: 2, c: 1 }, e: { r: 2, c: 2 } }],
      },
    ]);

    expect(sheets[0].merges.count).toBe(1);
    expect(sheets[0].merges.inHeaderRow).toBe(1);

    const q = structuralQuestions(sheets);
    const merge = q.find((x) => x.message.includes("結合"));
    expect(merge).toBeDefined();
    expect(merge!.message).toContain("見出しの行にも結合があります");
    expect(merge!.question).not.toBe("");
  });

  it("見出しが1行目でないときは、何行目を見出しにしたかを聞く", () => {
    const sheets = scan([
      {
        name: "受注明細",
        rows: [
          ["2026年度 受注明細"],
          [],
          ["受注日", "金額"],
          ["2026-04-01", 120000],
        ],
      },
    ]);
    expect(sheets[0].headerRowIndex).toBe(2);

    const q = structuralQuestions(sheets);
    expect(q.some((x) => x.message.includes("3行目を見出し"))).toBe(true);
  });

  it("空欄の列名と、元は同名だった列を指摘する", () => {
    const sheets = scan([
      {
        name: "受注明細",
        rows: [
          ["受注日", "", "金額", "金額"],
          ["2026-04-01", "東京", 120000, 132000],
        ],
      },
    ]);

    const q = structuralQuestions(sheets);
    // パーサは "列2" / "金額-2" に開くが、利用者にとっては
    // 「名前が無い列」「同じ名前の列」のまま。
    expect(q.some((x) => x.message.includes("列名が空欄"))).toBe(true);
    expect(q.some((x) => x.message.includes("同じ列名が複数"))).toBe(true);
  });
});

describe("シートの取捨（AIなし）", () => {
  it("表紙のような1列だけのシートは、既定で取り込まない", () => {
    const sheets = scan([
      { name: "表紙", rows: [["2026年度 売上管理表"], ["作成: 経理部"]] },
      ORDERS,
    ]);

    const advice = heuristicAdvice(sheets);
    const cover = advice.sheets.find((s) => s.sheetName === "表紙");
    const orders = advice.sheets.find((s) => s.sheetName === "受注明細");
    expect(cover?.include).toBe(false);
    expect(cover?.reason).toContain("表紙");
    expect(orders?.include).toBe(true);
    // 取り込まないシートの列は提案しない。
    expect(advice.columns["表紙"]).toBeUndefined();
    expect(advice.columns["受注明細"]).toHaveLength(3);
  });
});

describe("モデルの返答の突き合わせ", () => {
  const sheets = () =>
    scan([
      { name: "表紙", rows: [["2026年度 売上管理表"]] },
      ORDERS,
    ]);

  it("提案された項目名を採り、キーと名前は一意に整える", () => {
    const parsed = sheets();
    const advice = reconcileAdvice(
      {
        sheets: [{ sheetName: "受注明細", include: true, reason: "受注の明細です。" }],
        columns: {
          受注明細: [
            // モデルが全列に同じ名前を返してきた最悪ケース。
            { sourceHeader: "受注日", name: "金額", key: "amount", type: "date", reason: "統一" },
            { sourceHeader: "取引先", name: "金額", key: "amount", type: "text", reason: "統一" },
            { sourceHeader: "金額", name: "金額", key: "amount", type: "number", reason: "" },
          ],
        },
        questions: [],
      },
      parsed,
    );

    const cols = advice.columns["受注明細"];
    // 突き合わせの鍵は元の列のまま。ここがずれると値が別の列に入る。
    expect(cols.map((c) => c.sourceHeader)).toEqual(["受注日", "取引先", "金額"]);
    // 名前もキーも重複しない。
    expect(new Set(cols.map((c) => c.name)).size).toBe(3);
    expect(new Set(cols.map((c) => c.key)).size).toBe(3);
    expect(cols[0].type).toBe("date");
  });

  it("型が不正な値なら、サンプルからの推定を採る", () => {
    const parsed = sheets();
    const advice = reconcileAdvice(
      {
        sheets: [],
        columns: {
          受注明細: [
            { sourceHeader: "金額", name: "金額", key: "kingaku", type: "でたらめ", reason: "" },
          ],
        },
        questions: [],
      },
      parsed,
    );
    const amount = advice.columns["受注明細"].find((c) => c.sourceHeader === "金額");
    expect(amount?.type).toBe("number");
  });

  it("構造の指摘は、モデルが黙っていても必ず残る", () => {
    const parsed = scan([
      {
        name: "受注明細",
        rows: [["受注日", "金額"], ["2026-04-01", 120000]],
        merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }],
      },
    ]);
    const advice = reconcileAdvice(
      { sheets: [], columns: {}, questions: [] },
      parsed,
    );
    expect(advice.questions.some((q) => q.message.includes("結合"))).toBe(true);
  });

  it("空のシートを「取り込む」に変えることはできない", () => {
    const parsed = scan([{ name: "空っぽ", rows: [[]] }, ORDERS]);
    const advice = reconcileAdvice(
      {
        sheets: [{ sheetName: "空っぽ", include: true, reason: "使えます" }],
        columns: {},
        questions: [],
      },
      parsed,
    );
    expect(advice.sheets.find((s) => s.sheetName === "空っぽ")?.include).toBe(false);
  });
});

describe("AI が使えないときも必ず提案を返す", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  it("APIキーが無ければ、通信せずに決定的な提案を返す", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    const res = await adviseImport(scan([ORDERS]));

    expect(spy).not.toHaveBeenCalled();
    expect(res.via).toBe("heuristic");
    expect(res.advice.columns["受注明細"]).toHaveLength(3);
  });

  it("APIが落ちても例外にせず、決定的な提案に落ちる", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    globalThis.fetch = (async () =>
      new Response("boom", { status: 500 })) as unknown as typeof fetch;

    const res = await adviseImport(scan([ORDERS]));
    expect(res.via).toBe("heuristic");
    expect(res.advice.sheets[0].include).toBe(true);
  });
});

describe("stripFence", () => {
  it("モデルが付けたコードフェンスを剥がす", () => {
    expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFence('{"a":1}')).toBe('{"a":1}');
  });
});
