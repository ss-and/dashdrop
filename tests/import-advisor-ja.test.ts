/**
 * 日本の実務Excelの形を、取り込み前の下見で指摘できることを固定する。
 *
 * ここで見ているのは「見つけて、聞く」まで。勝手に変換はしない——横持ちを
 * 黙って縦にすると、元の帳票と行数が合わなくなって利用者が混乱するため。
 *
 * テストは実際に .xlsx を組み立ててパーサに通す（既存の import-advisor の
 * テストと同じ方式）。見出しの検出も結合の扱いも本物の経路を通るので、
 * パーサ側が変わればここも落ちる。
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readAllSheets } from "@/lib/excel";
import { structuralQuestions } from "@/lib/import-advisor";

function scan(sheets: Array<{ name: string; rows: unknown[][] }>) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return readAllSheets(out);
}

/** 質問のうち、キーワードを含むものだけを拾う。 */
function about(sheets: ReturnType<typeof scan>, keyword: string) {
  return structuralQuestions(sheets).filter(
    (q) => q.message.includes(keyword) || q.question.includes(keyword),
  );
}

describe("横持ちの指摘", () => {
  it("月が横に並んだ表を見つけて、縦に直すか聞く", () => {
    const sheets = scan([
      {
        name: "部門別売上",
        rows: [
          ["部門", "4月", "5月", "6月"],
          ["営業部", 120, 135, 150],
          ["開発部", 80, 90, 85],
        ],
      },
    ]);
    const found = about(sheets, "横に並んで");
    expect(found).toHaveLength(1);
    // 何が問題なのか（グラフにできない理由）まで伝えていること。
    expect(found[0].message).toContain("推移をグラフにできません");
    // 何を残して何を動かすのかを、実際の列名で示していること。
    expect(found[0].question).toContain("部門");
    expect(found[0].question).toContain("縦に並べ替えますか");
  });

  it("四半期・年でも指摘する", () => {
    const q = scan([
      {
        name: "四半期",
        rows: [
          ["製品", "Q1", "Q2", "Q3"],
          ["A", 10, 20, 30],
        ],
      },
    ]);
    expect(about(q, "横に並んで")).toHaveLength(1);
  });

  /**
   * 回帰の芯: 見出しの形だけで勧めると、「部門 / 4月 / 5月 / 6月」の中身が
   * 担当者名だったときに意味の無い提案をする。中身を見てから聞くこと。
   */
  it("期間らしい列の中身が数値でなければ、並べ替えを勧めない", () => {
    const sheets = scan([
      {
        name: "当番表",
        rows: [
          ["部門", "4月", "5月", "6月"],
          ["営業部", "山田", "高橋", "佐藤"],
          ["開発部", "鈴木", "田中", "伊藤"],
        ],
      },
    ]);
    expect(about(sheets, "横に並んで")).toHaveLength(0);
  });

  /**
   * 数値が少しでも混ざっていれば勧める、にすると当番表が誤爆する。
   * 「4月に1回だけ数字が入っている当番表」は実在するので、過半数で判断する。
   */
  it("数値が少数混ざっているだけでは勧めない", () => {
    const sheets = scan([
      {
        name: "当番表",
        rows: [
          ["部門", "4月", "5月", "6月"],
          ["営業部", "山田", "高橋", 3],
          ["開発部", "鈴木", "田中", "伊藤"],
          ["総務部", "佐藤", "中村", "小林"],
        ],
      },
    ]);
    expect(about(sheets, "横に並んで")).toHaveLength(0);
  });

  /**
   * まだ1件も数字が入っていない雛形（来期の予算表など）は、判断材料が無い。
   * 勧めない側に倒す——空の表に「並べ替えますか？」と聞いても答えようがない。
   */
  it("期間列に値が1件も無ければ勧めない", () => {
    const sheets = scan([
      {
        name: "来期予算",
        rows: [
          ["部門", "4月", "5月", "6月"],
          ["営業部", "", "", ""],
          ["開発部", "", "", ""],
        ],
      },
    ]);
    expect(about(sheets, "横に並んで")).toHaveLength(0);
  });

  it("普通の縦持ちの表には何も言わない", () => {
    const sheets = scan([
      {
        name: "受注明細",
        rows: [
          ["受注日", "取引先", "金額"],
          ["2026-04-01", "山田商事", 120000],
          ["2026-04-02", "高橋物流", 80000],
        ],
      },
    ]);
    expect(about(sheets, "横に並んで")).toHaveLength(0);
  });

  it("比較のための2列（前年・今年）を横持ちと誤認しない", () => {
    const sheets = scan([
      {
        name: "前年比",
        rows: [
          ["部門", "担当者", "2025年", "2026年"],
          ["営業部", "山田", 100, 120],
        ],
      },
    ]);
    expect(about(sheets, "横に並んで")).toHaveLength(0);
  });
});

describe("列名に埋まった単位の指摘", () => {
  it("千円・百万円の列を見つけて、実額に直すか聞く", () => {
    const sheets = scan([
      {
        name: "予算",
        rows: [
          ["部門", "売上（千円）", "経費（百万円）"],
          ["営業部", 1200, 3],
        ],
      },
    ]);
    const found = about(sheets, "単位が書かれている");
    expect(found).toHaveLength(1);
    // 倍率を具体的な数字で見せること（「千円です」だけでは桁が伝わらない）。
    expect(found[0].message).toContain("1 = 1,000円");
    expect(found[0].message).toContain("1 = 1,000,000円");
    expect(found[0].question).toContain("実額");
  });

  it("倍率が1の単位（円・件・%）では聞かない", () => {
    const sheets = scan([
      {
        name: "実績",
        rows: [
          ["部門", "売上（円）", "受注（件）", "達成率（%）"],
          ["営業部", 1200000, 8, 92],
        ],
      },
    ]);
    expect(about(sheets, "単位が書かれている")).toHaveLength(0);
  });

  /**
   * 括弧の中を無条件に単位とみなすと、区分や注記まで単位として指摘してしまう。
   */
  it("括弧の中が単位でなければ聞かない", () => {
    const sheets = scan([
      {
        name: "比較",
        rows: [
          ["部門", "売上（前年比）", "担当者（営業部）"],
          ["営業部", 1.2, "山田"],
        ],
      },
    ]);
    expect(about(sheets, "単位が書かれている")).toHaveLength(0);
  });
});

describe("既存の指摘を壊していない", () => {
  it("結合セル・見出し行のずれは今までどおり出る", () => {
    const sheets = scan([
      {
        name: "受注明細",
        rows: [
          ["2026年度 受注明細"],
          [],
          ["受注日", "取引先", "金額"],
          ["2026-04-01", "山田商事", 120000],
        ],
      },
    ]);
    const all = structuralQuestions(sheets);
    expect(all.some((q) => q.message.includes("行目を見出しとして読みました"))).toBe(
      true,
    );
  });
});
