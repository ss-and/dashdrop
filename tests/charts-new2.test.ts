/**
 * 増やしたグラフの集計の検証その2（箱ひげ・レーダー・サンキー・日本地図）。
 *
 * ここで守りたい契約:
 *
 * 1. 箱ひげのひげは Tukey の柵の内側にある**実データ**の端。単純な最小・最大に
 *    すると外れ値1件でひげが伸びきり、箱が線に潰れて比較にならない。
 * 2. 箱ひげの畳んだ分は「その他」にしない。分布は足し合わせられない。
 * 3. レーダーの軸の並びは、集計のたびに変わらない（形の比較が成り立たなくなる）。
 * 4. サンキーの節点は左右で別物。同じ値が両側にあると輪ができ、描画が崩れる。
 * 5. 地図は表記ゆれを吸収しつつ、**読めなかった値を黙って捨てない**。
 */
import { describe, it, expect } from "vitest";
import { computeWidget, type AggCollection, type CollectionMap } from "@/lib/aggregate";
import { findPrefecture, PREFECTURES } from "@/lib/japan";
import type {
  BoxplotData,
  JapanMapData,
  RadarData,
  SankeyData,
  WidgetSpec,
} from "@/lib/widgets";

const NOW = new Date("2026-08-08T12:00:00Z");
const map = (col: AggCollection): CollectionMap => new Map([[col.slug, col]]);
const rows = (data: Record<string, unknown>[]): AggCollection["records"] =>
  data.map((d, i) => ({ id: String(i), data: d, createdAt: NOW }));

/* -------------------------------- 箱ひげ -------------------------------- */

describe("箱ひげ — ばらつきの比較", () => {
  /**
   * 平均は同じだが、ばらつきがまるで違う2人。
   * 佐藤は毎回10日前後、鈴木は3日と30日が半々。平均の棒では同じ高さになる。
   */
  const col: AggCollection = {
    slug: "case",
    name: "案件",
    fields: [
      { key: "rep", name: "担当", type: "text" },
      { key: "days", name: "日数", type: "number" },
    ],
    records: rows([
      ...[9, 10, 10, 11, 10, 10].map((days) => ({ rep: "佐藤", days })),
      ...[3, 3, 30, 30, 3, 30].map((days) => ({ rep: "鈴木", days })),
    ]),
  };

  const run = (over: Record<string, unknown> = {}): BoxplotData =>
    computeWidget(
      {
        id: "b",
        type: "boxplot",
        title: "ばらつき",
        collection: "case",
        field: "days",
        groupBy: "rep",
        limit: 8,
        ...over,
      } as WidgetSpec,
      map(col),
      NOW,
    ) as BoxplotData;

  it("中央値が同じでも、箱の高さで差が出る", () => {
    const d = run();
    const sato = d.boxes.find((b) => b.label === "佐藤")!;
    const suzuki = d.boxes.find((b) => b.label === "鈴木")!;
    // 平均の棒グラフでは見えない差。これが出せないなら、この図を足す意味がない。
    expect(suzuki.q3 - suzuki.q1).toBeGreaterThan(sato.q3 - sato.q1);
  });

  it("四分位は q1 ≤ 中央値 ≤ q3 の順を必ず保つ", () => {
    for (const b of run().boxes.filter((x) => !x.synthetic)) {
      expect(b.q1).toBeLessThanOrEqual(b.median);
      expect(b.median).toBeLessThanOrEqual(b.q3);
      expect(b.low).toBeLessThanOrEqual(b.q1);
      expect(b.high).toBeGreaterThanOrEqual(b.q3);
    }
  });

  it("外れ値はひげの外へ出し、ひげは実データの端で止める", () => {
    /*
     * 1件だけ極端な値を混ぜる。ひげが最大値まで伸びてしまうと、
     * 箱が線に潰れて比較の用をなさなくなる。
     */
    const spiky: AggCollection = {
      ...col,
      records: rows([
        ...[10, 10, 11, 10, 9, 10, 11, 10].map((days) => ({ rep: "佐藤", days })),
        { rep: "佐藤", days: 500 },
      ]),
    };
    const d = computeWidget(
      {
        id: "b",
        type: "boxplot",
        title: "ばらつき",
        collection: "case",
        field: "days",
        groupBy: "rep",
        limit: 8,
      } as WidgetSpec,
      map(spiky),
      NOW,
    ) as BoxplotData;
    const b = d.boxes[0];
    expect(b.outliers).toContain(500);
    expect(b.high).toBeLessThan(500);
    // ひげの端は「柵の内側にある実データ」であって、柵そのものではない。
    expect(b.high).toBe(11);
    expect(b.count).toBe(9);
  });

  it("畳んだ分は「その他」の箱にしない（分布は足せない）", () => {
    const many: AggCollection = {
      ...col,
      records: rows(
        Array.from({ length: 40 }, (_, i) => ({
          rep: `担当${i % 10}`,
          days: (i % 7) + 1,
        })),
      ),
    };
    const d = computeWidget(
      {
        id: "b",
        type: "boxplot",
        title: "ばらつき",
        collection: "case",
        field: "days",
        groupBy: "rep",
        limit: 3,
      } as WidgetSpec,
      map(many),
      NOW,
    ) as BoxplotData;
    const real = d.boxes.filter((b) => !b.synthetic);
    expect(real).toHaveLength(3);
    // 落としたことは黙らない。ただし合成した箱に数字は入れない。
    const dropped = d.boxes.find((b) => b.synthetic)!;
    expect(dropped).toBeDefined();
    expect(dropped.count).toBe(0);
    expect(dropped.median).toBe(0);
  });

  it("区分を指定しなければ、全体で1本になる", () => {
    const d = run({ groupBy: undefined });
    expect(d.boxes).toHaveLength(1);
    expect(d.boxes[0].count).toBe(12);
  });
});

