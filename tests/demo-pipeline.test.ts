/**
 * トップページで動かしている「本物のダッシュボード」。
 *
 * ここが壊れると、製品の第一印象がそのまま壊れる。しかも壊れ方が静かで、
 * 例外は出ず「図表は出るのに全部ゼロ」や「枠だけ空」になる。
 *
 * 見張るのは4つ:
 *  ① 見本から実際に図表が組め、値が入っていること
 *  ② 何度開いても同じ画面になること（この製品の売り筋そのもの）
 *  ③ 組めない表では、空の枠ではなく理由を返すこと
 *  ④ トップページが、手描きのモックに戻っていないこと
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { demoSheet, DEMO_FIELDS } from "@/lib/demo-sample";
import { buildDemoDashboard, toRecords } from "@/lib/demo-pipeline";

const ASOF = new Date(2026, 7, 31);

describe("① 見本から、値の入った図表が組める", () => {
  const r = buildDemoDashboard(demoSheet(ASOF), undefined, ASOF);

  /**
   * 枚数は製品の既定（team = 15枚）そのまま。トップページのために絞ると
   * 「本物と同じ」が嘘になる。一度 exec（7枚）に絞ったら、残ったのは
   * 棒とドーナツと表だけで、地図・ファネル・サンキー・箱ひげ・折れ線は
   * 重みの順に落ちていた。長さは画面側の枠で抑える。
   */
  it("図表が組める（製品の既定と同じ枚数）", () => {
    expect(r.reason).toBeNull();
    expect(r.computed.length).toBeGreaterThan(10);
  });

  /**
   * 見本から、地味な3種類以外も実際に出ること。
   * 「23種類あります」と書きながら棒とドーナツしか見せないのでは、
   * 書いてあることの証明にならない。
   */
  it("棒・ドーナツ・表以外の図表が出ている", () => {
    const types = new Set(r.computed.map((c) => c.widget.type));
    const striking = ["japanmap", "funnel", "sankey", "boxplot", "line", "heatmap", "waterfall"];
    const hit = striking.filter((t) => types.has(t as never));
    expect(hit.length, `出ているのは ${[...types].join(",")}`).toBeGreaterThan(1);
  });

  it("行と列が揃っている", () => {
    expect(r.rowCount).toBeGreaterThan(150);
    expect(r.fieldCount).toBe(DEMO_FIELDS.length);
  });

  /**
   * ここが本命。列名キーの行をそのまま渡すと、集計側は値を1つも見つけられず、
   * **図表は出るのに全部ゼロ**になる。例外も警告も出ないので、
   * 画面を見るまで誰も気づけない種類の壊れ方。
   */
  it("金額の合計がゼロでない（列名→キーの移し替えが効いている）", () => {
    const sum = r.computed.find(
      (c) => c.widget.type === "kpi" && String(c.widget.title).includes("合計"),
    );
    expect(sum, "合計のKPIが無い").toBeTruthy();
    const v = (sum!.data as { value?: number }).value ?? 0;
    expect(v).toBeGreaterThan(1_000_000);
  });

  it("移し替えが、元の列名から読んでいる", () => {
    const s = demoSheet(ASOF);
    const recs = toRecords(s);
    expect(recs[0].data).toHaveProperty("amount");
    expect(recs[0].data).toHaveProperty("customer");
    // 生の列名がそのまま残っていないこと。
    expect(recs[0].data).not.toHaveProperty("金額");
  });

  /** 空振りする「定期支払い」の枠が、売上台帳に混ざらないこと。 */
  it("当たらない図表の枠を出さない", () => {
    const rec = r.computed.find((c) => c.widget.type === "recurring");
    expect(rec, "売上台帳に定期支払いの枠が出ている").toBeUndefined();
  });
});

