/**
 * ドリルダウンの絞り込み条件。
 *
 * ここで固定したい契約は2つ。
 *
 * 1. **集計側（aggregate.ts の bucketKeys）と突き合わせの規則が一致すること。**
 *    ずれると「グラフは37件と言っているのに表は0件」という、いちばん信用を
 *    失う壊れ方をする。空値と複数選択がその急所。
 * 2. **URLは信用しない。** 壊れた条件は画面ごと落とさず、その条件だけ捨てる。
 *    共有URLは列が消された後にも開かれる。
 */
import { describe, it, expect } from "vitest";
import {
  parseDrill,
  parseLegacyDrill,
  serializeDrill,
  drillHref,
  drillHrefWithout,
  drillBucketKeys,
  matchesFilter,
  recordMatchesDrill,
  needsComputedResolution,
  drillLookup,
  drillLabel,
  EMPTY_BUCKET,
  MAX_DRILL_FILTERS,
  type DrillFilter,
} from "@/lib/drill";

const eq = (field: string, value: string): DrillFilter => ({ op: "eq", field, value });

describe("bucketKeys と同じ規則で値を畳む", () => {
  it("空・null・空文字はすべて同じ「—」グループ", () => {
    expect(drillBucketKeys(null)).toEqual([EMPTY_BUCKET]);
    expect(drillBucketKeys(undefined)).toEqual([EMPTY_BUCKET]);
    expect(drillBucketKeys("")).toEqual([EMPTY_BUCKET]);
    expect(drillBucketKeys([])).toEqual([EMPTY_BUCKET]);
  });

  it("複数選択は要素ごとに展開する", () => {
    expect(drillBucketKeys(["A", "B"])).toEqual(["A", "B"]);
  });

  it("数値は文字列キーになる", () => {
    expect(drillBucketKeys(100)).toEqual(["100"]);
    expect(drillBucketKeys(false)).toEqual(["false"]);
  });
});

describe("matchesFilter", () => {
  it("eq は単一値に当たる", () => {
    expect(matchesFilter("営業部", eq("dept", "営業部"))).toBe(true);
    expect(matchesFilter("開発部", eq("dept", "営業部"))).toBe(false);
    expect(matchesFilter(100, eq("n", "100"))).toBe(true);
  });

  /**
   * 回帰の芯: 集計側は配列を要素ごとに展開するのに、受け側が配列全体を
   * String() して比べていたため、**複数選択の列は常に0件**になっていた。
   * eq では当てず、has で当てる。
   */
  it("eq は配列（複数選択）には当たらない", () => {
    expect(matchesFilter(["A", "B"], eq("tags", "A"))).toBe(false);
    expect(matchesFilter(["A", "B"], eq("tags", "A,B"))).toBe(false);
  });

  /**
   * ここが一番危ない形。要素が1つの配列に eq が当たってしまうと、
   * 「1つだけ選んだ行は出るが、2つ選んだ行は出ない」という**部分的に正しく
   * 見える**結果になる。0件なら異常だと気づけるが、半分出てしまうと誰も
   * 気づけない。配列は常に has で扱うこと。
   */
  it("要素が1つだけの配列にも eq は当たらない（部分一致を作らない）", () => {
    expect(matchesFilter(["A"], eq("tags", "A"))).toBe(false);
    // has なら1要素でも複数要素でも同じように当たる。
    const has: DrillFilter = { op: "has", field: "tags", value: "A" };
    expect(matchesFilter(["A"], has)).toBe(true);
    expect(matchesFilter(["A", "B"], has)).toBe(true);
  });

  it("has は複数選択の要素に当たる", () => {
    const f: DrillFilter = { op: "has", field: "tags", value: "A" };
    expect(matchesFilter(["A", "B"], f)).toBe(true);
    expect(matchesFilter(["B", "C"], f)).toBe(false);
    // 単一値にも当たる（1要素の配列と同じ扱い）
    expect(matchesFilter("A", f)).toBe(true);
  });

  /**
   * 空グループは「—」という**値**ではない。実データに「—」という文字列が
   * 入っていることもあるので、専用の演算子で表す。
   */
  it("empty は空・null・空文字に当たる", () => {
    const f: DrillFilter = { op: "empty", field: "dept" };
    expect(matchesFilter(null, f)).toBe(true);
    expect(matchesFilter("", f)).toBe(true);
    expect(matchesFilter([], f)).toBe(true);
    expect(matchesFilter("営業部", f)).toBe(false);
  });

  it("in は複数のキーのいずれかに当たる", () => {
    const f: DrillFilter = { op: "in", field: "dept", values: ["総務部", "人事部"] };
    expect(matchesFilter("総務部", f)).toBe(true);
    expect(matchesFilter("営業部", f)).toBe(false);
  });

  describe("range", () => {
    const april: DrillFilter = {
      op: "range",
      field: "date",
      from: Date.parse("2026-04-01T00:00:00Z"),
      to: Date.parse("2026-05-01T00:00:00Z"),
    };

    it("区間の中の日付に当たる", () => {
      expect(matchesFilter("2026-04-15T00:00:00Z", april)).toBe(true);
      expect(matchesFilter(new Date("2026-04-15T00:00:00Z"), april)).toBe(true);
    });

    /**
     * 半開区間 [from, to)。両端を含めると、月末の行が翌月の棒にも数えられ、
     * 合計がグラフと合わなくなる。
     */
    it("開始は含み、終了は含まない", () => {
      expect(matchesFilter("2026-04-01T00:00:00Z", april)).toBe(true);
      expect(matchesFilter("2026-05-01T00:00:00Z", april)).toBe(false);
    });

    it("日付として読めない値には当たらない", () => {
      expect(matchesFilter("営業部", april)).toBe(false);
      expect(matchesFilter(null, april)).toBe(false);
    });
  });
});

