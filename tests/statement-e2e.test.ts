/**
 * 実物のカード明細CSVを、バイト列から定期支払いの一覧まで通す。
 *
 * 上流（tests/statement-columns.test.ts）は列名だけを見ているので、
 * 「フィールドの型はこう推定されるはず」という**私の思い込み**の上に立っている。
 * ここではその思い込みを外し、実際に流れる経路をそのまま通す:
 *
 *   Shift_JIS のバイト列
 *     → readSheet（文字コード判定・見出し行の特定）
 *     → inferFields（型の推定）
 *     → coerceValue（取り込み時の値の変換）
 *     → computeWidget（列の割り当てと、定期支払いの判定）
 *
 * 途中のどこか1つでも読み違えると、最後に出てくるのは空の一覧になる。
 * どの段で落ちたかが分かるよう、段ごとにも確かめている。
 *
 * 最後の段は **computeWidget をそのまま呼ぶ**。自分で値を変換して
 * detectRecurring に渡すと、「取り込み後の値はこういう形のはず」という
 * こちらの思い込みを試すだけになる（実際、日付は Date ではなく ISO の
 * 文字列で保存されていて、最初はそこで全行が落ちていた）。
 */
import { describe, it, expect } from "vitest";
import { readSheet, inferFields } from "@/lib/excel";
import { coerceValue } from "@/lib/field-types";
import { detectChargeColumns } from "@/lib/recurring";
import { computeWidget, type AggCollection } from "@/lib/aggregate";
import type { WidgetSpec, RecurringData } from "@/lib/widgets";
import { encodeCp932 } from "./helpers/cp932";

/** 楽天カードが書き出す形（Shift_JIS・CRLF・見出しあり）。 */
function rakutenCsv(): Buffer {
  const rows: string[] = [
    "利用日,利用店名・商品名,利用者,支払方法,利用金額,支払手数料,支払総額",
  ];
  // NETFLIX を毎月10日、SPOTIFY を毎月25日、あとは単発の買い物。
  for (const m of [4, 5, 6, 7, 8]) {
    const mm = String(m).padStart(2, "0");
    rows.push(`2026/${mm}/10,NETFLIX.COM*M${m}A2B3C4,本人,1回払い,1490,0,1490`);
    rows.push(`2026/${mm}/25,ＳＰＯＴＩＦＹ,本人,1回払い,980,0,980`);
  }
  rows.push("2026/06/03,ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ/ｼﾌﾞﾔ,本人,1回払い,842,0,842");
  rows.push("2026/07/19,ﾔﾏﾀﾞﾃﾞﾝｷ ｼﾝｼﾞｭｸ,配偶者,1回払い,32780,0,32780");
  return encodeCp932(rows.join("\r\n") + "\r\n");
}

/** 住信SBIネット銀行の入出金明細（出金・入金・残高の3列）。 */
function bankCsv(): Buffer {
  const rows: string[] = ["日付,内容,出金金額(円),入金金額(円),残高(円)"];
  for (const m of [4, 5, 6, 7, 8]) {
    const mm = String(m).padStart(2, "0");
    // 給与（入金）— これを支出に混ぜてはいけない。
    rows.push(`2026/${mm}/25,給与 カ)サンプル,,380000,${1000000 + m * 1000}`);
    // 家賃（出金・定額）
    rows.push(`2026/${mm}/27,家賃 サンプル不動産,92000,,${900000 + m * 1000}`);
    // 電気（出金・従量）
    rows.push(
      `2026/${mm}/15,デンキリョウキン,${8000 + m * 700},,${950000 + m * 1000}`,
    );
  }
  return encodeCp932(rows.join("\r\n") + "\r\n");
}

const SPEC: WidgetSpec = {
  id: "r",
  type: "recurring",
  title: "定期支払い",
  collection: "meisai",
  span: 2,
} as WidgetSpec;