/* -------------------------------- レーダー ------------------------------- */

describe("レーダー — 形の比較", () => {
  const col: AggCollection = {
    slug: "case",
    name: "案件",
    fields: [
      { key: "ch", name: "チャネル", type: "text" },
      { key: "rep", name: "担当", type: "text" },
      { key: "amt", name: "金額", type: "currency" },
    ],
    records: rows([
      { ch: "Web", rep: "佐藤", amt: 100 },
      { ch: "紹介", rep: "佐藤", amt: 200 },
      { ch: "代理店", rep: "佐藤", amt: 300 },
      { ch: "Web", rep: "鈴木", amt: 400 },
      { ch: "紹介", rep: "鈴木", amt: 50 },
    ]),
  };

  const run = (over: Record<string, unknown> = {}): RadarData =>
    computeWidget(
      {
        id: "r",
        type: "radar",
        title: "形",
        collection: "case",
        groupBy: "ch",
        measure: { kind: "sum", field: "amt" },
        splitLimit: 3,
        limit: 6,
        ...over,
      } as WidgetSpec,
      map(col),
      NOW,
    ) as RadarData;

  it("軸は件数順ではなくラベル順に並ぶ（形の比較が成り立つように）", () => {
    /*
     * レーダーは軸の並びが形を決める。件数順のままにすると、月が変わって
     * 件数の順位が入れ替わっただけで多角形の形が変わり、「先月と形が違う」が
     * 中身の変化なのか並びの変化なのか分からなくなる。
     *
     * ここでは件数順とラベル順が**必ず食い違う**データを使う。同じ並びに
     * なるデータで確かめても、何も確かめたことにならない。
     */
    const skew: AggCollection = {
      slug: "case",
      name: "案件",
      fields: col.fields,
      records: rows([
        ...Array.from({ length: 5 }, () => ({ ch: "は行", rep: "佐藤", amt: 1 })),
        ...Array.from({ length: 3 }, () => ({ ch: "な行", rep: "佐藤", amt: 1 })),
        ...Array.from({ length: 1 }, () => ({ ch: "あ行", rep: "佐藤", amt: 1 })),
      ]),
    };
    const d = computeWidget(
      {
        id: "r",
        type: "radar",
        title: "形",
        collection: "case",
        groupBy: "ch",
        measure: { kind: "count" },
        splitLimit: 3,
        limit: 6,
      } as WidgetSpec,
      map(skew),
      NOW,
    ) as RadarData;
    // 件数順なら は行・な行・あ行。ラベル順なら あ行・な行・は行。
    expect(d.axes).toEqual(["あ行", "な行", "は行"]);
  });

  it("値は軸と同じ並び・同じ長さで返る", () => {
    const d = run({ splitBy: "rep" });
    for (const s of d.series) {
      expect(s.values).toHaveLength(d.axes.length);
    }
  });

  it("該当の無い軸は0（多角形が途切れないように）", () => {
    const d = run({ splitBy: "rep" });
    const suzuki = d.series.find((s) => s.label === "鈴木")!;
    const daiten = d.axes.indexOf("代理店");
    // 鈴木に代理店の実績は無い。null にすると多角形が閉じない。
    expect(suzuki.values[daiten]).toBe(0);
  });

  it("重ねる区分を指定しなければ、多角形は1枚", () => {
    const d = run();
    expect(d.series).toHaveLength(1);
    expect(d.series[0].label).toBe("全体");
  });
});

