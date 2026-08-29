/**
 * 定期支払いの検出。
 *
 * ここで守りたいのは精度ではなく**嘘をつかないこと**。この機能の失敗は
 * 2種類あって、害の大きさがまるで違う。
 *
 *   ① 実在しない定期支払いを報告する  … 利用者は解約できないものを探しに行く
 *   ② 実在するものを見落とす          … 何も出ないだけ
 *
 * ①を絶対に起こさないために、判定は「迷ったら通さない」側へ倒してある。
 * 以下のテストの多くは、①が起きる具体的な入力を固定するために書いてある——
 * コンビニの買い物、たまたま2回買ったもの、別々の店舗。
 */
import { describe, it, expect } from "vitest";
import {
  detectRecurring,
  normalizeMerchant,
  classifyCadence,
  detectChargeColumns,
  MIN_OCCURRENCES,
  type Charge,
} from "@/lib/recurring";

/** "2026-01-10" → その日のローカル 0時。 */
function d(iso: string): Date {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y, m - 1, day);
}

function charge(iso: string, label: string, amount: number): Charge {
  return { date: d(iso), label, amount };
}

/** 毎月同じ日に、同じ額で n 回。 */
function monthlySeries(
  startIso: string,
  label: string,
  amount: number,
  n: number,
): Charge[] {
  const [y, m, day] = startIso.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(y, m - 1 + i, day),
    label,
    amount,
  }));
}

const ASOF = d("2026-08-30");

/* ========================================================================== */
describe("normalizeMerchant — まとめすぎない", () => {
  it("全角と半角を同じものとして扱う", () => {
    expect(normalizeMerchant("ＮＥＴＦＬＩＸ")).toBe(
      normalizeMerchant("NETFLIX"),
    );
  });

  it("取引参照コードを落とす（Amazon が毎回別物にならない）", () => {
    const a = normalizeMerchant("AMAZON.CO.JP*M12AB3CD4");
    const b = normalizeMerchant("AMAZON.CO.JP*X98YZ7WV6");
    expect(a).toBe(b);
    expect(a).toContain("amazon.co.jp");
  });

  it("電話番号を落とす", () => {
    expect(normalizeMerchant("NETFLIX.COM 866-579-7172")).toBe(
      normalizeMerchant("NETFLIX.COM"),
    );
  });

  /**
   * 「* のあとを捨てる」という単純な規則にしてはいけない理由。
   * Google / PayPal 系は * のあとが**本当のサービス名**なので、捨てると
   * 別々のサブスクが1つの巨大な定期支払いに潰れる。
   */
  it("* のあとが名前なら残す（Google Play の課金を1つに潰さない）", () => {
    const yt = normalizeMerchant("GOOGLE *YouTubePremium");
    const drive = normalizeMerchant("GOOGLE *GoogleOne");
    expect(yt).not.toBe(drive);
    expect(yt).toContain("youtubepremium");
  });

  it("数字を含まない全部大文字の語は名前として残す", () => {
    expect(normalizeMerchant("NETFLIX")).toBe("netflix");
    expect(normalizeMerchant("SPOTIFY")).toBe("spotify");
  });

  /**
   * 店舗を畳むと、コンビニ全体が「毎週の定期支払い」に化ける。
   * 分けすぎるぶんには回数が足りずに報告されないだけなので、こちらへ倒す。
   */
  it("店舗名は残す（別々の店を1つにしない）", () => {
    const shibuya = normalizeMerchant("ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ/ﾄｳｷｮｳｼﾌﾞﾔ");
    const shinjuku = normalizeMerchant("ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ/ﾄｳｷｮｳｼﾝｼﾞｭｸ");
    expect(shibuya).not.toBe(shinjuku);
  });

  it("すべてが識別子でも空のキーを作らない", () => {
    // 空のキーを許すと、無関係な明細が「名前の無い1件」に集まる。
    expect(normalizeMerchant("123456 987654")).not.toBe("");
  });
});

