/**
 * データ整備（表記ゆれ・重複行）。
 *
 * この機能の失敗は、ほかの機能と形が違う。**間違えても画面は壊れない**——
 * ただ「まとめませんか」という間違った提案が出るだけで、押した人が
 * データを壊す。だから守るべき線は2本ある。
 *
 *   1. 同じものを、同じと見つけられること（見つけられなければ機能が無いのと同じ）
 *   2. **違うものを、同じと言わないこと**（押されたら戻せない）
 *
 * 2本目のほうが重い。以下、「まとめてはいけない」側のテストが多いのはそのため。
 */
import { describe, it, expect } from "vitest";
import {
  normalizeLabel,
  findVariants,
  findDuplicateRows,
  isTidyCandidate,
  tidyReport,
} from "@/lib/tidy";

/** 値の配列を作る短縮。 */
function times(value: string, n: number): string[] {
  return Array.from({ length: n }, () => value);
}

/* ========================================================================== */
describe("normalizeLabel — 同じものを同じキーにする", () => {
  it("全角と半角", () => {
    expect(normalizeLabel("ＡＢＣ商事")).toBe(normalizeLabel("ABC商事"));
    expect(normalizeLabel("ｱｲｳ物産")).toBe(normalizeLabel("アイウ物産"));
  });

  it("前後と途中の空白（全角空白を含む）", () => {
    expect(normalizeLabel(" 山田 商事 ")).toBe(normalizeLabel("山田　商事"));
  });

  it("大文字・小文字", () => {
    expect(normalizeLabel("Tokyo")).toBe(normalizeLabel("TOKYO"));
  });

  it("ハイフンの種類", () => {
    expect(normalizeLabel("東京—支店")).toBe(normalizeLabel("東京-支店"));
    expect(normalizeLabel("東京−支店")).toBe(normalizeLabel("東京-支店"));
  });

  it("語尾の長音", () => {
    expect(normalizeLabel("サーバー")).toBe(normalizeLabel("サーバ"));
    expect(normalizeLabel("センター")).toBe(normalizeLabel("センタ"));
  });

  /**
   * 長音を全部落とすと、カタカナ語が軒並み壊れる。落とすのは末尾の1文字だけ。
   * これを外すと「コーヒー」と「ココア」が同じキーになりかねない。
   */
  it("途中の長音は落とさない", () => {
    expect(normalizeLabel("コーヒー")).not.toBe(normalizeLabel("コヒ"));
    expect(normalizeLabel("コーヒー")).toBe(normalizeLabel("コーヒ"));
  });

  it("法人格の有無（前でも後ろでも）", () => {
    const k = normalizeLabel("山田商事");
    expect(normalizeLabel("株式会社山田商事")).toBe(k);
    expect(normalizeLabel("山田商事株式会社")).toBe(k);
    expect(normalizeLabel("(株)山田商事")).toBe(k);
    expect(normalizeLabel("㈱山田商事")).toBe(k);
    expect(normalizeLabel("有限会社山田商事")).toBe(k);
  });

  /** 「株式会社」だけの行を、空のキーにまとめてしまわない。 */
  it("法人格だけの値は、そのまま残す", () => {
    expect(normalizeLabel("株式会社")).not.toBe("");
    expect(normalizeLabel("株式会社")).not.toBe(normalizeLabel("(株)"));
  });

  /** ここを畳むと、実際には別の会社が1つにまとまる。 */
  it("名前そのものが違えば、まとめない", () => {
    expect(normalizeLabel("山田商事")).not.toBe(normalizeLabel("山本商事"));
    expect(normalizeLabel("東京支店")).not.toBe(normalizeLabel("東京本店"));
  });
});

