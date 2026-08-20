/**
 * グラフの配色。
 *
 * これまで色は各ウィジェットの中に直接書かれていた（SeriesChart / BreakdownChart /
 * PivotTable / ScatterPlot にそれぞれ同じ `COLOR_HEX` の写しがあった）。結果として
 * **どのファイルのどのダッシュボードも、まったく同じ5色**で描かれる。取り込んだ
 * データが売上でも在庫でも人事でも、出てくる画面の顔が同じになる原因のひとつが
 * これだった。色をここへ一本化し、テーマとして選べるようにする。
 *
 * ## 変えて良い色と、変えてはいけない色
 *
 * テーマが差し替えるのは **系列色** だけ。「1本目・2本目・3本目」を区別するための
 * 色で、意味は持たない。
 *
 * 一方 `positive` / `negative`（増収と減収、達成と未達）は**意味そのもの**なので、
 * テーマで入れ替えない。配色を変えたら増加が赤で減少が緑になった、というのは
 * 好みの問題ではなく誤読で、しかも読み手は誤読したことに気づけない。
 *
 * ## 明るさの下限
 *
 * 折れ線は1〜2pxの細い線なので、白地の上で薄い色は消える。系列色は原則として
 * 白背景に対して 3:1 以上（WCAG 2.2 非テキスト）を目安に選んである。例外は
 * 「識別」テーマの空色で、これは Okabe-Ito の並びを崩さないことを優先した——
 * 面の塗りでは十分見えるが、線としては弱いので順番を後ろに置いてある。
 */

export interface Palette {
  key: string;
  /** 画面に出す名前。 */
  name: string;
  /** 選ぶときの手がかりになる一言。 */
  note: string;
  /**
   * 系列色。1本目から順に使う。8色あるのは、区分別に割ったグラフ
   * （splitBy）が最大8系列まで出るため。
   */
  series: string[];
  /** 濃淡（ヒートマップ、ツリーマップ）の基準色。 */
  ramp: string;
  /** 良い方向。テーマを変えても動かさない。 */
  positive: string;
  /** 悪い方向。テーマを変えても動かさない。 */
  negative: string;
}

/**
 * 意味を持つ2色。全テーマ共通。
 * tailwind.config.ts の success / danger と同じ値。
 */
const POSITIVE = "#3f6a45";
const NEGATIVE = "#93392e";

const base = { ramp: "", positive: POSITIVE, negative: NEGATIVE };

