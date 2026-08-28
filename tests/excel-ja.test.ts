/**
 * 日本の実務Excelの癖を読む層のテスト。
 *
 * ここのテストは「実ファイルで見た書き方」を1件ずつ足していく場所。
 * 汎用の取り込みが壊れるのはいつも、きれいなCSVには無いこういう書き方なので、
 * 見つけた癖はここに1行足して直す、という運用にする。
 */
import { describe, it, expect } from "vitest";
import {
  parseJapaneseDate,
  parseColumnUnit,
  detectWideLayout,
  unpivot,
} from "@/lib/excel-ja";

describe("parseJapaneseDate — 西暦", () => {
  it("「2026年4月1日」を読む（既存の日付解析が読めなかった形）", () => {
    expect(parseJapaneseDate("2026年4月1日")).toEqual({
      date: "2026-04-01",
      precision: "day",
      era: null,
    });
  });

  it("「日」が無くても読む", () => {
    expect(parseJapaneseDate("2026年4月1")?.date).toBe("2026-04-01");
  });

  it("月まで／年までは precision を下げて返す", () => {
    expect(parseJapaneseDate("2026年4月")).toEqual({
      date: "2026-04-01",
      precision: "month",
      era: null,
    });
    expect(parseJapaneseDate("2026年")).toEqual({
      date: "2026-01-01",
      precision: "year",
      era: null,
    });
  });

  it("全角で書かれていても読む", () => {
    expect(parseJapaneseDate("２０２６年４月１日")?.date).toBe("2026-04-01");
  });

  it("空白が入っていても読む（帳票では普通に混ざる）", () => {
    expect(parseJapaneseDate("2026 年 4 月 1 日")?.date).toBe("2026-04-01");
  });
});

describe("parseJapaneseDate — 和暦", () => {
  it("令和・平成・昭和を西暦に直す", () => {
    expect(parseJapaneseDate("令和6年4月1日")?.date).toBe("2024-04-01");
    expect(parseJapaneseDate("平成31年4月30日")?.date).toBe("2019-04-30");
    expect(parseJapaneseDate("昭和60年1月1日")?.date).toBe("1985-01-01");
  });

  it("元年を1年として読む（官公庁の資料で頻出）", () => {
    expect(parseJapaneseDate("令和元年5月1日")?.date).toBe("2019-05-01");
    expect(parseJapaneseDate("平成元年1月8日")?.date).toBe("1989-01-08");
  });

  it("元号名を残す（表示に使えるように）", () => {
    expect(parseJapaneseDate("令和6年4月1日")?.era).toBe("令和");
    expect(parseJapaneseDate("2024年4月1日")?.era).toBeNull();
  });

  it("略記は年月日が揃っている形だけ読む", () => {
    expect(parseJapaneseDate("R6.4.1")?.date).toBe("2024-04-01");
    expect(parseJapaneseDate("H31/4/30")?.date).toBe("2019-04-30");
    expect(parseJapaneseDate("S60-1-1")?.date).toBe("1985-01-01");
  });

  /**
   * 回帰テスト: 略記を緩く読むと、製品型番や部屋番号が日付になる。
   * 「R6」を令和6年と読んでしまうと、型番の列がまるごと日付列に化ける。
   */
  it("略記の年だけ（R6 / S60）は日付にしない", () => {
    expect(parseJapaneseDate("R6")).toBeNull();
    expect(parseJapaneseDate("S60")).toBeNull();
    expect(parseJapaneseDate("H2")).toBeNull();
  });

  it("元号の開始前になる組み合わせは弾く", () => {
    expect(parseJapaneseDate("令和0年1月1日")).toBeNull();
  });

  /**
   * 改元前に書かれた資料には「平成32年度」が実在する。書いた人の意図は
   * 2020年で正しいので、上限では弾かない。
   */
  it("改元をまたぐ表記（平成32年）は書き手の意図どおり読む", () => {
    expect(parseJapaneseDate("平成32年4月1日")?.date).toBe("2020-04-01");
  });
});

describe("parseJapaneseDate — 年度", () => {
  it("年度は期初（4月1日）に寄せ、precision で申告する", () => {
    expect(parseJapaneseDate("2026年度")).toEqual({
      date: "2026-04-01",
      precision: "fiscalYear",
      era: null,
    });
    expect(parseJapaneseDate("令和6年度")).toEqual({
      date: "2024-04-01",
      precision: "fiscalYear",
      era: "令和",
    });
  });
});

