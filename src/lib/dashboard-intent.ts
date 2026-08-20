/**
 * 「この表から、どんな画面が欲しい？」の答え。
 *
 * ## なぜ聞くのか
 *
 * これまで自動作成は、列の型と中身だけを見て組み立てていた。同じ形の表を
 * 入れれば、誰が入れても同じ画面が出る——それは正しい動きに見えて、実は
 * 半分しか見ていない。**同じ受注明細でも、営業部長が見たい画面と、
 * 経理が見たい画面と、分析担当が見たい画面は違う。** データからは、その差は
 * どうやっても読み取れない。だから聞く。
 *
 * ## ただし、聞きすぎない
 *
 * 取り込みは「ファイルを置いたら表になる」のが売りなので、ここで細かい設定を
 * 並べたら台無しになる。聞くのは3つだけで、どれも**選ばなくても先へ進める**
 * （既定は「おまかせ」＝これまでと同じ挙動）。
 *
 *   1. 何を知りたい？（lens）……図の選び方が変わる
 *   2. 誰が見る？（audience）……枚数と密度が変わる
 *   3. 色（theme）……見た目が変わる
 *
 * 6 × 3 × 8 = 144 通りの設定に、データ側の違い（日付列の有無、区分の数、
 * 数値列の本数、シート数）が掛かる。「なんでも同じ画面が出てくる」ことは、
 * もう無い。
 */
import { DEFAULT_PALETTE_KEY, PALETTES } from "./palette";
import { z } from "zod";

/* --------------------------------- lens --------------------------------- */

export const LENSES = [
  "auto",
  "performance",
  "pipeline",
  "composition",
  "distribution",
  "monitor",
] as const;
export type Lens = (typeof LENSES)[number];

export interface LensMeta {
  key: Lens;
  /** 選択肢の見出し。命令ではなく、利用者の言葉で。 */
  label: string;
  /** 一行の補足。 */
  note: string;
  /** 選択肢に添える小さな絵文字。文字だけの一覧より速く選べる。 */
  glyph: string;
}

export const LENS_META: LensMeta[] = [
  {
    key: "auto",
    label: "おまかせ",
    note: "表の中身を見て、こちらで決めます。",
    glyph: "✦",
  },
  {
    key: "performance",
    label: "実績を追いたい",
    note: "合計と推移。伸びているか、落ちているか。",
    glyph: "↗",
  },
  {
    key: "pipeline",
    label: "進み具合を見たい",
    note: "段階ごとの数。どこで止まっているか。",
    glyph: "▤",
  },
  {
    key: "composition",
    label: "内訳を知りたい",
    note: "何が占めているか。構成比と比較。",
    glyph: "◍",
  },
  {
    key: "distribution",
    label: "ばらつきを見たい",
    note: "分布と外れ値。平均だけでは見えないもの。",
    glyph: "⁘",
  },
  {
    key: "monitor",
    label: "とにかく一覧したい",
    note: "表を厚く。探して、絞って、辿る。",
    glyph: "☰",
  },
];

/* ------------------------------- audience ------------------------------- */

export const AUDIENCES = ["exec", "team", "analyst"] as const;
export type Audience = (typeof AUDIENCES)[number];

export interface AudienceMeta {
  key: Audience;
  label: string;
  note: string;
  glyph: string;
  /** 1シートに載せる図の上限（明細表を含む）。 */
  maxWidgets: number;
  /** 上段の数字（KPI）の枚数。 */
  maxKpis: number;
  /** 明細表を載せるか。 */
  detail: boolean;
}

export const AUDIENCE_META: AudienceMeta[] = [
  {
    key: "exec",
    label: "上に見せる",
    note: "少なく、大きく。結論だけ。",
    glyph: "◆",
    /*
     * 経営に出す画面で明細表を外すのは、意地悪ではなく実務。
     * 15枚のうち最後の1枚が「先頭12行」の表だと、報告の場で必ず
     * 「この続きは？」と聞かれ、答えが「無い」になる。見せないほうがいい。
     */
    maxWidgets: 7,
    maxKpis: 4,
    detail: false,
  },
  {
    key: "team",
    label: "チームで見る",
    note: "ふつうの厚さ。日々の確認に。",
    glyph: "●",
    maxWidgets: 15,
    maxKpis: 4,
    detail: true,
  },
  {
    key: "analyst",
    label: "自分で掘る",
    note: "多め。交差集計と明細を厚く。",
    glyph: "⌗",
    maxWidgets: 18,
    maxKpis: 6,
    detail: true,
  },
];