/** バイト列を、取り込んだあとの姿（AggCollection）まで運ぶ。 */
function pipeline(csv: Buffer, asOf: Date) {
  const sheet = readSheet(csv);
  const fields = inferFields(sheet.headers, sheet.sampleByHeader);
  const cols = detectChargeColumns(fields);

  // 取り込みと同じ変換をかけて、同じ形（key をキーにした data）で持つ。
  const records = sheet.rows.map((r, i) => {
    const data: Record<string, unknown> = {};
    for (const f of fields) {
      const c = coerceValue(f.type, r[f.name]);
      data[f.key] = c.ok ? c.value : null;
    }
    return { id: `r${i}`, createdAt: new Date(), data };
  });

  const col: AggCollection = {
    slug: "meisai",
    name: "明細",
    fields: fields.map((f) => ({ key: f.key, name: f.name, type: f.type })),
    records,
  };
  const data = computeWidget(SPEC, new Map([["meisai", col]]), asOf);
  if (data.type !== "recurring") throw new Error("recurring を期待");
  return { sheet, fields, cols, summary: data as RecurringData };
}

const ASOF = new Date(2026, 8, 5); // 2026-09-05

/* ========================================================================== */
describe("楽天カードの明細（Shift_JIS）", () => {
  const r = pipeline(rakutenCsv(), ASOF);

  it("文字コードを判別して見出しを読める", () => {
    expect(r.sheet.headers).toContain("利用店名・商品名");
    expect(r.sheet.headers).toContain("利用金額");
    expect(r.sheet.rows.length).toBe(12);
  });

  it("列の割り当てが正しい（利用者でも支払総額でもない）", () => {
    const name = (k: string) => r.fields.find((f) => f.key === k)?.name;
    expect(name(r.cols!.dateKey)).toBe("利用日");
    expect(name(r.cols!.labelKey)).toBe("利用店名・商品名");
    expect(name(r.cols!.amountKey)).toBe("利用金額");
  });

  it("サブスクだけを見つけ、単発の買い物は入れない", () => {
    const labels = r.summary.items.map((c) => c.label);
    expect(labels).toHaveLength(2);
    expect(labels.some((l) => l.includes("NETFLIX"))).toBe(true);
    expect(labels.some((l) => l.includes("ＳＰＯＴＩＦＹ"))).toBe(true);
    // ヤマダ電機（32,780円）が混じると合計が桁違いになる。
    expect(labels.some((l) => l.includes("ﾔﾏﾀﾞ") || l.includes("ヤマダ"))).toBe(
      false,
    );
  });

  it("毎月ちがう取引参照コードが付いていても1件にまとまる", () => {
    const netflix = r.summary.items.find((c) => c.label.includes("NETFLIX"));
    expect(netflix?.occurrences).toBe(5);
    expect(netflix?.cadence).toBe("毎月");
    expect(netflix?.amount).toBe(1490);
  });

  it("月あたりの合計が出る", () => {
    expect(r.summary.monthlyTotal).toBe(1490 + 980);
    expect(r.summary.yearlyTotal).toBe((1490 + 980) * 12);
  });
});

/* ========================================================================== */
describe("銀行の入出金明細（出金・入金・残高の3列）", () => {
  const r = pipeline(bankCsv(), ASOF);

  it("出金の列を選ぶ", () => {
    const name = (k: string) => r.fields.find((f) => f.key === k)?.name;
    expect(name(r.cols!.amountKey)).toBe("出金金額(円)");
  });

  /**
   * ここがこのファイルで一番大事。給与は毎月25日にぴったり同額で入るので、
   * 入金の列を金額として読むと**必ず**「毎月 ¥380,000 の定期支払い」として
   * 検出される。しかもそれらしく見えるので、気づけない。
   */
  it("給与（入金）を定期支払いに混ぜない", () => {
    const labels = r.summary.items.map((c) => c.label);
    expect(labels.some((l) => l.includes("給与"))).toBe(false);
    expect(r.summary.monthlyTotal).toBeLessThan(200000);
  });

  it("家賃（定額）と電気（従量）を両方見つけ、性質を区別する", () => {
    const rent = r.summary.items.find((c) => c.label.includes("家賃"));
    const power = r.summary.items.find((c) => c.label.includes("デンキ"));
    expect(rent?.variable).toBe(false);
    expect(rent?.amount).toBe(92000);
    expect(power?.variable).toBe(true);
    expect(power?.cadence).toBe("毎月");
  });
});
