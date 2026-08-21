/**
 * 検索窓を「打つ前」に使えるようにした部分の検証。
 *
 * ここで守りたい契約は4つ。
 *
 * 1. **履歴はワークスペースをまたがない。** 別の会社の足あとが検索窓に
 *    出るのは、機能の不具合ではなく事故。
 * 2. **壊れた履歴で画面を落とさない。** localStorage は利用者が手で書き換え
 *    られるし、古い版の形も残る。読めなければ空でよい。
 * 3. **同じ場所を二重に持たない。** 名前が変わったら新しい名前で置き換える。
 * 4. **操作は打った言葉で当たる。** 日本語の業務ユーザーは「取り込み」とも
 *    「インポート」とも打つ。表示名だけで引くとどちらも空振りする。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readRecent, rememberRecent, forgetRecent } from "@/lib/recent";
import { matchActions, SEARCH_ACTIONS } from "@/lib/search-actions";

/** jsdom の localStorage を毎回まっさらにする。 */
beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("最近見たもの", () => {
  it("記録した順の逆（新しい順）で返る", () => {
    rememberRecent("ws-1", { kind: "sheet", href: "/c/a", name: "受注" });
    rememberRecent("ws-1", { kind: "dashboard", href: "/d/b", name: "売上" });
    expect(readRecent("ws-1").map((r) => r.href)).toEqual(["/d/b", "/c/a"]);
  });

  it("同じ場所は二重に持たず、名前は新しいほうで置き換える", () => {
    rememberRecent("ws-1", { kind: "dashboard", href: "/d/b", name: "旧い名前" });
    rememberRecent("ws-1", { kind: "sheet", href: "/c/a", name: "受注" });
    rememberRecent("ws-1", { kind: "dashboard", href: "/d/b", name: "新しい名前" });

    const got = readRecent("ws-1");
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ href: "/d/b", name: "新しい名前" });
  });

  it("ワークスペースをまたいで混ざらない", () => {
    rememberRecent("ws-1", { kind: "sheet", href: "/c/a", name: "A社の受注" });
    rememberRecent("ws-2", { kind: "sheet", href: "/c/z", name: "B社の受注" });

    expect(readRecent("ws-1").map((r) => r.name)).toEqual(["A社の受注"]);
    expect(readRecent("ws-2").map((r) => r.name)).toEqual(["B社の受注"]);
  });

  it("12件を超えたら古いものから落ちる", () => {
    for (let i = 0; i < 20; i++) {
      rememberRecent("ws-1", { kind: "sheet", href: `/c/${i}`, name: `表${i}` });
    }
    const got = readRecent("ws-1", 50);
    expect(got).toHaveLength(12);
    // 最後に入れたものが先頭、いちばん古い8件は消えている。
    expect(got[0].href).toBe("/c/19");
    expect(got.map((r) => r.href)).not.toContain("/c/0");
  });

  it("消したものは履歴から外れる", () => {
    rememberRecent("ws-1", { kind: "dashboard", href: "/d/b", name: "消す予定" });
    rememberRecent("ws-1", { kind: "sheet", href: "/c/a", name: "残る" });
    forgetRecent("ws-1", "/d/b");
    expect(readRecent("ws-1").map((r) => r.href)).toEqual(["/c/a"]);
  });

  it("壊れた履歴は空として扱う（画面を落とさない）", () => {
    window.localStorage.setItem("dashdrop:recent:ws-1", "これはJSONではない");
    expect(readRecent("ws-1")).toEqual([]);

    window.localStorage.setItem("dashdrop:recent:ws-1", '{"not":"an array"}');
    expect(readRecent("ws-1")).toEqual([]);
  });

  it("形の合わない行だけを捨てて、残りは生かす", () => {
    window.localStorage.setItem(
      "dashdrop:recent:ws-1",
      JSON.stringify([
        { kind: "sheet", href: "/c/ok", name: "まとも", at: 3 },
        { kind: "sheet", href: "/c/x", name: "", at: 2 }, // 名前が空
        { kind: "むかしの種類", href: "/c/y", name: "型違い", at: 1 },
        { kind: "sheet", href: "https://evil.example/x", name: "外部", at: 9 },
      ]),
    );
    const got = readRecent("ws-1");
    expect(got.map((r) => r.href)).toEqual(["/c/ok"]);
  });

  it("外部URLは記録しない（履歴から外へ飛ばさない）", () => {
    rememberRecent("ws-1", {
      kind: "sheet",
      href: "https://evil.example/steal",
      name: "外部",
    });
    expect(readRecent("ws-1")).toEqual([]);
  });

  it("localStorage が使えなくても投げない（プライベートモード）", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() =>
      rememberRecent("ws-1", { kind: "sheet", href: "/c/a", name: "受注" }),
    ).not.toThrow();
  });

  it("ワークスペースIDが無いときは何もしない", () => {
    rememberRecent("", { kind: "sheet", href: "/c/a", name: "受注" });
    expect(readRecent("")).toEqual([]);
  });
});

describe("検索から叩ける操作", () => {
  it("表示名で当たる", () => {
    expect(matchActions("ダッシュボード").map((a) => a.id)).toContain(
      "dashboard-new",
    );
  });

  it("別の言い方でも当たる（日本語の業務ユーザーの語彙）", () => {
    // 同じことを指す3通り。どれで打っても取り込みに届くこと。
    for (const q of ["取り込み", "インポート", "import"]) {
      expect(matchActions(q).map((a) => a.id), q).toContain("import");
    }
    // 変換前のひらがなでも。
    expect(matchActions("せってい").map((a) => a.id)).toContain("settings");
  });

  it("部分一致で拾う（前方一致にしない）", () => {
    // 「ボード」は「ダッシュボード」の途中。前方一致だと落ちる。
    expect(matchActions("ボード").length).toBeGreaterThan(0);
  });

  it("空文字では何も返さない", () => {
    expect(matchActions("")).toEqual([]);
    expect(matchActions("   ")).toEqual([]);
  });

  it("当たりすぎても件数を絞る", () => {
    // 「する」は複数の操作の説明に含まれる。パネルを埋め尽くさせない。
    expect(matchActions("る", 4).length).toBeLessThanOrEqual(4);
  });

  it("行き先はすべてアプリ内の絶対パス", () => {
    for (const a of SEARCH_ACTIONS) {
      expect(a.href.startsWith("/"), a.id).toBe(true);
      expect(a.href.startsWith("//"), a.id).toBe(false);
    }
  });

  it("idは重複しない（Reactのkeyに使う）", () => {
    expect(new Set(SEARCH_ACTIONS.map((a) => a.id)).size).toBe(
      SEARCH_ACTIONS.length,
    );
  });
});