describe("② 何度開いても同じ画面になる", () => {
  /**
   * 「同じファイルなら毎回同じ答え」が、競合（ChatGPTにCSVを貼る）に対する
   * 主張そのもの。トップページのデモが開くたびに違う絵を出したら、
   * その主張を自分で否定することになる。
   */
  it("同じ日なら、出る図表と値が完全に一致する", () => {
    /*
     * 図表の `id` は毎回生成される（React のキー用）ので比較から外す。
     * 見張りたいのは「同じファイルなら同じ画面になるか」で、
     * 内部の識別子が一致するかではない。
     */
    const strip = (r: ReturnType<typeof buildDemoDashboard>) =>
      JSON.stringify(
        r.computed.map((c) => ({
          ...c,
          widget: { ...c.widget, id: undefined },
        })),
      );
    const a = buildDemoDashboard(demoSheet(ASOF), undefined, ASOF);
    const b = buildDemoDashboard(demoSheet(ASOF), undefined, ASOF);
    expect(strip(a)).toBe(strip(b));
  });

  it("見本の中身に乱数を使っていない", () => {
    const src = readFileSync("src/lib/demo-sample.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toContain("Math.random");
  });

  /**
   * 台帳に未来の受注が並ぶと、見た瞬間に作り物だと分かる。
   *
   * 基準日は**月の途中**にすること。月末（8/31）で試すと、その月の日数と
   * 今日の日付が一致してしまい、打ち切りを外す変異を素通しする
   * （実際にそれで見逃した）。
   */
  it("今日より先の日付が無い", () => {
    const mid = new Date(2026, 7, 14); // 8月14日
    const max = demoSheet(mid)
      .rows.map((r) => String(r["受注日"]))
      .sort()
      .at(-1)!;
    expect(max <= "2026-08-14", `最新の受注日が ${max}`).toBe(true);
  });

  /** サーバーで組んでクライアントへ渡すので、Date が混ざると壊れる。 */
  it("組み立て結果が JSON で往復できる", () => {
    const r = buildDemoDashboard(demoSheet(ASOF), undefined, ASOF);
    const json = JSON.stringify(r.computed);
    expect(JSON.stringify(JSON.parse(json))).toBe(json);
  });
});

describe("③ 組めない表では、理由を返す", () => {
  it("行が無ければ、その旨を返す", () => {
    const r = buildDemoDashboard({ name: "空", fields: DEMO_FIELDS, rows: [] });
    expect(r.computed).toHaveLength(0);
    expect(r.reason).toContain("行");
  });

  it("見出しが無ければ、その旨を返す", () => {
    const r = buildDemoDashboard({ name: "無題", fields: [], rows: [{ a: 1 }] });
    expect(r.computed).toHaveLength(0);
    expect(r.reason).toContain("見出し");
  });

  /**
   * 日付も金額も無い表（住所録など）でも、件数と内訳なら組める。
   * ここで空を返してしまうと、置いた人には「使えなかった」としか映らない。
   * 何かしら意味のあるものが出ることを固定しておく。
   */
  it("文字列だけの表でも、件数と内訳で組む", () => {
    const r = buildDemoDashboard({
      name: "住所録",
      fields: [
        { key: "name", name: "氏名", type: "text" },
        { key: "pref", name: "都道府県", type: "text" },
      ],
      rows: [
        { 氏名: "山田", 都道府県: "東京都" },
        { 氏名: "佐藤", 都道府県: "大阪府" },
        { 氏名: "鈴木", 都道府県: "東京都" },
      ],
    });
    expect(r.reason).toBeNull();
    expect(r.computed.length).toBeGreaterThan(0);
    // 数えるものが1つも無いのに合計や推移を描いていないこと。
    for (const c of r.computed) {
      expect(["line", "area"]).not.toContain(c.widget.type);
    }
  });
});

describe("④ トップページが、手描きのモックに戻っていない", () => {
  const page = readFileSync("src/app/(marketing)/page.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("本物のダッシュボードを置いている", () => {
    expect(page).toContain("LiveDemo");
    expect(page).toContain("buildDemoDashboard");
  });

  /**
   * 【回帰】ここには手描きの「製品っぽいスクリーンショット」があった。
   * 数字は固定で、中身が変われば必ず実物と食い違う。
   */
  it("固定の数字を並べた偽のモックが無い", () => {
    expect(page).not.toContain("ProductMock");
    expect(page).not.toMatch(/¥1?\d{2},\d{3}/); // ¥128,000 のような焼き込み
  });

  /**
   * 【回帰】どの製品にも貼り替えられる定型の器（番号付き3ステップ、
   * アイコン付き機能グリッド）。指摘は「AI感が強すぎる」だった。
   */
  it("定型のテンプレートが戻っていない", () => {
    expect(page).not.toContain("3ステップ");
    expect(page).not.toContain("STEPS");
    expect(page).not.toContain("FEATURES");
  });

  /**
   * 数は実装から数える。手で書くと必ずずれる（実際に2回ずれた）。
   *
   * 見る先はトップページだけではない。機能の見せ方を札の並びに変えたとき、
   * 数の導出は Highlights.tsx へ移った。**画面に出る文言のどこにも
   * 手書きの数字が無いこと**が守りたいことなので、両方見る。
   */
  it("図表の種類数を文言に直接書いていない", () => {
    const files = [
      "src/app/(marketing)/page.tsx",
      "src/components/marketing/Highlights.tsx",
    ];
    const sources = files.map((f) =>
      readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, ""),
    );
    // どこかで実装から数えていること。
    expect(sources.some((s) => s.includes("WIDGET_TYPES.length"))).toBe(true);
    // どのファイルにも、手書きの「N種類」が無いこと。
    for (const [i, src] of sources.entries()) {
      expect(src, files[i]).not.toMatch(/\d+種類/);
    }
  });
});
