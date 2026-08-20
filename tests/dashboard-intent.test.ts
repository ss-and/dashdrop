/**
 * 「どんな画面が欲しいか」を聞いた結果が、本当に画面へ効いているかの検証。
 *
 * ここで固定したい契約は5つ。
 *
 * 1. **既定は今までどおり。** 何も答えなければ（おまかせ／チームで見る／標準）
 *    出来上がる画面はこれまでと同じ。聞くようにしたせいで、黙って進んだ人の
 *    結果が変わってはいけない。
 * 2. **答えると本当に変わる。** 視点を選べば図の顔ぶれが変わり、読み手を選べば
 *    枚数が変わる。「聞くだけ聞いて同じものが出る」が一番たちが悪い。
 * 3. **意味を持つ色は、テーマで動かない。** 増収の緑と減収の赤は配色の趣味では
 *    ないので、どのテーマでも同じ色のまま。
 * 4. **細い線が消えない。** 系列色は白地で 3:1 以上（既知の例外を除く）。
 * 5. **同じ答えなら同じ画面。** 並べ替えは安定で、実行のたびに変わらない。
 */
import { describe, it, expect } from "vitest";
import { profileFields } from "@/lib/data-profile";
import { autoLayoutFromProfiles } from "@/lib/auto-layout";
import {
  DEFAULT_INTENT,
  normalizeIntent,
  audienceMeta,
  type DashboardIntent,
  type Lens,
} from "@/lib/dashboard-intent";
import { computeWidget, type AggCollection, type CollectionMap } from "@/lib/aggregate";
import type { BreakdownData, BreakdownWidget, WidgetSpec } from "@/lib/widgets";
import {
  PALETTES,
  paletteFor,
  seriesColor,
  rgbTriple,
  DEFAULT_PALETTE_KEY,
} from "@/lib/palette";

/* ------------------------------ 検証用の表 ------------------------------ */

const FIELDS = [
  { key: "案件id", name: "案件ID", type: "text" },
  { key: "顧客名", name: "顧客名", type: "text" },
  { key: "営業担当", name: "営業担当", type: "text" },
  { key: "チャネル", name: "チャネル", type: "text" },
  { key: "フェーズ", name: "フェーズ", type: "text" },
  { key: "提案金額", name: "提案金額", type: "number" },
  { key: "数量", name: "数量", type: "number" },
  { key: "リードタイム", name: "リードタイム", type: "number" },
  { key: "完了予定日", name: "完了予定日", type: "date" },
];

const REPS = ["佐藤", "鈴木", "高橋", "田中"];
const CHANNELS = ["Web", "既存", "セミナー", "紹介", "アウトバウンド"];
const PHASES = ["A: 契約完了", "B: 内諾あり", "C: 提案", "D: 初回", "失注"];

const RECORDS = Array.from({ length: 40 }, (_, i) => ({
  案件id: `PRJ-${String(i + 1).padStart(3, "0")}`,
  顧客名: `顧客${(i % 12) + 1}株式会社`,
  営業担当: REPS[i % REPS.length],
  チャネル: CHANNELS[i % CHANNELS.length],
  フェーズ: PHASES[i % PHASES.length],
  提案金額: (i + 1) * 100_000,
  数量: (i % 7) + 1,
  リードタイム: (i % 30) + 3,
  完了予定日: `2026-${String((i % 12) + 1).padStart(2, "0")}-15`,
}));

const sheet = () => ({
  slug: "案件",
  name: "案件",
  rowCount: RECORDS.length,
  fields: profileFields(RECORDS, FIELDS),
});

const intentOf = (patch: Partial<DashboardIntent>): DashboardIntent => ({
  ...DEFAULT_INTENT,
  ...patch,
});

const typesFor = (patch: Partial<DashboardIntent>) =>
  autoLayoutFromProfiles([sheet()], intentOf(patch)).map((w) => w.type);

/* ------------------------------- 1. 既定 -------------------------------- */

describe("答えなかった人の結果は変わらない", () => {
  it("intent を渡さない場合と、既定の intent を渡した場合が一致する", () => {
    const without = autoLayoutFromProfiles([sheet()]).map((w) => w.type);
    const withDefault = typesFor({});
    expect(withDefault).toEqual(without);
  });

  it("既定でも図は十分な枚数になる（8枚以上）", () => {
    expect(typesFor({}).length).toBeGreaterThanOrEqual(8);
  });
});

/* ---------------------------- 2. 答えると変わる -------------------------- */

