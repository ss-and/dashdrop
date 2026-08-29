/**
 * カード会社・銀行ごとに違う明細の列名を、同じ意味に揃えて読めるか。
 *
 * ここに並べたヘッダー行は、実際に各社が書き出す CSV の1行目の形。
 * 会社ごとの読み取り器を並べる作りにはしていないので、守るべき契約は
 * 「**優先順位が決まっていること**」——同じ表に「利用金額」と「支払総額」が
 * 両方あるとき、どちらを採るかがぶれないこと。
 *
 * 取り違えたときに何が起きるかを、各テストに書いてある。どれも
 * 「エラーになる」のではなく「**それらしい間違った一覧が出る**」ので、
 * 気づけるのはここだけ。
 */
import { describe, it, expect } from "vitest";
import { detectChargeColumns } from "@/lib/recurring";

/** ヘッダー名の配列を、取り込み後のフィールド定義に変える。 */
function fields(spec: Array<[string, string]>) {
  return spec.map(([name, type]) => ({ key: name, name, type }));
}

const D = "date";
const N = "number";
const C = "currency";
const T = "text";

describe("カード明細", () => {
  it("楽天カード", () => {
    const cols = detectChargeColumns(
      fields([
        ["利用日", D],
        ["利用店名・商品名", T],
        ["利用者", T],
        ["支払方法", T],
        ["利用金額", N],
        ["支払手数料", N],
        ["支払総額", N],
      ]),
    );
    expect(cols?.dateKey).toBe("利用日");
    // 「利用者」は支払い先ではなく家族カードの名義。ここを摘要にすると、
    // 一覧が「本人・配偶者」の2件になって、何の一覧か分からなくなる。
    expect(cols?.labelKey).toBe("利用店名・商品名");
    // 「支払総額」は分割の手数料が乗ったあとの額。1回ぶんの利用額を採る。
    expect(cols?.amountKey).toBe("利用金額");
  });

  /**
   * 列の**並び順が逆でも**優先順位が効くこと。
   *
   * 上の楽天の例は「利用金額」が「支払総額」より左にあるので、優先順位が
   * 壊れていても列の並び順だけで正解に見えてしまう。並びを入れ替えて初めて、
   * 語彙の順序が効いている証拠になる。
   *
   * 取り違えると、分割払いの手数料が乗った額が毎月の支払いとして並ぶ。
   */
  it("支払総額が先に並んでいても、利用金額を採る", () => {
    const cols = detectChargeColumns(
      fields([
        ["利用日", D],
        ["利用店名・商品名", T],
        ["支払総額", N],
        ["利用金額", N],
      ]),
    );
    expect(cols?.amountKey).toBe("利用金額");
  });

  it("お支払金額が先に並んでいても、ご利用金額を採る", () => {
    const cols = detectChargeColumns(
      fields([
        ["ご利用日", D],
        ["ご利用先など", T],
        ["お支払金額(￥)", N],
        ["ご利用金額(￥)", N],
      ]),
    );
    expect(cols?.amountKey).toBe("ご利用金額(￥)");
  });

  it("三井住友カード", () => {
    const cols = detectChargeColumns(
      fields([
        ["ご利用日", D],
        ["ご利用店名及び商品名", T],
        ["ご利用金額", N],
        ["支払区分", T],
      ]),
    );
    expect(cols).toEqual({
      dateKey: "ご利用日",
      labelKey: "ご利用店名及び商品名",
      amountKey: "ご利用金額",
    });
  });

  it("JCB", () => {
    const cols = detectChargeColumns(
      fields([
        ["ご利用日", D],
        ["ご利用先など", T],
        ["ご利用金額(￥)", N],
        ["支払区分", T],
        ["今回回数", N],
        ["お支払金額(￥)", N],
      ]),
    );
    expect(cols?.dateKey).toBe("ご利用日");
    expect(cols?.labelKey).toBe("ご利用先など");
    // 「今回回数」は数値だが金額ではない。ここを金額にすると、
    // 一覧の額がすべて 1〜12 という意味不明な数字で並ぶ。
    expect(cols?.amountKey).toBe("ご利用金額(￥)");
  });

  it("エポスカード", () => {
    const cols = detectChargeColumns(
      fields([
        ["ご利用年月日", D],
        ["ご利用先", T],
        ["ご利用金額", N],
      ]),
    );
    expect(cols).toEqual({
      dateKey: "ご利用年月日",
      labelKey: "ご利用先",
      amountKey: "ご利用金額",
    });
  });

  it("シンプルな明細（日付・内容・金額だけ）", () => {
    const cols = detectChargeColumns(
      fields([
        ["日付", D],
        ["ご利用内容", T],
        ["金額", C],
      ]),
    );
    expect(cols).toEqual({
      dateKey: "日付",
      labelKey: "ご利用内容",
      amountKey: "金額",
    });
  });
});