describe("parseJapaneseDate — 読まないもの", () => {
  it("実在しない日付は弾く", () => {
    expect(parseJapaneseDate("2026年2月30日")).toBeNull();
    expect(parseJapaneseDate("2026年13月1日")).toBeNull();
  });

  it("うるう年を正しく見る", () => {
    expect(parseJapaneseDate("2024年2月29日")?.date).toBe("2024-02-29");
    expect(parseJapaneseDate("2026年2月29日")).toBeNull();
  });

  /**
   * 年が無いものを当て推量で今年に寄せると、年をまたぐ集計が静かに狂う。
   * 期間表記も同じ理由で日付にしない。
   */
  it("年の無い日付・期間表記は日付にしない", () => {
    expect(parseJapaneseDate("4月1日")).toBeNull();
    expect(parseJapaneseDate("2026年4月1日〜2026年4月30日")).toBeNull();
  });

  it("ただの文字列・空文字は null", () => {
    expect(parseJapaneseDate("")).toBeNull();
    expect(parseJapaneseDate("営業部")).toBeNull();
    expect(parseJapaneseDate("2026")).toBeNull(); // 「年」が無ければ数値
  });
});

describe("parseColumnUnit", () => {
  it("金額の倍率を読む", () => {
    expect(parseColumnUnit("売上（千円）")).toEqual({
      label: "売上",
      scale: 1000,
      unit: "千円",
      currency: true,
    });
    expect(parseColumnUnit("売上高(百万円)")?.scale).toBe(1e6);
    expect(parseColumnUnit("利益【億円】")?.scale).toBe(1e8);
    expect(parseColumnUnit("金額[円]")?.scale).toBe(1);
  });

  /**
   * 回帰の芯: 「百万円」を「万円」より先に見ないと、100万倍が1万倍になる。
   * 桁が2つずれても数字は出るので、誰も気づけない種類の間違い。
   */
  it("百万円が万円に食われない", () => {
    expect(parseColumnUnit("売上（百万円）")?.unit).toBe("百万円");
    expect(parseColumnUnit("売上（万円）")?.scale).toBe(1e4);
  });

  it("「単位：千円」の書き方も読む", () => {
    expect(parseColumnUnit("売上（単位：千円）")?.scale).toBe(1000);
  });

  it("経理の書き方（税抜・税込）も読む", () => {
    expect(parseColumnUnit("売上（税抜千円）")?.scale).toBe(1000);
    expect(parseColumnUnit("売上高（税込百万円）")?.scale).toBe(1e6);
    expect(parseColumnUnit("原価（税抜千円単位）")?.scale).toBe(1000);
    // 表示用の綴りは基本形に揃えるので、軸ラベルが「税抜千円」で汚れない。
    expect(parseColumnUnit("売上（税抜千円）")?.unit).toBe("千円");
  });

  /**
   * 回帰の芯: 後方一致で読むと「見込」「実績」のような区分まで単位として
   * 食われ、「売上（見込千円）」と「売上（実績千円）」がどちらも列名「売上」
   * に化けて衝突する。知っている綴りだけを読むこと。
   */
  it("知らない前置きが付いていたら単位と見なさない", () => {
    expect(parseColumnUnit("売上（見込千円）")).toBeNull();
    expect(parseColumnUnit("売上（実績百万円）")).toBeNull();
  });

  it("「千円単位」の書き方も読み、表示用の単位は綴りを揃える", () => {
    expect(parseColumnUnit("売上（千円単位）")).toEqual({
      label: "売上",
      scale: 1000,
      unit: "千円",
      currency: true,
    });
    expect(parseColumnUnit("売上（百万円単位）")?.scale).toBe(1e6);
  });

  it("倍率を持たない単位も拾う", () => {
    expect(parseColumnUnit("構成比（%）")).toEqual({
      label: "構成比",
      scale: 1,
      unit: "%",
      currency: false,
    });
    expect(parseColumnUnit("受注（件）")?.unit).toBe("件");
  });

  /**
   * 括弧の中を無条件に単位とみなすと、「売上（前年比）」の列名が
   * 「売上」に化けて、隣の「売上（実績）」と同じ名前になり衝突する。
   */
  it("括弧の中が単位でなければ、単位として扱わない", () => {
    expect(parseColumnUnit("売上（前年比）")).toBeNull();
    expect(parseColumnUnit("担当者（営業部）")).toBeNull();
    expect(parseColumnUnit("備考")).toBeNull();
  });
});