describe("視点によって図の顔ぶれが変わる", () => {
  const LENSES: Lens[] = [
    "auto",
    "performance",
    "pipeline",
    "composition",
    "distribution",
    "monitor",
  ];

  it("6つの視点が、すべて同じ並びにはならない", () => {
    const shapes = LENSES.map((lens) => typesFor({ lens }).join(","));
    // 全部が違う必要はない（データによっては近づく）が、
    // 「どれを選んでも同じ」だけは許さない。
    expect(new Set(shapes).size).toBeGreaterThanOrEqual(4);
  });

  it("「ばらつきを見たい」を選ぶと、分布と散布が前に出る", () => {
    const types = typesFor({ lens: "distribution" });
    expect(types).toContain("scatter");
    // 数値列が3本あるので、分布は1本目だけでは終わらない。
    expect(types.filter((t) => t === "histogram").length).toBeGreaterThanOrEqual(2);
    /*
     * 上段の数字のすぐ下——つまり最初に目に入る図——が分布であること。
     * 「載ってはいるが最後の方」では、この視点を選んだ意味が無い。
     */
    expect(types.find((t) => t !== "kpi")).toBe("histogram");
  });

  it("「進み具合を見たい」を選ぶと、段階と交差集計が前に出る", () => {
    const types = typesFor({ lens: "pipeline" });
    expect(types.some((t) => t === "funnel" || t === "pivot" || t === "heatmap")).toBe(
      true,
    );
  });

  it("同じ推移を、視点によって棒と折れ線に描き分ける", () => {
    /*
     * 同じ集計の言い換えなので、数字は変わらない。
     *
     * 対で確かめているのは、片方だけだと**何もしなくても通る**から。
     * 自動作成が既定で棒しか作らない以上、「実績には折れ線が無い」は
     * 言い換えを消しても成り立ってしまう。折れ線が確かに出る視点と
     * 並べて初めて、描き分けが効いている証拠になる。
     */
    expect(typesFor({ lens: "distribution" })).toContain("line");
    expect(typesFor({ lens: "performance" })).not.toContain("line");
    expect(typesFor({ lens: "performance" })).toContain("bar");
  });

  it("「進み具合を見たい」の画面では、区分を割った棒が必ず積み上がっている", () => {
    const split = autoLayoutFromProfiles([sheet()], intentOf({ lens: "pipeline" }))
      .filter((w) => w.type === "bar" && "splitBy" in w && w.splitBy);
    expect(split.length).toBeGreaterThan(0);
    for (const w of split) {
      expect((w as { stacked?: boolean }).stacked).toBe(true);
    }
  });
});

describe("読み手によって枚数が変わる", () => {
  it("「上に見せる」は少なく、明細表を載せない", () => {
    const types = typesFor({ audience: "exec" });
    expect(types).not.toContain("table");
    expect(types.length).toBeLessThanOrEqual(audienceMeta("exec").maxWidgets);
  });

  it("「自分で掘る」は「上に見せる」より多い", () => {
    expect(typesFor({ audience: "analyst" }).length).toBeGreaterThan(
      typesFor({ audience: "exec" }).length,
    );
  });

  it("上段の数字の枚数は、読み手の上限を超えない", () => {
    for (const a of ["exec", "team", "analyst"] as const) {
      const kpis = typesFor({ audience: a }).filter((t) => t === "kpi");
      expect(kpis.length).toBeLessThanOrEqual(audienceMeta(a).maxKpis);
    }
  });

  it("2枚目以降のシートでも、明細表の扱いは読み手に従う", () => {
    const two = [sheet(), { ...sheet(), slug: "予算", name: "予算" }];
    const exec = autoLayoutFromProfiles(two, intentOf({ audience: "exec" }));
    expect(exec.map((w) => w.type)).not.toContain("table");
    const team = autoLayoutFromProfiles(two, intentOf({ audience: "team" }));
    expect(team.filter((w) => w.type === "table").length).toBeGreaterThanOrEqual(2);
  });
});

/* ------------------------------ 3〜4. 配色 ------------------------------ */

