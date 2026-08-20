/**
 * 実務でそのまま渡されてくる Excel の形。
 *
 * 生成器（tests/excel-patterns.test.ts）は癖を組み合わせて広く当たるが、
 * 「請求書テンプレート」「月次集計表」のような**まとまった1枚の書式**は
 * 偶然には出てこない。ここはその手書きの見本置き場で、見るのは
 *
 *   - 落ちないこと
 *   - 見出しをどの行から読んだか
 *   - **人にしか答えられないことを、ちゃんと質問として返すか**
 *
 * の3つ。取り込めてしまうこと自体より、「このままだと崩れます」と言えるか
 * どうかの方が大事な形が多い。
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readAllSheets } from "@/lib/excel";
import { heuristicAdvice, structuralQuestions } from "@/lib/import-advisor";

function scan(
  sheets: Array<{ name: string; rows: unknown[][]; merges?: XLSX.Range[]; hidden?: boolean }>,
) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    if (s.merges) ws["!merges"] = s.merges;
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  if (sheets.some((s) => s.hidden)) {
    wb.Workbook = {
      Sheets: sheets.map((s) => ({ name: s.name, Hidden: s.hidden ? 1 : 0 })),
    };
  }
  return readAllSheets(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
}

/** どんな形でも、提案と質問は必ず返ること。 */
function adviseSafely(sheets: ReturnType<typeof scan>) {
  const advice = heuristicAdvice(sheets);
  expect(Array.isArray(advice.sheets)).toBe(true);
  expect(Array.isArray(advice.questions)).toBe(true);
  return advice;
}