describe("recordMatchesDrill", () => {
  /**
   * 計算列（数式・ルックアップ・ロールアップ）は保存されず読み取り時に評価
   * される。生の data だけを見ると必ず0件になるので、呼び出し側が computed も
   * 見る関数を渡す設計にしてある。
   */
  it("data と computed の両方から引ける", () => {
    const data = { dept: "営業部" };
    const computed = { 粗利率: "38%" };
    const lookup = (k: string) =>
      k in data ? (data as Record<string, unknown>)[k] : computed[k as keyof typeof computed];

    expect(recordMatchesDrill(lookup, [eq("dept", "営業部")])).toBe(true);
    expect(recordMatchesDrill(lookup, [eq("粗利率", "38%")])).toBe(true);
  });

  it("条件が複数あればすべてに当たったときだけ通す（AND）", () => {
    const row: Record<string, unknown> = { dept: "営業部", stage: "受注" };
    const lookup = (k: string) => row[k];
    expect(recordMatchesDrill(lookup, [eq("dept", "営業部"), eq("stage", "受注")])).toBe(true);
    expect(recordMatchesDrill(lookup, [eq("dept", "営業部"), eq("stage", "失注")])).toBe(false);
  });

  it("条件が空なら全部通す", () => {
    expect(recordMatchesDrill(() => undefined, [])).toBe(true);
  });
});