describe("配色", () => {
  it("意味を持つ色は、どのテーマでも同じ", () => {
    const greens = new Set(PALETTES.map((p) => seriesColor(p, 0, "success")));
    const reds = new Set(PALETTES.map((p) => seriesColor(p, 3, "danger")));
    expect(greens.size).toBe(1);
    expect(reds.size).toBe(1);
    // 念のため、緑と赤が入れ替わっていないこと。
    expect([...greens][0]).not.toBe([...reds][0]);
  });

  it("意味を持たない名前は、テーマの色に読み替える", () => {
    const ocean = paletteFor("ocean");
    expect(seriesColor(ocean, 0, "khaki")).toBe(ocean.series[0]);
    expect(seriesColor(ocean, 1, undefined)).toBe(ocean.series[1]);
  });

  it("系列色は白地で 3:1 以上（既知の例外を除く）", () => {
    /**
     * WCAG 2.2 の非テキストコントラスト。折れ線は 1〜2px しかないので、
     * ここを割ると「グラフが薄くて見えない」ではなく「線が無い」に見える。
     */
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const onWhite = (hex: string) => 1.05 / (lum(hex) + 0.05);

    // Okabe-Ito の空色。並びを崩さないことを優先した、文書化済みの例外。
    const KNOWN_EXCEPTIONS = new Set(["#56b4e9"]);

    for (const p of PALETTES) {
      for (const c of p.series) {
        if (KNOWN_EXCEPTIONS.has(c)) continue;
        expect(
          onWhite(c),
          `${p.key} の ${c} が白地で薄すぎる`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("テーマのキーは重複せず、系列は8色そろっている", () => {
    expect(new Set(PALETTES.map((p) => p.key)).size).toBe(PALETTES.length);
    for (const p of PALETTES) {
      expect(p.series).toHaveLength(8);
      expect(p.ramp).toBe(p.series[0]);
    }
  });

  it("知らないテーマ名は標準に落ちる（消しても壊れない）", () => {
    expect(paletteFor("むかしのテーマ").key).toBe(DEFAULT_PALETTE_KEY);
    expect(paletteFor(null).key).toBe(DEFAULT_PALETTE_KEY);
    expect(paletteFor(undefined).key).toBe(DEFAULT_PALETTE_KEY);
  });

  it("濃淡用に成分へ開ける", () => {
    expect(rgbTriple("#6f683f")).toBe("111, 104, 63");
    expect(rgbTriple("000000")).toBe("0, 0, 0");
  });
});

/* ------------------------- 入力の受け止め・決定性 ------------------------ */

describe("答えの受け止め", () => {
  it("壊れた入力・欠けた入力は既定に落ちる", () => {
    expect(normalizeIntent(undefined)).toEqual(DEFAULT_INTENT);
    expect(normalizeIntent(null)).toEqual(DEFAULT_INTENT);
    expect(normalizeIntent("おまかせで")).toEqual(DEFAULT_INTENT);
    expect(normalizeIntent({ lens: "なんとなく" })).toEqual(DEFAULT_INTENT);
  });

  it("消えたテーマを指していても、視点と読み手は生かす", () => {
    expect(
      normalizeIntent({ lens: "monitor", audience: "analyst", theme: "むかし" }),
    ).toEqual({ lens: "monitor", audience: "analyst", theme: DEFAULT_PALETTE_KEY });
  });
});

describe("同じ答えなら同じ画面", () => {
  it("何度組み立てても、図の並びは変わらない", () => {
    for (const lens of ["performance", "pipeline", "distribution"] as const) {
      const a = typesFor({ lens });
      const b = typesFor({ lens });
      expect(b).toEqual(a);
    }
  });
});

/* --------------------- 配色が実際のグラフまで届くか --------------------- */

describe("集計は色を決めない（テーマが最後まで効く）", () => {
  const NOW = new Date("2026-08-08T12:00:00Z");

  /** 選択肢型ではないただの文字列の列。取り込んだExcelはほぼこれになる。 */
  const col: AggCollection = {
    slug: "sales",
    name: "受注",
    fields: [{ key: "phase", name: "フェーズ", type: "text" }],
    records: ["A", "B", "C", "D", "失注", "A", "B"].map((phase, i) => ({
      id: String(i),
      data: { phase },
      createdAt: NOW,
    })),
  };

  const breakdown = (): BreakdownData =>
    computeWidget(
      {
        id: "b1",
        type: "donut",
        title: "フェーズ別",
        collection: "sales",
        groupBy: "phase",
        measure: { kind: "count" },
        limit: 6,
      } as BreakdownWidget as WidgetSpec,
      new Map([["sales", col]]) as CollectionMap,
      NOW,
    ) as BreakdownData;

  it("区分に色を割り当てない（席順だけを決める）", () => {
    /*
     * 【回帰】以前は席順の色として ["khaki","info","success","warning","danger"]
     * を順に付けていた。名前が意味を持つ側と同じなので、藍のダッシュボードを
     * 作っても5切れのうち3切れが緑・橙・赤のまま残り、1枚の中で配色が割れた。
     * ブラウザで実際に描かせて見つけた不具合。
     */
    for (const s of breakdown().slices) {
      expect(s.color, `${s.label} に色が焼き付いている`).toBeUndefined();
    }
  });

  it("どのテーマでも、区分の色がテーマの色になる", () => {
    const slices = breakdown().slices;
    expect(slices.length).toBeGreaterThanOrEqual(5);

    for (const p of PALETTES) {
      const used = slices.map((s, i) => seriesColor(p, i, s.color));
      // テーマの並びどおりに当たっていること。
      expect(used).toEqual(slices.map((_, i) => p.series[i % p.series.length]));
      // 意味を持つ色（増減の緑・赤）が紛れ込んでいないこと。
      expect(used).not.toContain(seriesColor(p, 0, "success"));
      expect(used).not.toContain(seriesColor(p, 0, "danger"));
    }
  });

  it("「その他」だけは、どのテーマでも灰のまま", () => {
    // まとめ先が主役級の色で光ると、実在する区分のように見えてしまう。
    const greys = new Set(PALETTES.map((p) => seriesColor(p, 2, "neutral")));
    expect(greys.size).toBe(1);
  });
});