/* ========================================================================== */
describe("classifyCadence", () => {
  it("代表的な間隔を分類する", () => {
    expect(classifyCadence(7)).toBe("weekly");
    expect(classifyCadence(30)).toBe("monthly");
    expect(classifyCadence(91)).toBe("quarterly");
    expect(classifyCadence(365)).toBe("yearly");
  });

  /** 月末が引き落とし日だと 28〜31 で揺れる。日本ではむしろ多数派。 */
  it("月末の揺れを月次として受ける", () => {
    for (const days of [26, 28, 29, 30, 31, 35]) {
      expect(classifyCadence(days)).toBe("monthly");
    }
  });

  it("どの周期でもない間隔は null（無理に当てない）", () => {
    expect(classifyCadence(15)).toBeNull();
    expect(classifyCadence(60)).toBeNull();
    expect(classifyCadence(200)).toBeNull();
    expect(classifyCadence(0)).toBeNull();
  });

  /**
   * 幅が重なると、1つの間隔が2種類に該当してしまい「どちらを採るか」という
   * 答えの無い判断が要る。重なっていないことを固定しておく。
   */
  it("周期の幅どうしが重ならない", () => {
    const seen = new Map<number, string>();
    for (let days = 1; days <= 400; days += 1) {
      const c = classifyCadence(days);
      if (c) {
        expect(seen.has(days)).toBe(false);
        seen.set(days, c);
      }
    }
  });
});

/* ========================================================================== */
describe("detectRecurring — 見つける", () => {
  it("毎月同額を3回で定期と認める", () => {
    const r = detectRecurring(
      monthlySeries("2026-06-10", "NETFLIX", 1490, 3),
      ASOF,
    );
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0].cadence).toBe("monthly");
    expect(r.charges[0].amount).toBe(1490);
    expect(r.charges[0].variable).toBe(false);
    expect(r.charges[0].occurrences).toBe(3);
    expect(r.monthlyTotal).toBe(1490);
  });

  /**
   * 2回では認めない。ここを緩めると、たまたま1か月あけて2回買ったものが
   * すべてサブスクとして並び、報告の大半が誤検出で埋まる。
   */
  it(`${MIN_OCCURRENCES}回に満たなければ認めない`, () => {
    const r = detectRecurring(
      monthlySeries("2026-07-10", "NETFLIX", 1490, 2),
      ASOF,
    );
    expect(r.charges).toHaveLength(0);
    expect(r.unmatched).toBe(2);
  });

  it("月末が引き落とし日でも取りこぼさない", () => {
    const r = detectRecurring(
      [
        charge("2026-05-31", "サブスクA", 980),
        charge("2026-06-30", "サブスクA", 980),
        charge("2026-07-31", "サブスクA", 980),
        charge("2026-08-31", "サブスクA", 980),
      ],
      ASOF,
    );
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0].cadence).toBe("monthly");
  });

  it("年1回のものを見つけ、月あたりに直す", () => {
    const r = detectRecurring(
      [
        charge("2024-03-01", "ドメイン更新", 1200),
        charge("2025-03-01", "ドメイン更新", 1200),
        charge("2026-03-01", "ドメイン更新", 1200),
      ],
      ASOF,
    );
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0].cadence).toBe("yearly");
    expect(r.charges[0].monthlyEquivalent).toBe(100);
  });

  /** 電気・ガスは従量で額が動くが、引き落とし日は動かない。立派な固定費。 */
  it("額が毎回変わる定期支払い（電気・ガス）も認める", () => {
    const r = detectRecurring(
      [
        charge("2026-05-15", "東京電力エナジーパートナー", 8200),
        charge("2026-06-15", "東京電力エナジーパートナー", 11500),
        charge("2026-07-15", "東京電力エナジーパートナー", 9800),
        charge("2026-08-15", "東京電力エナジーパートナー", 7600),
      ],
      ASOF,
    );
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0].variable).toBe(true);
    expect(r.charges[0].cadence).toBe("monthly");
  });

  /**
   * カードの期限切れで1か月止まり、翌月から再開する——実際によくある。
   * 額が一定なら、間隔が1回飛んでも定期と認める。
   */
  it("定額なら1回飛んでも認める", () => {
    const r = detectRecurring(
      [
        charge("2026-01-10", "SPOTIFY", 980),
        charge("2026-02-10", "SPOTIFY", 980),
        // 3月が飛ぶ
        charge("2026-04-10", "SPOTIFY", 980),
        charge("2026-05-10", "SPOTIFY", 980),
      ],
      d("2026-05-20"),
    );
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0].occurrences).toBe(4);
  });
});