export const PALETTES: Palette[] = [
  {
    ...base,
    key: "standard",
    name: "標準",
    note: "落ち着いたカーキ基調。どの業務でも浮かない。",
    series: [
      "#8a8250", "#4a6d80", "#4f7a53", "#b07d38",
      "#a24b3f", "#6b6a8c", "#5f8f96", "#8a7a6b",
    ],
  },
  {
    ...base,
    key: "ocean",
    name: "藍",
    note: "青と碧。数字を静かに見せたいとき。",
    series: [
      "#1f4e6b", "#3f9aa8", "#6b7fae", "#2f7d6b",
      "#4a6b8f", "#3f8296", "#3f5f8a", "#5f8a99",
    ],
  },
  {
    ...base,
    key: "forest",
    name: "若竹",
    note: "緑基調。在庫・生産・環境まわりに。",
    series: [
      "#3c6b45", "#7a923f", "#2e7d6e", "#a08f3f",
      "#4f6b8f", "#5d9a72", "#6b8a4f", "#39584a",
    ],
  },
  {
    ...base,
    key: "sunset",
    name: "夕景",
    note: "暖色基調。売上や実績を熱く見せる。",
    series: [
      "#a8452f", "#c9772f", "#8f5a3f", "#96773a",
      "#6b3a4f", "#c2604f", "#8a6b3f", "#5f3a2f",
    ],
  },
  {
    ...base,
    key: "berry",
    name: "葡萄",
    note: "紫と赤紫。他と並べたときに埋もれない。",
    series: [
      "#6b3a6b", "#a34a7a", "#4f3f8f", "#b56b9a",
      "#8a5aa8", "#5f5f8f", "#8f4f6b", "#3f2f5a",
    ],
  },
  {
    ...base,
    key: "mono",
    name: "墨",
    /*
     * 無彩色は原理的に系列を分けにくい。白地で 3:1 を保ったまま並べられる灰は
     * 数が限られるので、5本目以降は隣と見分けが付かなくなる。3〜4系列までの
     * グラフ、または白黒で刷る資料のためのテーマとして置いてある。
     */
    note: "無彩色。白黒印刷や資料への貼り込みに。",
    series: [
      "#2b2a26", "#55534b", "#7d7a70", "#93907f",
      "#403e38", "#8a8677", "#6b6860", "#979383",
    ],
  },
  {
    ...base,
    key: "vivid",
    name: "彩",
    note: "はっきりした色。会議室のモニタで遠くから見る用。",
    series: [
      "#c2352b", "#1f6fb5", "#c47812", "#2f8f4f",
      "#7d3fa8", "#00868f", "#c25a8f", "#5f6b1f",
    ],
  },
  {
    ...base,
    /*
     * Okabe & Ito のカラーユニバーサルデザイン推奨配色。
     * 日本人男性の約5%（20人に1人）は赤緑の見分けが付きにくい。人数の多い
     * 会議で配るなら、好みより先にこれを選べる状態にしておきたい。
     * 原案の黄 #F0E442 は白地で細線にすると消えるので、明度だけ落としてある。
     */
    key: "safe",
    name: "識別",
    note: "色覚に配慮した並び。大人数に配る資料に。",
    series: [
      "#0072b2", "#d55e00", "#009e73", "#cc79a7",
      "#8a7500", "#56b4e9", "#3a3a3a", "#a85f2f",
    ],
  },
].map((p) => ({ ...p, ramp: p.series[0] }));

export const DEFAULT_PALETTE_KEY = "standard";

const BY_KEY = new Map(PALETTES.map((p) => [p.key, p]));

/** 不明なキーは標準に落とす。過去のデータや手書きのJSONで壊れないように。 */
export function paletteFor(key?: string | null): Palette {
  return BY_KEY.get(key ?? "") ?? BY_KEY.get(DEFAULT_PALETTE_KEY)!;
}

/**
 * 系列の色を決める。
 *
 * `token` は旧来の名前指定（khaki / info / success / …）。テンプレートや AI が
 * 返してくる既存の指定を捨てないために残してある。テーマを選んでいる場合、
 * **意味を持たない名前**（khaki / info / neutral）はテーマの系列色に読み替え、
 * 意味を持つ名前（success / danger / warning）はそのまま尊重する——
 * 「達成」と名付けて緑を指定した系列が、テーマ変更で紫になっては困る。
 */
const SEMANTIC: Record<string, string> = {
  success: POSITIVE,
  danger: NEGATIVE,
  warning: "#8f6222",
  /*
   * 「その他」「未設定」に付く色。どのテーマでも灰のままにする。
   * まとめ先や欠落は、内訳のひとつとして主張してはいけない——
   * 上位5社の隣で「その他」が同じ濃さで光ると、6社目があるように見える。
   */
  neutral: "#a8a493",
};

export function seriesColor(
  palette: Palette,
  index: number,
  token?: string | null,
): string {
  if (token && SEMANTIC[token]) return SEMANTIC[token];
  return palette.series[index % palette.series.length];
}

/** 図の中の目盛り線と文字。テーマによらず一定（読むための色であって、飾りではない）。 */
export const CHART_GRID = "#e2ded1";
export const CHART_TEXT = "#57544b";
/** 円やツリーマップの区切り線。背景と同色で、隣り合う面を離して見せる。 */
export const CHART_SEPARATOR = "#fbfaf6";

/**
 * `#rrggbb` を `"r, g, b"` に開く。CSS の `rgba()` に濃度を差し込むため。
 * ヒートマップは「同じ色の濃さ」で量を表すので、色そのものではなく
 * 成分が要る。
 */
export function rgbTriple(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