/* ========================================================================== */
describe("findVariants — 何を提案するか", () => {
  it("ゆれている群だけを返す", () => {
    const groups = findVariants([
      ...times("株式会社山田商事", 5),
      ...times("(株)山田商事", 3),
      ...times("山田商事", 1),
      // こちらはゆれていないので出さない。
      ...times("鈴木工業", 4),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants).toHaveLength(3);
  });

  it("一番多い書き方を統一先として提案する", () => {
    const groups = findVariants([
      ...times("株式会社山田商事", 5),
      ...times("(株)山田商事", 3),
      ...times("山田商事", 1),
    ]);
    expect(groups[0].suggested).toBe("株式会社山田商事");
    // 書き換わるのは、提案した書き方以外の全部。
    expect(groups[0].affected).toBe(4);
  });

  /**
   * なぜ同じと見なしたかを言えること。「まとめました」だけでは、
   * 正しいかどうかを確かめようがない。
   */
  it("まとめた理由を段階の名前で返す", () => {
    const g = findVariants([...times("株式会社山田商事", 2), "山田商事"])[0];
    expect(g.kinds).toContain("company");

    const w = findVariants([...times("ＡＢＣ商事", 2), "ABC商事"])[0];
    expect(w.kinds).toContain("width");
    expect(w.kinds).not.toContain("company");
  });

  it("直せる行数の多い順に並ぶ", () => {
    const groups = findVariants([
      ...times("あいう", 2),
      "アイウ社A",
      ...times("Ｂ社", 5),
      ...times("B社", 5),
    ]);
    expect(groups[0].variants[0].value).toContain("社");
    expect(groups[0].affected).toBe(5);
  });

  it("空とnullは数えない", () => {
    const groups = findVariants(["山田商事", "", null, undefined, "  ", "(株)山田商事"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants.map((v) => v.count)).toEqual([1, 1]);
  });

  /**
   * 同じ入力なら同じ並びが出ること。表記ゆれの一覧は「先週と比べて何が
   * 直ったか」を見るものなので、実行のたびに並びが変わると使えない。
   */
  it("並びが揺れない", () => {
    const input = [
      ...times("A社", 2),
      ...times("Ａ社", 2),
      ...times("B社", 2),
      ...times("Ｂ社", 2),
    ];
    const a = findVariants(input).map((g) => g.suggested);
    const b = findVariants([...input].reverse()).map((g) => g.suggested);
    expect(a).toEqual(b);
  });
});

/* ========================================================================== */
describe("findDuplicateRows — 厳しく見る", () => {
  const F = ["torihikisaki", "hizuke", "kingaku"];
  const row = (id: string, t: string, h: string, k: number) => ({
    id,
    data: { torihikisaki: t, hizuke: h, kingaku: k },
  });

  it("全項目が同じ行をまとめる", () => {
    const dup = findDuplicateRows(
      [
        row("1", "山田商事", "2026-04-01", 10000),
        row("2", "山田商事", "2026-04-01", 10000),
        row("3", "鈴木工業", "2026-04-01", 10000),
      ],
      F,
    );
    expect(dup).toHaveLength(1);
    expect(dup[0].ids).toEqual(["1", "2"]);
  });

  /**
   * ここが一番大事。同じ日に同じ相手と2件取引することは普通にある。
   * 金額が違えば別の取引なので、重複と呼んではいけない——呼べば、
   * 消してはいけない行を消させることになる。
   */
  it("1項目でも違えば重複と呼ばない", () => {
    const dup = findDuplicateRows(
      [
        row("1", "山田商事", "2026-04-01", 10000),
        row("2", "山田商事", "2026-04-01", 12000),
      ],
      F,
    );
    expect(dup).toHaveLength(0);
  });

  it("空白と全角・半角の違いだけなら重複と見る", () => {
    const dup = findDuplicateRows(
      [
        row("1", "ＡＢＣ商事", "2026-04-01", 10000),
        row("2", " ABC商事 ", "2026-04-01", 10000),
      ],
      F,
    );
    expect(dup).toHaveLength(1);
  });

  /** 複数選択の項目は、並び順の違いで別物にしない。 */
  it("複数選択は並び順を無視する", () => {
    const dup = findDuplicateRows(
      [
        { id: "1", data: { tags: ["a", "b"] } },
        { id: "2", data: { tags: ["b", "a"] } },
      ],
      ["tags"],
    );
    expect(dup).toHaveLength(1);
  });

  /**
   * 比べる項目が無ければ、全行が「同じ」になる。全件を重複として報告する
   * のは明らかに嘘なので、何も返さない。
   */
  it("比べる項目が無ければ何も返さない", () => {
    const dup = findDuplicateRows([row("1", "a", "b", 1), row("2", "c", "d", 2)], []);
    expect(dup).toHaveLength(0);
  });
});

/* ========================================================================== */
describe("isTidyCandidate — 見る列を選ぶ", () => {
  it("区分らしい列は見る", () => {
    expect(isTidyCandidate([...times("東京", 5), ...times("大阪", 5)])).toBe(true);
  });

  /** ID・コードは全部が一意なので、ゆれようがない。 */
  it("全部が一意な列（ID・コード）は見ない", () => {
    expect(isTidyCandidate(Array.from({ length: 20 }, (_, i) => `ID-${i}`))).toBe(
      false,
    );
  });

  it("値が1種類しか無い列は見ない", () => {
    expect(isTidyCandidate(times("同じ", 20))).toBe(false);
  });

  /** 行が少ないと、たまたま一意なだけなのか判断できない。 */
  it("行が少なすぎるうちは判断しない", () => {
    expect(isTidyCandidate(["東京", "大阪", "東京"])).toBe(false);
  });
});

/* ========================================================================== */
describe("tidyReport — 表1枚ぶん", () => {
  const fields = [
    { key: "id", name: "伝票番号", type: "text" },
    { key: "saki", name: "取引先", type: "text" },
    { key: "kingaku", name: "金額", type: "number" },
    { key: "hi", name: "日付", type: "date" },
  ];

  const records = [
    ...times("株式会社山田商事", 6),
    ...times("(株)山田商事", 4),
    ...times("鈴木工業", 5),
  ].map((saki, i) => ({
    id: `r${i}`,
    data: { id: `D-${i}`, saki, kingaku: 1000 + i, hi: "2026-04-01" },
  }));

  const report = tidyReport(fields, records);

  it("文字の列だけを見る（数値・日付は見ない）", () => {
    expect(report.columns.map((c) => c.fieldKey)).toEqual(["saki"]);
  });

  it("書き換わる行数を出す", () => {
    expect(report.totalAffected).toBe(4);
  });

  it("伝票番号のような一意の列は候補から外す", () => {
    expect(report.columns.some((c) => c.fieldKey === "id")).toBe(false);
  });

  it("重複が無ければ0件と言う", () => {
    // 伝票番号と金額が全行で違うので、重複は無い。
    expect(report.duplicates).toHaveLength(0);
    expect(report.duplicateRows).toBe(0);
  });

  it("整備するところが無い表では、空で返す", () => {
    const clean = tidyReport(fields, [
      ...times("東京", 5),
      ...times("大阪", 5),
    ].map((saki, i) => ({
      id: `c${i}`,
      data: { id: `E-${i}`, saki, kingaku: i, hi: "2026-04-01" },
    })));
    expect(clean.columns).toHaveLength(0);
    expect(clean.totalAffected).toBe(0);
  });
});