/* -------------------------------- intent -------------------------------- */

export const dashboardIntentSchema = z.object({
  lens: z.enum(LENSES).default("auto"),
  audience: z.enum(AUDIENCES).default("team"),
  theme: z.string().default(DEFAULT_PALETTE_KEY),
});
export type DashboardIntent = z.infer<typeof dashboardIntentSchema>;

export const DEFAULT_INTENT: DashboardIntent = {
  lens: "auto",
  audience: "team",
  theme: DEFAULT_PALETTE_KEY,
};

/**
 * 何が来ても必ず正しい意図に落とす。
 *
 * ここは取り込みフォーム（multipart）から来る値なので、欠けている・古い・
 * 手で書き換えられている、のどれもあり得る。取り込みそのものを
 * 落とすほどの話ではないので、分からない項目は既定に倒す。
 */
export function normalizeIntent(input: unknown): DashboardIntent {
  const parsed = dashboardIntentSchema.safeParse(input ?? {});
  const v = parsed.success ? parsed.data : DEFAULT_INTENT;
  const themeOk = PALETTES.some((p) => p.key === v.theme);
  return { ...v, theme: themeOk ? v.theme : DEFAULT_PALETTE_KEY };
}

export const audienceMeta = (key: Audience): AudienceMeta =>
  AUDIENCE_META.find((a) => a.key === key) ?? AUDIENCE_META[1];

/* --------------------------------- roles -------------------------------- */

/**
 * ウィジェットの「役割」。図の種類そのものではなく、**何のために置いたか**。
 *
 * 種類ではなく役割で重み付けするのは、同じ横棒でも「顧客別の売上ランキング」と
 * 「フェーズ別の件数」では意味が違うから。前者は順位を見る図、後者は構成を
 * 見る図で、欲しい画面によって要る・要らないが逆になる。
 */
export type WidgetRole =
  | "kpi"
  | "trend"
  | "trend-split"
  | "ranking"
  | "composition"
  | "stage"
  | "distribution"
  | "relation"
  | "cross"
  | "detail";

/**
 * 視点ごとの重み。0 は「積極的に選ばない」であって「禁止」ではない——
 * 他に候補が無ければ最後には載る。空欄の枠を並べるより、順位の低い図でも
 * 実データが入っているほうがましなので。
 */
const WEIGHTS: Record<Exclude<Lens, "auto">, Record<WidgetRole, number>> = {
  performance: {
    kpi: 10, trend: 9, "trend-split": 8, ranking: 7, composition: 4,
    stage: 3, distribution: 2, relation: 2, cross: 4, detail: 5,
  },
  pipeline: {
    kpi: 8, trend: 5, "trend-split": 7, ranking: 4, composition: 5,
    stage: 10, distribution: 2, relation: 2, cross: 9, detail: 6,
  },
  composition: {
    kpi: 7, trend: 4, "trend-split": 6, ranking: 9, composition: 10,
    stage: 5, distribution: 3, relation: 2, cross: 8, detail: 4,
  },
  distribution: {
    kpi: 6, trend: 4, "trend-split": 3, ranking: 5, composition: 3,
    stage: 2, distribution: 10, relation: 9, cross: 6, detail: 7,
  },
  monitor: {
    kpi: 9, trend: 6, "trend-split": 4, ranking: 6, composition: 4,
    stage: 4, distribution: 3, relation: 3, cross: 5, detail: 10,
  },
};

export function weightOf(lens: Lens, role: WidgetRole): number {
  if (lens === "auto") return 0;
  return WEIGHTS[lens][role];
}