/* ========================================================================== */
describe("detectRecurring — 通さない", () => {
  /**
   * この機能で一番やってはいけない誤検出。毎週同じコンビニに寄る人の買い物を
   * 「毎週の定期支払い」として並べると、利用者は解約できないものを解約しに行く。
   * 間隔がどれだけ規則的でも、額が動く週次は買い物の習慣であって課金ではない。
   */
  it("毎週同じ店の買い物を定期支払いにしない", () => {
    const r = detectRecurring(
      [
        charge("2026-08-01", "ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ/ｼﾌﾞﾔ", 820),
        charge("2026-08-08", "ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ/ｼﾌﾞﾔ", 1240),
        charge("2026-08-15", "ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ/ｼﾌﾞﾔ", 650),
        charge("2026-08-22", "ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ/ｼﾌﾞﾔ", 1530),
      ],
      ASOF,
    );
    expect(r.charges).toHaveLength(0);
  });

  /** 額が動くものは間隔が全部そろっていることを求める。 */
  it("額が動くうえに間隔もばらつくものは通さない", () => {
    const r = detectRecurring(
      [
        charge("2026-04-03", "ドラッグストア", 3200),
        charge("2026-05-01", "ドラッグストア", 1180),
        charge("2026-07-02", "ドラッグストア", 5400),
        charge("2026-08-01", "ドラッグストア", 2250),
      ],
      ASOF,
    );
    expect(r.charges).toHaveLength(0);
  });

  it("間隔がどの周期にも当てはまらないものは通さない", () => {
    const r = detectRecurring(
      [
        charge("2026-06-01", "不定期の店", 3000),
        charge("2026-06-16", "不定期の店", 3000),
        charge("2026-07-01", "不定期の店", 3000),
      ],
      ASOF,
    );
    expect(r.charges).toHaveLength(0);
  });

  it("返金（0以下）は材料にしない", () => {
    const r = detectRecurring(
      [
        ...monthlySeries("2026-06-10", "NETFLIX", 1490, 3),
        charge("2026-07-11", "NETFLIX", -1490),
      ],
      ASOF,
    );
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0].occurrences).toBe(3);
    expect(r.unmatched).toBe(1);
  });

  /**
   * 同じ日に複数本立つ支払い（Amazon の商品ごと課金など）は実際にある。
   * 同日を畳まずに間隔を取ると 0 が大量に混じり、間隔の中央値が 0 になって
   * **月次の支払いが1件も見つからなくなる**。1〜2本の重複では中央値が
   * 動かないので気づけない——気づけるのは、毎回3本ずつ立つこの形。
   */
  it("同日に何本も立つ支払いでも周期を見失わない", () => {
    const sameDayTriple = (iso: string) => [
      charge(iso, "サブスクB", 500),
      charge(iso, "サブスクB", 500),
      charge(iso, "サブスクB", 500),
    ];
    const r = detectRecurring(
      [
        ...sameDayTriple("2026-06-10"),
        ...sameDayTriple("2026-07-10"),
        ...sameDayTriple("2026-08-10"),
      ],
      ASOF,
    );
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0].cadence).toBe("monthly");
    // 畳むのは間隔を取るときだけ。回数は実際の明細の本数を出す。
    expect(r.charges[0].occurrences).toBe(9);
  });
});

/* ========================================================================== */
describe("detectRecurring — 止まったもの", () => {
  /**
   * 「いま払っているもの」の合計に、去年やめたサブスクを混ぜてはいけない。
   * 合計が実態より大きく出ると、この画面は数字として信用できなくなる。
   */
  it("最後の支払いから間隔の2倍以上あいていたら止まったと見なす", () => {
    const r = detectRecurring(
      monthlySeries("2026-01-10", "解約済みサービス", 1000, 3),
      d("2026-08-30"), // 最後が 3/10 なので 170日以上あいている
    );
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0].active).toBe(false);
    expect(r.endedCount).toBe(1);
    // 合計に入れない。
    expect(r.monthlyTotal).toBe(0);
  });

  it("続いているものだけを合計する", () => {
    const r = detectRecurring(
      [
        ...monthlySeries("2026-06-10", "いま契約中", 1490, 3),
        ...monthlySeries("2025-01-10", "去年やめた", 5000, 3),
      ],
      ASOF,
    );
    expect(r.charges).toHaveLength(2);
    expect(r.monthlyTotal).toBe(1490);
    expect(r.yearlyTotal).toBe(1490 * 12);
    expect(r.endedCount).toBe(1);
  });
});