describe("請求書テンプレート", () => {
  /*
   * 人が読むための1枚。上に宛名と合計、途中から明細。
   * 1行1件ではないので、そのまま表として取り込んでも意味を成さない。
   */
  const sheets = () =>
    scan([
      {
        name: "請求書",
        rows: [
          ["御 請 求 書"],
          [],
          ["株式会社サンプル 御中", "", "", "請求日", "2026-04-30"],
          ["", "", "", "請求番号", "INV-2026-0041"],
          [],
          ["ご請求金額", "¥1,234,000"],
          [],
          ["品目", "数量", "単価", "金額"],
          ["ライセンス費用", 10, 50000, 500000],
          ["導入支援", 1, 700000, 700000],
          ["", "", "小計", 1200000],
          ["", "", "消費税", 34000],
          ["", "", "合計", 1234000],
        ],
        merges: [
          { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
          { s: { r: 5, c: 1 }, e: { r: 5, c: 3 } },
        ],
      },
    ]);

  it("落ちずに読め、結合セルを位置つきで指摘する", () => {
    const parsed = sheets();
    const q = structuralQuestions(parsed);
    const merge = q.find((x) => x.message.includes("結合"));
    expect(merge).toBeDefined();
    expect(merge!.question).not.toBe("");
    adviseSafely(parsed);
  });

  it("1行目ではなく、明細の見出し行を選ぶ", () => {
    const parsed = sheets();
    // 「品目 / 数量 / 単価 / 金額」が本当の見出し。
    expect(parsed[0].headers).toContain("品目");
    expect(parsed[0].headers).toContain("金額");
    expect(parsed[0].headerRowIndex).toBeGreaterThan(0);
  });

  it("見出し行がずれていることを、質問として伝える", () => {
    const q = structuralQuestions(sheets());
    expect(q.some((x) => x.message.includes("見出し"))).toBe(true);
  });
});

describe("月次集計表（横に月が並ぶ）", () => {
  /*
   * 1列1月の横持ち。取り込むと「2026年4月」という名前の列ができる。
   * 崩れてはいないので取り込めるが、上段の年が結合されている点は伝えたい。
   */
  const parsed = () =>
    scan([
      {
        name: "月次",
        rows: [
          ["", "2026年度", "", "", ""],
          ["部門", "4月", "5月", "6月", "7月"],
          ["営業部", 1200000, 1350000, 980000, 1500000],
          ["開発部", 800000, 820000, 790000, 810000],
          ["合計", 2000000, 2170000, 1770000, 2310000],
        ],
        merges: [{ s: { r: 0, c: 1 }, e: { r: 0, c: 4 } }],
      },
    ]);

  it("月の列がそのまま項目になる", () => {
    const p = parsed();
    expect(p[0].headers).toEqual(["部門", "4月", "5月", "6月", "7月"]);
  });

  it("合計行はデータとして数えない", () => {
    // 「合計」だけの行を1件として数えると、部門数が1つ多く見える。
    const p = parsed();
    expect(p[0].rowCount).toBe(2);
  });

  it("上段の結合（2026年度）を指摘する", () => {
    const q = structuralQuestions(parsed());
    expect(q.some((x) => x.message.includes("結合"))).toBe(true);
  });
});

describe("2段見出しの名簿", () => {
  /*
   * 「氏名」の下に「漢字 / カナ」がぶら下がる形。結合を解除しないと
   * 上段が空欄になり、列名が消える。
   */
  const parsed = () =>
    scan([
      {
        name: "名簿",
        rows: [
          ["社員番号", "氏名", "", "所属", "入社日"],
          ["", "漢字", "カナ", "", ""],
          ["E001", "山田 太郎", "ヤマダ タロウ", "営業部", "2020-04-01"],
          ["E002", "鈴木 花子", "スズキ ハナコ", "開発部", "2021-10-01"],
        ],
        merges: [{ s: { r: 0, c: 1 }, e: { r: 0, c: 2 } }],
      },
    ]);

  it("名前の無い列を、仮の名前で埋めて質問に出す", () => {
    const p = parsed();
    const q = structuralQuestions(p);
    // 上段が結合されているので、どこかの列名が空欄になる。
    const hasBlank = p[0].headers.some((h) => /^列\d+$/.test(h));
    if (hasBlank) {
      expect(q.some((x) => x.message.includes("列名が空欄"))).toBe(true);
    }
    // いずれにせよ結合は必ず伝える。
    expect(q.some((x) => x.message.includes("結合"))).toBe(true);
  });

  it("項目キーは重複せず、濁点も残る", () => {
    const p = parsed();
    const keys = p[0].inferredFields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(/[゙゚]/.test(k)).toBe(false);
  });
});

describe("同じ列名が並ぶ表", () => {
  const parsed = () =>
    scan([
      {
        name: "見積",
        rows: [
          ["品目", "金額", "金額", "備考"],
          ["A", 1000, 1100, "税抜/税込"],
          ["B", 2000, 2200, ""],
        ],
      },
    ]);

  it("連番を付けて開き、どちらが何かを聞く", () => {
    const p = parsed();
    expect(p[0].headers).toEqual(["品目", "金額", "金額-2", "備考"]);
    const q = structuralQuestions(p);
    expect(q.some((x) => x.message.includes("同じ列名"))).toBe(true);
  });
});

describe("作業用の非表示タブが混ざったファイル", () => {
  const parsed = () =>
    scan([
      {
        name: "受注一覧",
        rows: [
          ["受注日", "取引先", "金額"],
          ["2026-04-01", "山田商事", 120000],
          ["2026-04-02", "高橋物流", 80000],
        ],
      },
      {
        name: "計算用",
        rows: [
          ["キー", "係数"],
          ["A", 1.1],
          ["B", 1.2],
        ],
        hidden: true,
      },
    ]);

  it("非表示タブは既定で外すが、列の提案は用意しておく", () => {
    const p = parsed();
    const advice = adviseSafely(p);
    const hidden = advice.sheets.find((s) => s.sheetName === "計算用");
    expect(hidden?.include).toBe(false);
    expect(hidden?.reason).toContain("非表示");
    // 利用者が「やっぱり入れる」を選んだときに、列名を直せる状態にしておく。
    expect(advice.columns["計算用"]).toHaveLength(2);
  });
});

describe("空のタブと、注記だけのタブ", () => {
  it("空タブは取り込み対象にせず、理由を返す", () => {
    const p = scan([
      { name: "はじめに", rows: [["このファイルは月次の売上です。"]] },
      { name: "空", rows: [[]] },
      {
        name: "売上",
        rows: [
          ["日付", "金額"],
          ["2026-04-01", 1000],
        ],
      },
    ]);
    const advice = adviseSafely(p);
    expect(advice.sheets.find((s) => s.sheetName === "空")?.include).toBe(false);
    expect(advice.sheets.find((s) => s.sheetName === "はじめに")?.include).toBe(false);
    expect(advice.sheets.find((s) => s.sheetName === "売上")?.include).toBe(true);
  });
});

describe("数字が文字として入っている表", () => {
  it("「¥1,234」「1,234円」「１２３４」を数値として読む", () => {
    const p = scan([
      {
        name: "売上",
        rows: [
          ["日付", "税抜", "税込", "全角"],
          ["2026-04-01", "¥1,234", "1,234円", "１２３４"],
          ["2026-04-02", "¥2,000", "2,200円", "２０００"],
        ],
      },
    ]);
    const types = Object.fromEntries(
      p[0].inferredFields.map((f) => [f.name, f.type]),
    );
    expect(types["税抜"]).toBe("currency");
    expect(types["税込"]).toBe("currency");
    expect(types["全角"]).toBe("number");
  });
});

describe("見出しに、下がずっと空の列がある表", () => {
  /*
   * 【回帰防止】見出しの選び方を「下の行との似ている度合い」で測っていたとき、
   * 数式列（キャッシュが無く全行空）の1列ぶんだけ見出しが減点され、
   * **1行目のデータが見出しに選ばれて**いた。見出しは「下で使われている列に
   * 名前を付けるもの」なので、その向きだけを見る。
   */
  it("空の列があっても、1行目を見出しとして選ぶ", () => {
    const p = scan([
      {
        name: "案件",
        rows: [
          ["案件ID", "商品名", "チャネル", "見込額"],
          ["P-001", "商品A", "Web", ""],
          ["P-002", "商品B", "紹介", ""],
          ["P-003", "商品C", "セミナー", ""],
          ["P-004", "商品D", "Web", ""],
        ],
      },
    ]);
    expect(p[0].headerRowIndex).toBe(0);
    expect(p[0].headers).toEqual(["案件ID", "商品名", "チャネル", "見込額"]);
    expect(p[0].rowCount).toBe(4);
  });
});

describe("埋まりきった合計行", () => {
  /*
   * 【回帰防止】「合計 / 2,000,000 / 2,170,000 / …」のように全列が埋まる
   * 合計行は、「半分未満しか埋まっていない」規則をすり抜けてデータ行として
   * 残っていた。列の合計を出すと自分自身の合計を二重に足すので、売上が倍の
   * 数字になる——エラーは出ないので、いちばん気づけない壊れ方をする。
   */
  it("合計行を明細として数えない", () => {
    const p = scan([
      {
        name: "月次",
        rows: [
          ["部門", "4月", "5月"],
          ["営業部", 1200000, 1350000],
          ["開発部", 800000, 820000],
          ["合計", 2000000, 2170000],
        ],
      },
    ]);
    expect(p[0].rowCount).toBe(2);
    expect(p[0].previewRows.map((r) => r["部門"])).toEqual(["営業部", "開発部"]);
  });

  it("「合計」が区分名として入っているだけの行は残す", () => {
    // 他の列に文字が入っていれば、それは集計ではなくデータ。
    const p = scan([
      {
        name: "区分別",
        rows: [
          ["区分", "担当", "金額"],
          ["個別", "山田", 1000],
          ["合計", "鈴木", 2000],
        ],
      },
    ]);
    expect(p[0].rowCount).toBe(2);
  });
});