/* -------------------------------- サンキー ------------------------------- */

describe("サンキー — 流れ", () => {
  /** 出発と到着に同じ値（「営業部」）が現れる表。輪になりやすい形。 */
  const col: AggCollection = {
    slug: "move",
    name: "異動",
    fields: [
      { key: "from", name: "異動元", type: "text" },
      { key: "to", name: "異動先", type: "text" },
    ],
    records: rows([
      { from: "営業部", to: "開発部" },
      { from: "営業部", to: "開発部" },
      { from: "開発部", to: "営業部" },
      { from: "管理部", to: "営業部" },
    ]),
  };

  const run = (over: Record<string, unknown> = {}): SankeyData =>
    computeWidget(
      {
        id: "s",
        type: "sankey",
        title: "流れ",
        collection: "move",
        fromField: "from",
        toField: "to",
        measure: { kind: "count" },
        limit: 6,
        ...over,
      } as WidgetSpec,
      map(col),
      NOW,
    ) as SankeyData;

  it("同じ名前でも、左右は別の節点になる（輪を作らない）", () => {
    const d = run();
    /*
     * 節点を共有すると「営業部 → 営業部」の自己ループができる。
     * サンキーは輪を描けないので、描画が黙って崩れる。
     */
    for (const l of d.links) {
      expect(d.nodes[l.source].side).toBe("from");
      expect(d.nodes[l.target].side).toBe("to");
      expect(l.source).not.toBe(l.target);
    }
    // 「営業部」は左右の両方に居てよい。
    const eigyo = d.nodes.filter((n) => n.label === "営業部");
    expect(eigyo).toHaveLength(2);
  });

  it("帯の太さの合計が、元の件数と一致する", () => {
    const d = run();
    expect(d.links.reduce((n, l) => n + l.value, 0)).toBe(4);
  });

  it("太さ0の帯は返さない（配置計算が狂う）", () => {
    expect(run().links.every((l) => l.value > 0)).toBe(true);
  });

  it("左右の列名を返す（図からは向きが読めない）", () => {
    const d = run();
    expect(d.fromLabel).toBe("異動元");
    expect(d.toLabel).toBe("異動先");
  });
});

/* ------------------------------- 日本地図 -------------------------------- */