describe("銀行の入出金明細", () => {
  /**
   * 銀行明細では数値の列が3本ある（出金・入金・残高）。ここを外すと
   * 一番ひどい結果になる:
   *   残高を採る  → 残高の推移が「定期支払い」として並ぶ
   *   入金を採る  → 毎月ほぼ同額の**給与**が支出の合計に化ける
   */
  it("三菱UFJ銀行 — 支払い側だけを採る", () => {
    const cols = detectChargeColumns(
      fields([
        ["日付", D],
        ["摘要", T],
        ["摘要内容", T],
        ["支払い金額", N],
        ["預かり金額", N],
        ["差引残高", N],
      ]),
    );
    expect(cols?.amountKey).toBe("支払い金額");
    // 「摘要」は「振込」「口座振替」といった手段、「摘要内容」が相手先。
    expect(cols?.labelKey).toBe("摘要内容");
  });

  it("住信SBIネット銀行 — 出金側だけを採る", () => {
    const cols = detectChargeColumns(
      fields([
        ["日付", D],
        ["内容", T],
        ["出金金額(円)", N],
        ["入金金額(円)", N],
        ["残高(円)", N],
      ]),
    );
    expect(cols).toEqual({
      dateKey: "日付",
      labelKey: "内容",
      amountKey: "出金金額(円)",
    });
  });

  /**
   * 出金の列が無い月（入金しか無かった、など）に、入金を金額として拾わないこと。
   *
   * ここを外すと、毎月ほぼ同額の**給与**が「毎月の定期支払い」として並び、
   * 「月あたり ¥380,000 払っています」という、実態と真逆の合計が出る。
   * 出金が無いなら何も出さないのが正しい。
   */
  it("入金の列しか無いときは、それを金額として拾わない", () => {
    expect(
      detectChargeColumns(
        fields([
          ["日付", D],
          ["摘要", T],
          ["預かり金額", N],
          ["差引残高", N],
        ]),
      ),
    ).toBeNull();
  });

  /** 残高は「金額」を名前に含むことがある。含んでいても選ばない。 */
  it("残高金額という名前でも金額として選ばない", () => {
    expect(
      detectChargeColumns(
        fields([
          ["取扱日", D],
          ["お取引内容", T],
          ["残高金額", N],
        ]),
      ),
    ).toBeNull();
  });

  it("お引出し / お預入れ の書き方でも支払い側を採る", () => {
    const cols = detectChargeColumns(
      fields([
        ["取扱日", D],
        ["お取引内容", T],
        ["お引出し", N],
        ["お預入れ", N],
        ["残高", N],
      ]),
    );
    expect(cols?.amountKey).toBe("お引出し");
  });
});

describe("日付の選び方", () => {
  /**
   * カード明細には「利用日」と「支払日」が両方ある。支払日は全行が同じ日に
   * なるので、そちらを採ると間隔が1つも取れず、定期支払いは**1件も
   * 見つからない**——エラーも出ないので、ただ「機能が効かない」ように見える。
   */
  it("利用日と支払日があれば、利用日を採る", () => {
    const cols = detectChargeColumns(
      fields([
        ["お支払日", D],
        ["ご利用日", D],
        ["ご利用先", T],
        ["ご利用金額", N],
      ]),
    );
    expect(cols?.dateKey).toBe("ご利用日");
  });

  it("支払日しか無い表では、それを使う（唯一なら取り違えようがない）", () => {
    const cols = detectChargeColumns(
      fields([
        ["お支払日", D],
        ["ご利用先", T],
        ["ご利用金額", N],
      ]),
    );
    expect(cols?.dateKey).toBe("お支払日");
  });
});

describe("諦めるべきところで諦める", () => {
  it("名前が何も当たらず、数値が2本以上あるなら諦める", () => {
    expect(
      detectChargeColumns(
        fields([
          ["いつ", D],
          ["なに", T],
          ["数A", N],
          ["数B", N],
        ]),
      ),
    ).toBeNull();
  });

  /** 残高は名前で外す。外したあと金額が1本になるので取り違えようがない。 */
  it("残高は金額として選ばない", () => {
    const cols = detectChargeColumns(
      fields([
        ["取引日", D],
        ["摘要", T],
        ["金額", N],
        ["残高", N],
      ]),
    );
    expect(cols?.amountKey).toBe("金額");
  });

  /**
   * 【回帰】型と本数だけで決めていたため、案件一覧（日付1本・金額1本）が
   * 3本とも「取り違えようがない」経路で埋まり、明細として通っていた。
   * 営業のダッシュボードすべてに、中身の無い「定期支払い」の箱が付く。
   * 3本のうち2本以上を名前で当てることを求めて直した。
   */
  it("名前で当てたのが1本だけなら通さない", () => {
    // 「提案金額」は金額の語彙に当たるが、日付も摘要も当たっていない。
    expect(
      detectChargeColumns(
        fields([
          ["完了予定日", D],
          ["案件名", T],
          ["担当", T],
          ["提案金額", N],
        ]),
      ),
    ).toBeNull();
  });

  it("摘要にできるのが利用者名だけなら諦める", () => {
    expect(
      detectChargeColumns(
        fields([
          ["ご利用日", D],
          ["利用者", T],
          ["ご利用金額", N],
        ]),
      ),
    ).toBeNull();
  });

  it("案件一覧のような、明細でない表では何も返さない", () => {
    expect(
      detectChargeColumns(
        fields([
          ["案件名", T],
          ["担当", T],
          ["提案金額", N],
          ["確度", N],
          ["完了予定日", D],
        ]),
      ),
    ).toBeNull();
  });

  it("在庫表・勤怠表のような、日付と数のある表でも通さない", () => {
    expect(
      detectChargeColumns(
        fields([
          ["棚卸日", D],
          ["商品名", T],
          ["在庫数", N],
        ]),
      ),
    ).toBeNull();
  });
});