describe("URL の読み書き", () => {
  it("往復して同じ条件になる", () => {
    const f = eq("dept", "営業部");
    expect(parseDrill([serializeDrill(f)]).filters).toEqual([f]);
  });

  it("複数の条件を1つずつ外せる", () => {
    const filters = [eq("dept", "営業部"), eq("stage", "受注")];
    const href = drillHref("c1", filters);
    const params = new URL(`http://x${href}`).searchParams;
    expect(params.getAll("d")).toHaveLength(2);
    expect(parseDrill(params.getAll("d")).filters).toEqual(filters);

    const without = drillHrefWithout("c1", filters, 0);
    expect(parseDrill(new URL(`http://x${without}`).searchParams.getAll("d")).filters).toEqual([
      filters[1],
    ]);
  });

  it("条件が無ければ素のURLになる", () => {
    expect(drillHref("c1", [])).toBe("/c/c1");
    expect(drillHrefWithout("c1", [eq("a", "b")], 0)).toBe("/c/c1");
  });

  /**
   * 着いた先から元のダッシュボードへ帰れるように、どこから来たかを持ち歩く。
   * ブラウザの戻るでも帰れるが、着いた先で表を触ったあと（並べ替え・列の
   * 編集・別の行を開く）では、何回押せばいいのか分からない。
   */
  describe("来た場所を持ち歩く", () => {
    it("from を載せる", () => {
      const href = drillHref("c1", [eq("dept", "営業部")], { from: "d9" });
      expect(new URL(`http://x${href}`).searchParams.get("from")).toBe("d9");
    });

    it("条件が無くても from だけは載せる", () => {
      expect(drillHref("c1", [], { from: "d9" })).toBe("/c/c1?from=d9");
    });

    /**
     * 回帰の芯: 条件を1つ外したとたんに戻り道が消えると、「絞り込みを緩めたら
     * 帰れなくなった」という妙な体験になる。外しても来た場所は忘れない。
     */
    it("条件を1つ外しても from は残る", () => {
      const href = drillHrefWithout(
        "c1",
        [eq("a", "1"), eq("b", "2")],
        0,
        { from: "d9" },
      );
      const params = new URL(`http://x${href}`).searchParams;
      expect(params.get("from")).toBe("d9");
      expect(params.getAll("d")).toHaveLength(1);
    });

    it("すべて外しても from は残る", () => {
      expect(drillHrefWithout("c1", [eq("a", "1")], 0, { from: "d9" })).toBe(
        "/c/c1?from=d9",
      );
    });

    it("from を渡さなければ載らない（戻り先が無い画面）", () => {
      const href = drillHref("c1", [eq("a", "1")]);
      expect(new URL(`http://x${href}`).searchParams.has("from")).toBe(false);
    });
  });

  /**
   * 共有URLは、列が消された後にも開かれる。1つ壊れているだけで画面ごと
   * エラーにするより、読めた条件で表を出す方が使える。
   */
  it("壊れた条件はその条件だけ捨てて、残りは使う", () => {
    const good = serializeDrill(eq("dept", "営業部"));
    const r = parseDrill([good, "{壊れたJSON", JSON.stringify({ op: "unknown" })]);
    expect(r.filters).toHaveLength(1);
    expect(r.dropped).toBe(2);
  });

  it("必ず0件になる範囲は条件として受けない", () => {
    const bad = JSON.stringify({ op: "range", field: "d", from: 100, to: 100 });
    expect(parseDrill([bad]).filters).toHaveLength(0);
  });

  it("条件の数には上限があり、超えた分は捨てて申告する", () => {
    const many = Array.from({ length: MAX_DRILL_FILTERS + 3 }, (_, i) =>
      serializeDrill(eq(`f${i}`, "x")),
    );
    const r = parseDrill(many);
    expect(r.filters).toHaveLength(MAX_DRILL_FILTERS);
    expect(r.dropped).toBe(3);
  });

  it("旧い ?f=&v= 形式を1つの eq として読む（共有済みURLの互換）", () => {
    expect(parseLegacyDrill("dept", "営業部")).toEqual([eq("dept", "営業部")]);
    expect(parseLegacyDrill("dept", undefined)).toEqual([]);
    expect(parseLegacyDrill(undefined, "営業部")).toEqual([]);
  });
});

