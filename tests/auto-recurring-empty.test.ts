/**
 * 「定期支払い」の枠を、空振りする画面に置かない。
 *
 * 本番で通しの実走をしたときに出たもの。180行のごく普通の売上台帳
 * （日付・得意先・商品・数量・金額・担当）を取り込んで自動作成すると、
 *
 *   定期支払い
 *   くり返し出ている支払いは見つかりませんでした
 *
 * が1枠を占めていた。原因は、この図表を足すかどうかを**列の形だけ**で
 * 決めていたこと（`detectChargeColumns` が 日付・摘要・金額 に当たる列を
 * 見つけたか）。売上台帳はまさにその形をしているので、**必ず作られて必ず空になる**。
 *
 * 売上ファイルはこの製品で一番よく置かれるものなので、放っておくと
 * ほとんどの利用者の初回の画面に空の枠が1つ混ざる。
 *
 * ここでは「列は揃うが1件も見つからない」データと「本当に見つかる」データの
 * 両方で、`detectRecurring` の結果が分かれることを固定する。判断の材料が
 * 列の形ではなく**検出の結果**であることが要点。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { detectChargeColumns, detectRecurring, type Charge } from "@/lib/recurring";

/** 売上台帳。得意先も商品も繰り返すが、同額が同じ間隔では出ない。 */
function salesLedger(): Charge[] {
  const cust = ["山田製作所", "佐藤商事", "鈴木工業", "高橋物産", "田中電機"];
  const out: Charge[] = [];
  for (let i = 0; i < 180; i++) {
    out.push({
      date: new Date(2026, 4 + (i % 4), 1 + (i % 27)),
      label: cust[i % 5],
      amount: (((i * 137) % 90) + 10) * 1000,
    });
  }
  return out;
}

/** カード明細。同じ相手に同じ額が毎月。 */
function cardStatement(): Charge[] {
  const out: Charge[] = [];
  for (let m = 0; m < 6; m++) {
    out.push({ date: new Date(2026, 2 + m, 10), label: "Adobe", amount: 6480 });
    out.push({ date: new Date(2026, 2 + m, 22), label: "AWS", amount: 12800 });
  }
  return out;
}

const NOW = new Date(2026, 7, 31);

describe("列の形だけでは判断できない", () => {
  const fields = [
    { key: "date", name: "日付", type: "date" },
    { key: "cust", name: "得意先", type: "text" },
    { key: "amount", name: "金額", type: "number" },
  ];

  /** ここが要点。売上台帳でも列は「明細の形」に当たってしまう。 */
  it("売上台帳の列は、明細の列として当たってしまう", () => {
    expect(detectChargeColumns(fields)).not.toBeNull();
  });

  it("それでも、繰り返しは1件も見つからない", () => {
    expect(detectRecurring(salesLedger(), NOW).charges).toHaveLength(0);
  });

  it("本物のカード明細では見つかる", () => {
    const found = detectRecurring(cardStatement(), NOW).charges;
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((c) => c.label).sort()).toEqual(["AWS", "Adobe"]);
  });
});

describe("自動作成が、結果を見てから枠を残す", () => {
  const src = readFileSync("src/lib/apply-template.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  /**
   * **呼び出し側**を見る。ファイル全体に対する toContain だと、関数の定義に
   * 同じ名前が残っているので、呼び出しを外しても通ってしまう
   * （実際にその変異を素通しした）。createAutoDashboard の中を見る。
   */
  it("組み立てた配置を、そのまま保存していない", () => {
    const fn = src.slice(src.indexOf("export async function createAutoDashboard"));
    expect(fn).toMatch(/const layout = dropEmptyRecurring\(/);
    // 組み立ての結果を、そのまま layout にしていないこと。
    expect(fn).not.toMatch(/const layout = profiled\.some/);
  });

  /**
   * 実際に計算してから決めていること。`detectChargeColumns` だけを見て
   * 判断する形に戻ったら、この製品で一番多い売上ファイルで空の枠が復活する。
   */
  it("実際に計算した結果で落としている", () => {
    const fn = src.slice(src.indexOf("function dropEmptyRecurring"));
    expect(fn).toContain("computeWidget(");
    expect(fn).toMatch(/items\.length\s*>\s*0/);
  });

  /** 落とすのは定期支払いだけ。他の図表を巻き込まない。 */
  it("落とすのは定期支払いの枠だけ", () => {
    const fn = src.slice(src.indexOf("function dropEmptyRecurring"));
    expect(fn).toMatch(/w\.type\s*!==\s*"recurring"\s*\)\s*return true/);
  });

  /** 1枚も無いときは計算しない（自動作成のたびに無駄な走査をしない）。 */
  it("定期支払いが無ければ何も計算しない", () => {
    const fn = src.slice(src.indexOf("function dropEmptyRecurring"));
    expect(fn).toMatch(/if \(!layout\.some\(\(w\) => w\.type === "recurring"\)\) return layout;/);
  });
});