describe("detectWideLayout", () => {
  it("月が横に並んだ表を見つける", () => {
    const layout = detectWideLayout(["部門", "4月", "5月", "6月"]);
    expect(layout).toEqual({
      idColumns: ["部門"],
      periodColumns: ["4月", "5月", "6月"],
      periodKind: "month",
      periodLabel: "月",
    });
  });

  it("識別列が複数あってもよい", () => {
    const layout = detectWideLayout(["部門", "担当者", "1月", "2月", "3月"]);
    expect(layout?.idColumns).toEqual(["部門", "担当者"]);
    expect(layout?.periodColumns).toHaveLength(3);
  });

  it("四半期・年・年月も見つける", () => {
    expect(detectWideLayout(["部門", "Q1", "Q2", "Q3"])?.periodKind).toBe("quarter");
    expect(detectWideLayout(["部門", "第1四半期", "第2四半期", "第3四半期"])?.periodKind).toBe("quarter");
    expect(detectWideLayout(["製品", "2024年", "2025年", "2026年"])?.periodKind).toBe("year");
    expect(detectWideLayout(["製品", "2026/01", "2026/02", "2026/03"])?.periodKind).toBe("yearMonth");
  });

  /**
   * 2列だけの「前年」「今年」を横持ちと誤認すると、比較表が壊れる。
   * 3列以上そろって初めて「並んでいる」と見なす。
   */
  it("期間らしい列が2つしかなければ横持ちと見なさない", () => {
    // 列数のガード（4列未満は見ない）に隠れないよう、識別列を2つ置いて
    // 全体は4列にしたうえで、期間列だけを2つにする。
    expect(detectWideLayout(["部門", "担当者", "2025年", "2026年"])).toBeNull();
    expect(detectWideLayout(["部門", "2025年", "2026年"])).toBeNull();
  });

  it("期間列がちょうど3つなら横持ちと見なす（境界）", () => {
    const layout = detectWideLayout(["部門", "2024年", "2025年", "2026年"]);
    expect(layout?.periodColumns).toEqual(["2024年", "2025年", "2026年"]);
  });

  it("識別列が1つも無ければ縦持ちにする意味が無いので null", () => {
    expect(detectWideLayout(["4月", "5月", "6月", "7月"])).toBeNull();
  });

  it("普通の縦持ちの表は触らない", () => {
    expect(detectWideLayout(["日付", "部門", "売上", "担当者"])).toBeNull();
    expect(detectWideLayout(["顧客名", "住所", "電話番号", "メール"])).toBeNull();
  });

  /**
   * 右端から遡って数えるのは、左にある「月次報告（2026年）」のような
   * タイトル列を期間列と間違えないため。
   */
  it("左端に年らしい列があっても、右側の連続だけを見る", () => {
    const layout = detectWideLayout(["2026年", "部門", "4月", "5月", "6月"]);
    expect(layout?.idColumns).toEqual(["2026年", "部門"]);
    expect(layout?.periodColumns).toEqual(["4月", "5月", "6月"]);
  });
});

describe("unpivot", () => {
  const headers = ["部門", "4月", "5月", "6月"];
  const rows: unknown[][] = [
    ["営業部", 120, 135, 150],
    ["開発部", 80, 90, 85],
  ];

  it("横持ちを縦持ちに直す", () => {
    const layout = detectWideLayout(headers)!;
    const out = unpivot(headers, rows, layout, "売上");
    expect(out.headers).toEqual(["部門", "月", "売上"]);
    expect(out.rows).toEqual([
      ["営業部", "4月", 120],
      ["営業部", "5月", 135],
      ["営業部", "6月", 150],
      ["開発部", "4月", 80],
      ["開発部", "5月", 90],
      ["開発部", "6月", 85],
    ]);
    expect(out.skipped).toBe(0);
  });

  /**
   * まだ数字が入っていない先の月まで 0 として並べると、折れ線が
   * 月末に向かって崖のように落ちる絵になる。空は行にしない。
   */
  it("空セルは行にせず、落とした数を申告する", () => {
    const layout = detectWideLayout(headers)!;
    const out = unpivot(headers, [["営業部", 120, null, ""]], layout);
    expect(out.rows).toEqual([["営業部", "4月", 120]]);
    expect(out.skipped).toBe(2);
  });

  it("0 は空ではないので残す", () => {
    const layout = detectWideLayout(headers)!;
    const out = unpivot(headers, [["営業部", 0, 0, 0]], layout);
    expect(out.rows).toHaveLength(3);
    expect(out.skipped).toBe(0);
  });
});