describe("日本語の表示", () => {
  it("項目名で出す。名前が無ければキーで出す", () => {
    expect(drillLabel(eq("dept", "営業部"), "部門")).toBe("部門 = 営業部");
    expect(drillLabel(eq("dept", "営業部"))).toBe("dept = 営業部");
  });

  it("選択肢の表示名があればそれを使う", () => {
    expect(drillLabel({ op: "eq", field: "s", value: "parttime", label: "パート" }, "雇用形態")).toBe(
      "雇用形態 = パート",
    );
  });

  it("空・複数選択・その他は、それと分かる言い方にする", () => {
    expect(drillLabel({ op: "empty", field: "d" }, "部門")).toBe("部門 が空");
    expect(drillLabel({ op: "has", field: "t", value: "重要" }, "タグ")).toBe(
      "タグ に 重要 を含む",
    );
    expect(drillLabel({ op: "in", field: "d", values: ["総務部", "人事部"] }, "部門")).toBe(
      "部門 = 総務部・人事部",
    );
  });

  /**
   * 日付は表示ラベルを持たない形（epoch ms）で持つので、ここで人が読める形に
   * 戻す。粒度によって言い方を変える——月の棒を押したのに「2026/4/1 〜 2026/5/1」
   * と出ると、1日だけ絞ったように見える。
   */
  it("日付の範囲を粒度に合わせた日本語にする", () => {
    const mk = (from: string, to: string): DrillFilter => ({
      op: "range",
      field: "d",
      from: new Date(from).getTime(),
      to: new Date(to).getTime(),
    });
    expect(drillLabel(mk("2026-04-01", "2026-05-01"), "受注日")).toBe("受注日 = 2026年4月");
    expect(drillLabel(mk("2026-01-01", "2027-01-01"), "受注日")).toBe("受注日 = 2026年");
    expect(drillLabel(mk("2026-04-28", "2026-05-05"), "受注日")).toBe("受注日 = 2026/4/28 の週");
    expect(drillLabel(mk("2026-04-28", "2026-04-29"), "受注日")).toBe("受注日 = 2026/4/28");
  });
});


/**
 * 実際に起きていた不具合の芯。
 *
 * ダッシュボード側は計算列を data にマージしてから集計するのに、表の画面は
 * 生の data だけを見ていた。計算列は保存されず読み取り時に評価されるので、
 * 数式で作った円グラフのスライスを押すと**静かに0件の表**が出ていた。
 * エラーも警告も出ないので、何が起きたのか誰にも分からない。
 */
describe("計算列が混ざっているかの判定", () => {
  const fields = [
    { key: "dept", type: "text" },
    { key: "amount", type: "number" },
    { key: "margin", type: "formula" },
    { key: "customerName", type: "lookup" },
    { key: "total", type: "rollup" },
  ];

  it("生の列だけなら解決は要らない", () => {
    expect(needsComputedResolution(fields, [eq("dept", "営業部")])).toBe(false);
    expect(needsComputedResolution(fields, [eq("amount", "100")])).toBe(false);
  });

  it("数式・ルックアップ・ロールアップのどれでも解決が要る", () => {
    expect(needsComputedResolution(fields, [eq("margin", "38%")])).toBe(true);
    expect(needsComputedResolution(fields, [eq("customerName", "山田商事")])).toBe(true);
    expect(needsComputedResolution(fields, [eq("total", "500")])).toBe(true);
  });

  it("1つでも計算列が混ざっていれば解決が要る", () => {
    expect(
      needsComputedResolution(fields, [eq("dept", "営業部"), eq("margin", "38%")]),
    ).toBe(true);
  });

  it("条件が無ければ要らない", () => {
    expect(needsComputedResolution(fields, [])).toBe(false);
  });

  /** 列が消された後の共有URL。知らないキーで解決を走らせる意味は無い。 */
  it("知らない項目キーでは解決を要求しない", () => {
    expect(needsComputedResolution(fields, [eq("deleted", "x")])).toBe(false);
  });
});

describe("drillLookup", () => {
  const row = {
    data: { dept: "営業部", amount: 120 },
    computed: { margin: "38%" },
  };

  it("data と computed の両方から引ける", () => {
    const get = drillLookup(row);
    expect(get("dept")).toBe("営業部");
    expect(get("margin")).toBe("38%");
    expect(get("unknown")).toBeUndefined();
  });

  /** 保存された値が常に正。computed に同じキーがあっても上書きさせない。 */
  it("同じキーがあれば保存値を優先する", () => {
    const get = drillLookup({ data: { x: "保存" }, computed: { x: "計算" } });
    expect(get("x")).toBe("保存");
  });

  /** null が保存されているのと、計算列である のは違う。 */
  it("data に null で入っていれば、それを返す（computed に落ちない）", () => {
    const get = drillLookup({ data: { x: null }, computed: { x: "計算" } });
    expect(get("x")).toBeNull();
  });
});