describe("都道府県の突き合わせ", () => {
  it("47都道府県がそろっていて、コードもタイルの位置も重複しない", () => {
    expect(PREFECTURES).toHaveLength(47);
    expect(new Set(PREFECTURES.map((p) => p.code)).size).toBe(47);
    expect(new Set(PREFECTURES.map((p) => p.name)).size).toBe(47);
    // 2県が同じマスに重なっていたら、片方は永久に見えない。
    expect(new Set(PREFECTURES.map((p) => `${p.col},${p.row}`)).size).toBe(47);
  });

  it("表記ゆれを吸収する", () => {
    expect(findPrefecture("東京都")?.code).toBe("13");
    expect(findPrefecture("東京")?.code).toBe("13");
    expect(findPrefecture(" 東京都 ")?.code).toBe("13");
    expect(findPrefecture("東京　都")?.code).toBe("13"); // 全角空白
    expect(findPrefecture("13")?.code).toBe("13");
    expect(findPrefecture("大阪")?.code).toBe("27");
    // 北海道は「道」を落とすと「北海」になってしまう。
    expect(findPrefecture("北海道")?.code).toBe("01");
  });

  it("住所は先頭の県名だけを採る（部分一致にしない）", () => {
    expect(findPrefecture("東京都渋谷区神南1-1-1")?.code).toBe("13");
    /*
     * 「京都」は「東京都渋谷区」に含まれている。含んでいれば良いことに
     * すると、東京の売上が京都に積まれる——しかも数字は自然に見えるので
     * 誰も気づかない。必ず前方一致で見る。
     */
    expect(findPrefecture("東京都渋谷区")?.name).not.toBe("京都府");
    expect(findPrefecture("京都府京都市")?.code).toBe("26");

    /*
     * 途中に県名が入っているだけの値は当てにいかない。
     * 「本社：東京都」を拾いにいくと、「担当：京都さん」まで京都府になる。
     * 拾えなかったぶんは地図の下に実例つきで出るので、人が直せる。
     */
    expect(findPrefecture("本社：東京都")).toBeNull();
    expect(findPrefecture("担当 京都太郎")).toBeNull();
  });

  it("読めない値は null（推測で当てにいかない）", () => {
    expect(findPrefecture("関東")).toBeNull();
    expect(findPrefecture("アメリカ")).toBeNull();
    expect(findPrefecture("")).toBeNull();
    expect(findPrefecture(null)).toBeNull();
  });
});

describe("日本地図の集計", () => {
  const col: AggCollection = {
    slug: "sales",
    name: "受注",
    fields: [
      { key: "pref", name: "都道府県", type: "text" },
      { key: "amt", name: "金額", type: "currency" },
    ],
    records: rows([
      { pref: "東京都", amt: 100 },
      { pref: "東京", amt: 200 },
      { pref: "大阪府大阪市北区", amt: 300 },
      { pref: "海外", amt: 999 },
      { pref: "ヨーロッパ", amt: 1 },
      { pref: "", amt: 50 },
    ]),
  };

  const run = (): JapanMapData =>
    computeWidget(
      {
        id: "j",
        type: "japanmap",
        title: "都道府県別",
        collection: "sales",
        field: "pref",
        measure: { kind: "sum", field: "amt" },
        unit: "currency",
      } as WidgetSpec,
      map(col),
      NOW,
    ) as JapanMapData;

  it("表記ゆれをまとめて1つの県に積む", () => {
    const d = run();
    const tokyo = d.values.find((v) => v.code === "13")!;
    expect(tokyo.value).toBe(300); // 100 + 200
    expect(d.values.find((v) => v.code === "27")!.value).toBe(300);
  });

  it("読めなかった値は、数と実例を返す（黙って捨てない）", () => {
    const d = run();
    expect(d.unmatched.count).toBe(2); // 海外・ヨーロッパ
    expect(d.unmatched.samples).toContain("海外");
    // 空欄は「読めなかった」ではなく「入っていない」。混ぜて数えない。
    expect(d.unmatched.samples).not.toContain("");
  });

  it("値の無い県は返さない（0 と「データ無し」は違う）", () => {
    const d = run();
    expect(d.values).toHaveLength(2);
    expect(d.values.map((v) => v.code)).toEqual(["13", "27"]);
    expect(d.max).toBe(300);
  });
});