/* ========================================================================== */
describe("detectRecurring — 並びと表示", () => {
  /**
   * 同じファイルから毎回同じ画面が出ることが、この機能の前提。
   * 並びが実行のたびに変わると「先月と何が変わったか」を見比べられない。
   */
  it("月換算の大きい順で、同額なら名前順（並びが揺れない）", () => {
    const input = [
      ...monthlySeries("2026-06-01", "Bサービス", 1000, 3),
      ...monthlySeries("2026-06-02", "Aサービス", 1000, 3),
      ...monthlySeries("2026-06-03", "高いサービス", 9800, 3),
    ];
    const first = detectRecurring(input, ASOF).charges.map((c) => c.label);
    const again = detectRecurring([...input].reverse(), ASOF).charges.map(
      (c) => c.label,
    );
    expect(first).toEqual(["高いサービス", "Aサービス", "Bサービス"]);
    expect(again).toEqual(first);
  });

  it("表示名はグループで一番多く出てきた綴りを使う", () => {
    const r = detectRecurring(
      [
        charge("2026-06-10", "AMAZON.CO.JP*AAA111", 500),
        charge("2026-07-10", "AMAZON.CO.JP*BBB222", 500),
        charge("2026-08-10", "AMAZON.CO.JP*BBB222", 500),
      ],
      ASOF,
    );
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0].label).toBe("AMAZON.CO.JP*BBB222");
  });

  it("何も無ければ空で返す（0件を0件と言う）", () => {
    const r = detectRecurring([], ASOF);
    expect(r.charges).toHaveLength(0);
    expect(r.monthlyTotal).toBe(0);
    expect(r.yearlyTotal).toBe(0);
    expect(r.unmatched).toBe(0);
  });
});

/* ========================================================================== */
describe("detectChargeColumns — 推測で埋めない", () => {
  const f = (key: string, name: string, type: string) => ({ key, name, type });

  it("よくある列名から日付・摘要・金額を選ぶ", () => {
    const cols = detectChargeColumns([
      f("riyoubi", "ご利用日", "date"),
      f("tenmei", "ご利用先", "text"),
      f("kingaku", "ご利用金額", "currency"),
      f("memo", "備考", "text"),
    ]);
    expect(cols).toEqual({
      dateKey: "riyoubi",
      labelKey: "tenmei",
      amountKey: "kingaku",
    });
  });

  /**
   * 名前が当たらない列も、他の2本が名前で当たっていれば受け入れる。
   * 摘要の列名は会社ごとの揺れが一番大きいので、ここを厳しくすると
   * 本物の明細まで落ちる。
   */
  it("他の2本が名前で当たっていれば、残り1本は名前が当たらなくてよい", () => {
    const cols = detectChargeColumns([
      f("a", "ご利用日", "date"),
      f("b", "なに", "text"),
      f("c", "ご利用金額", "currency"),
    ]);
    expect(cols?.labelKey).toBe("b");
  });

  /**
   * 逆に、名前で当たったのが1本だけなら通さない。型と本数だけで決めると、
   * 明細でない表（案件一覧・在庫表）まで明細に見える。
   * 詳しくは tests/statement-columns.test.ts。
   */
  it("名前で当たったのが1本だけなら諦める", () => {
    expect(
      detectChargeColumns([
        f("a", "いつ", "date"),
        f("b", "なに", "text"),
        f("c", "いくら", "currency"),
      ]),
    ).toBeNull();
  });

  /**
   * 列を取り違えると、出てくるのは「間違った定期支払いの一覧」になる。
   * 空で返せば何も出ないだけなので、迷ったら諦める。
   */
  it("金額らしい列が複数あって名前も当たらなければ諦める", () => {
    const cols = detectChargeColumns([
      f("a", "いつ", "date"),
      f("b", "なに", "text"),
      f("c", "第1の数", "currency"),
      f("d", "第2の数", "currency"),
    ]);
    expect(cols).toBeNull();
  });

  it("日付の列が無ければ諦める", () => {
    expect(
      detectChargeColumns([
        f("b", "摘要", "text"),
        f("c", "金額", "currency"),
      ]),
    ).toBeNull();
  });

  it("摘要にできる列が無ければ諦める", () => {
    expect(
      detectChargeColumns([
        f("a", "利用日", "date"),
        f("c", "金額", "currency"),
      ]),
    ).toBeNull();
  });
});
