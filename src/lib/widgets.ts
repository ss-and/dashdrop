/**
 * Declarative widget & dashboard specification.
 *
 * A Dashboard's `layout` is an array of WidgetSpec objects. Each widget names a
 * source collection (by slug), a measure, and optional filters/grouping. The
 * aggregation engine (src/lib/aggregate.ts) turns a WidgetSpec + the workspace's
 * records into a WidgetData the UI can render. Templates (and the AI generator)
 * only ever produce data conforming to these Zod schemas — so everything stays
 * validated end to end.
 */
import { z } from "zod";
import { FIELD_TYPES, type SelectOption } from "./field-types";

/* ------------------------------- measures ------------------------------- */

export const measureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("count") }),
  z.object({ kind: z.literal("sum"), field: z.string().min(1) }),
  z.object({ kind: z.literal("avg"), field: z.string().min(1) }),
  z.object({ kind: z.literal("min"), field: z.string().min(1) }),
  z.object({ kind: z.literal("max"), field: z.string().min(1) }),
]);
export type Measure = z.infer<typeof measureSchema>;

/* -------------------------------- filters ------------------------------- */

export const filterSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "neq", "in", "gt", "gte", "lt", "lte", "truthy", "falsy"]),
  value: z.unknown().optional(),
});
export type Filter = z.infer<typeof filterSchema>;

export const unitSchema = z.enum(["number", "currency", "percent", "days"]);
export type Unit = z.infer<typeof unitSchema>;

const gridSpan = z.number().int().min(1).max(4).optional();

/* -------------------------------- widgets ------------------------------- */

const baseWidget = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  collection: z.string().min(1), // collection slug within the dashboard
  /** Column span on a 4-wide grid (1 = quarter … 4 = full). */
  span: gridSpan,
  filters: z.array(filterSchema).optional(),
});

export const kpiWidgetSchema = baseWidget.extend({
  type: z.literal("kpi"),
  measure: measureSchema,
  unit: unitSchema.optional(),
  icon: z.string().optional(),
  /**
   * Render as a rate (percent). value = matching(rateNumerator) / total(filtered).
   */
  rateNumerator: z.array(filterSchema).optional(),
  /**
   * Compare current period vs the previous one for a delta chip. NOTE: setting
   * `delta` makes the KPI value period-scoped (this week/month), not lifetime —
   * pair it with titles like "今週の…". Omit it for a lifetime total.
   */
  delta: z
    .object({
      dateField: z.string().optional(), // defaults to createdAt
      period: z.enum(["week", "month"]).default("week"),
    })
    .optional(),
  target: z.number().optional(),
});
export type KpiWidget = z.infer<typeof kpiWidgetSchema>;

export const seriesMeasureSchema = z.object({
  label: z.string().min(1),
  measure: measureSchema,
  filters: z.array(filterSchema).optional(),
  color: z.string().optional(), // token name: khaki|success|warning|danger|info
  /**
   * 複合グラフ（combo）でこの系列をどう描くか。棒と線を1枚に重ねるのは
   * 「件数（棒）と金額（線）」のように**単位の違う2つ**を並べて見るためで、
   * 同じ軸に押し込むと片方が地面に貼り付いて読めなくなる。
   * combo 以外のグラフでは無視される。
   */
  as: z.enum(["bar", "line", "area"]).optional(),
  /** combo で右側の軸に載せる。単位が違う系列を左軸に混ぜないための逃げ道。 */
  axis: z.enum(["left", "right"]).optional(),
});
export type SeriesMeasure = z.infer<typeof seriesMeasureSchema>;

export const seriesWidgetSchema = baseWidget.extend({
  type: z.enum(["line", "area", "bar", "combo"]),
  dateField: z.string().optional(), // defaults to createdAt
  bucket: z.enum(["day", "week", "month"]).default("day"),
  rangeCount: z.number().int().min(2).max(60).default(14),
  /**
   * 期間の合わせ先。
   *
   * "now"（既定）は「今日までの直近 rangeCount 期間」。運用中の記録を見るには
   * これで良いが、取り込んだ表には**未来の日付**が普通に入っている（完了予定日・
   * 納期・支払期日）。実際、営業案件Excelでは完了予定日が全件未来だったため、
   * 窓の外に落ちて棒が1本しか立たなかった。
   *
   * "data" はデータ自身の範囲に窓を合わせる。過去だけの表も未来だけの表も、
   * 持っている期間がそのまま出る。
   */
  anchor: z.enum(["now", "data"]).optional(),
  measures: z.array(seriesMeasureSchema).min(1).max(4),
  stacked: z.boolean().optional(),
  /**
   * 区分別に系列を割る（Tableau の「色に区分を載せる」）。
   *
   * 指定すると `measures[0]` の指標を、この列の値ごとに1本ずつ描く——
   * 「月別の売上」が「月別・フェーズ別の売上」になる。合計の推移だけでは
   * 「どこが伸びたのか」が分からないので、積み上げると内訳まで一度に読める。
   * 値の種類が多いときは上位 `splitLimit` 本だけ残し、残りは「その他」に畳む。
   */
  splitBy: z.string().min(1).optional(),
  /** 残す系列の本数。省略時は 5。 */
  splitLimit: z.number().int().min(2).max(8).optional(),
  /**
   * 積み上げの見せ方。`stacked` が立っているときだけ効く。
   *
   * "value"（既定）は実数の積み上げ。"percent" は各期間を 100% に伸ばして
   * **割合の推移**を見せる。実数だけでは「全体が増えたのか、割合が動いたのか」
   * が切り分けられない——母数が倍になれば、比率が落ちていても棒は伸びる。
   */
  stackMode: z.enum(["value", "percent"]).optional(),
});
export type SeriesWidget = z.infer<typeof seriesWidgetSchema>;

export const breakdownWidgetSchema = baseWidget.extend({
  type: z.enum(["donut", "hbar", "treemap", "funnel"]),
  groupBy: z.string().min(1), // field key to group on
  measure: measureSchema.default({ kind: "count" }),
  limit: z.number().int().min(2).max(12).default(6),
  /**
   * 並び順。既定は値の大きい順。
   *
   * ファネルだけは違う——「A: 契約完了 / B: 内諾あり / C: 提案」のような段階は
   * 値の大小ではなく**段階の順**に並んでいないと漏斗として読めない。選択肢型の
   * 列では選択肢の定義順、そうでなければラベル順に並べる。
   */
  order: z.enum(["value", "label"]).optional(),
});
export type BreakdownWidget = z.infer<typeof breakdownWidgetSchema>;

export const tableWidgetSchema = baseWidget.extend({
  type: z.literal("table"),
  columns: z.array(z.string().min(1)).min(1).max(8),
  sort: z
    .object({ field: z.string().min(1), dir: z.enum(["asc", "desc"]) })
    .optional(),
  limit: z.number().int().min(1).max(50).default(8),
});
export type TableWidget = z.infer<typeof tableWidgetSchema>;

/**
 * Cross-tab: one field down the side, one across the top, a measure in the
 * cells. Modelled on the classic rows × cols × aggregator shape used by
 * PivotTable.js (MIT) — implemented here from scratch against our own engine.
 */
export const pivotWidgetSchema = baseWidget.extend({
  type: z.literal("pivot"),
  /** Field key grouped down the side. */
  rowField: z.string().min(1),
  /** Field key grouped across the top. */
  colField: z.string().min(1),
  measure: measureSchema.default({ kind: "count" }),
  unit: unitSchema.optional(),
  /** Max distinct rows / columns kept; the rest collapse into 「その他」. */
  rowLimit: z.number().int().min(2).max(50).default(12),
  colLimit: z.number().int().min(2).max(20).default(8),
  showTotals: z.boolean().default(true),
});
export type PivotWidget = z.infer<typeof pivotWidgetSchema>;

/**
 * ヒートマップ。中身はクロス集計とまったく同じ（行 × 列 × 指標）で、
 * 読み方だけが違う。数字を1つずつ読むのではなく、濃淡で「どこが厚いか」を
 * 一瞬で掴むためのもの。計算を共有しているので、同条件のクロス集計と
 * 必ず同じ数字になる。
 */
export const heatmapWidgetSchema = pivotWidgetSchema.extend({
  type: z.literal("heatmap"),
});
export type HeatmapWidget = z.infer<typeof heatmapWidgetSchema>;

/**
 * 散布図。1行 = 1点。2つの数値の関係（金額 × 数量、金額 × リードタイム）を
 * 見るためのもので、集計すると消えてしまう「外れ値」が唯一そのまま見える図。
 */
export const scatterWidgetSchema = baseWidget.extend({
  type: z.literal("scatter"),
  xField: z.string().min(1),
  yField: z.string().min(1),
  /** 点の色を分ける区分（任意）。 */
  colorBy: z.string().optional(),
  /** 点のラベル（どの行かを言い当てるための列）。 */
  labelField: z.string().optional(),
  /** 描く点の上限。多すぎる点は図ではなく塗りつぶしになる。 */
  limit: z.number().int().min(10).max(2000).default(500),
  xUnit: unitSchema.optional(),
  yUnit: unitSchema.optional(),
  /**
   * 点の大きさに載せる3つ目の数値（バブルチャート）。
   *
   * 縦横だけでは2つの量しか比べられない。「単価×数量」の散布に受注金額を
   * 大きさで載せると、右上に居る＝良い案件とは限らない（単価も数量も高いのに
   * 金額が小さい＝値引きが大きい、が点の小ささで見える）。
   */
  sizeField: z.string().optional(),
  sizeUnit: unitSchema.optional(),
});
export type ScatterWidget = z.infer<typeof scatterWidgetSchema>;

/**
 * ヒストグラム（度数分布）。数値列を等間隔の区間に区切って、何件ずつ入るかを
 * 数える。平均だけでは「10万の案件が大量にあり、1億が1件」なのか
 * 「全部1000万前後」なのかが区別できない——分布はそれを一目で示す。
 */
export const histogramWidgetSchema = baseWidget.extend({
  type: z.literal("histogram"),
  field: z.string().min(1),
  /** 区間の数。 */
  bins: z.number().int().min(3).max(30).default(10),
  unit: unitSchema.optional(),
});
export type HistogramWidget = z.infer<typeof histogramWidgetSchema>;

/**
 * ゲージ（目標に対する進捗）。
 *
 * これまで「目標」を表せる図が1つも無かった。KPI タイルに `target` はあるが、
 * 数字の横に小さく出るだけで、**達したのか、まだ遠いのか**が一目で分からない。
 * 予算消化・売上目標・KPI 達成率のように、値そのものより「目標との距離」が
 * 主題になる場面は多い。
 */
export const gaugeWidgetSchema = baseWidget.extend({
  type: z.literal("gauge"),
  measure: measureSchema,
  /** 目標値。ゲージは目標があって初めて意味を持つので必須。 */
  target: z.number(),
  unit: unitSchema.optional(),
  /**
   * 小さいほど良い指標（コスト・リードタイム・不良率）。
   *
   * これが無いと、コスト超過が「達成」の色で塗られる。良し悪しの向きは
   * データから読み取れないので、作るときに決めておく必要がある。
   */
  lowerIsBetter: z.boolean().optional(),
});
export type GaugeWidget = z.infer<typeof gaugeWidgetSchema>;

/**
 * ウォーターフォール（増減の内訳）。
 *
 * 「今期は前期から 1,200万 増えた」の**内訳**を段で見せる図。合計と構成比の
 * グラフでは「どれが押し上げ、どれが引き下げたか」が出せない。予実差異の分析、
 * 利益の分解（売上→原価→販管費→営業利益）で使う。
 */
export const waterfallWidgetSchema = baseWidget.extend({
  type: z.literal("waterfall"),
  /** 段を並べる軸。区分（部門・費目）の値がそのまま段になる。 */
  groupBy: z.string().min(1),
  measure: measureSchema.default({ kind: "count" }),
  /** 段の数の上限。超えた分は「その他」に畳む。 */
  limit: z.number().int().min(2).max(12).default(8),
  /** 最後に合計の段を置く。 */
  showTotal: z.boolean().default(true),
  unit: unitSchema.optional(),
  /**
   * 並び順。既定は値の大きい順（押し上げた順に読める）。
   * "label" は費目の定義順どおりに並べたいとき。
   */
  order: z.enum(["value", "label"]).optional(),
});
export type WaterfallWidget = z.infer<typeof waterfallWidgetSchema>;

/**
 * 箱ひげ図（分布の比較）。
 *
 * ヒストグラムは「1本の列の分布」だが、こちらは**グループ間の分布の比較**。
 * 「担当者別のリードタイム」を平均で並べると、平均10日の2人が
 * 「毎回10日」と「3日と30日が半々」でも同じ高さになる。仕事の質はまるで違う。
 */
export const boxplotWidgetSchema = baseWidget.extend({
  type: z.literal("boxplot"),
  /** 分布を見る数値の列。 */
  field: z.string().min(1),
  /** 並べる区分。省略すると全体で1本。 */
  groupBy: z.string().optional(),
  /** 箱の数の上限。 */
  limit: z.number().int().min(2).max(12).default(8),
  unit: unitSchema.optional(),
});
export type BoxplotWidget = z.infer<typeof boxplotWidgetSchema>;

/**
 * レーダー（多角形）。
 *
 * 軸は `groupBy` の値、重ねる多角形は `splitBy` の値。指標は**1つだけ**に
 * 絞ってある——件数と金額を1枚のレーダーに重ねると、半径の意味が2つになって
 * 図として嘘になる（1万円と1件がどちらも「外側」に描かれる）。
 * 比べたいのは「同じ物差しで測った、形の違い」。
 */
export const radarWidgetSchema = baseWidget.extend({
  type: z.literal("radar"),
  /** 軸になる区分。 */
  groupBy: z.string().min(1),
  measure: measureSchema.default({ kind: "count" }),
  /** 重ねる多角形を分ける区分。省略すると1枚。 */
  splitBy: z.string().optional(),
  splitLimit: z.number().int().min(2).max(6).default(3),
  /** 軸の本数。3本未満では多角形にならない。 */
  limit: z.number().int().min(3).max(12).default(6),
  unit: unitSchema.optional(),
});
export type RadarWidget = z.infer<typeof radarWidgetSchema>;

/**
 * サンキー（流れ）。
 *
 * 「どこから来て、どこへ行ったか」を帯の太さで見せる。チャネル→フェーズ、
 * 流入元→結果、部門→費目。クロス集計でも同じ数字は出せるが、
 * **どこが太いか**は数字の表からは掴めない。
 */
export const sankeyWidgetSchema = baseWidget.extend({
  type: z.literal("sankey"),
  /** 流れの始まり。 */
  fromField: z.string().min(1),
  /** 流れの終わり。 */
  toField: z.string().min(1),
  measure: measureSchema.default({ kind: "count" }),
  /** 左右それぞれの節点の上限。超えた分は「その他」に畳む。 */
  limit: z.number().int().min(2).max(10).default(6),
  unit: unitSchema.optional(),
});
export type SankeyWidget = z.infer<typeof sankeyWidgetSchema>;

/**
 * 日本地図（都道府県別）。
 *
 * 中身はタイル（1県 = 1マス）。理由は src/lib/japan.ts に書いてある——
 * 面積で描くと、東京の数字が北海道の面積に負ける。
 */
export const japanMapWidgetSchema = baseWidget.extend({
  type: z.literal("japanmap"),
  /** 都道府県名（または住所）が入っている列。 */
  field: z.string().min(1),
  measure: measureSchema.default({ kind: "count" }),
  unit: unitSchema.optional(),
});
export type JapanMapWidget = z.infer<typeof japanMapWidgetSchema>;

export const widgetSchema = z.discriminatedUnion("type", [
  kpiWidgetSchema,
  seriesWidgetSchema.extend({ type: z.literal("line") }),
  seriesWidgetSchema.extend({ type: z.literal("area") }),
  seriesWidgetSchema.extend({ type: z.literal("bar") }),
  seriesWidgetSchema.extend({ type: z.literal("combo") }),
  breakdownWidgetSchema.extend({ type: z.literal("donut") }),
  breakdownWidgetSchema.extend({ type: z.literal("hbar") }),
  breakdownWidgetSchema.extend({ type: z.literal("treemap") }),
  breakdownWidgetSchema.extend({ type: z.literal("funnel") }),
  tableWidgetSchema,
  pivotWidgetSchema,
  heatmapWidgetSchema,
  scatterWidgetSchema,
  histogramWidgetSchema,
  gaugeWidgetSchema,
  waterfallWidgetSchema,
  boxplotWidgetSchema,
  radarWidgetSchema,
  sankeyWidgetSchema,
  japanMapWidgetSchema,
]);
export type WidgetSpec = z.infer<typeof widgetSchema>;

/**
 * 1枚に載せられるウィジェットの数。
 *
 * 自動作成は「基本8枚以上」を目安に組み立てるが、タブが複数あるファイルでは
 * シートごとに積み上がる。16 では 3シートのファイルで頭打ちになり、
 * 保存時に 400 で弾かれていた。
 */
export const dashboardLayoutSchema = z.array(widgetSchema).min(1).max(48);

/* ------------------------ template collection spec ---------------------- */

export const templateFieldSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        color: z.string().optional(),
      }),
    )
    .optional(),
  /** Hint that steers realistic sample-data generation (see sample-data.ts). */
  sample: z
    .object({
      pool: z.array(z.string()).optional(), // pick from these labels/values
      min: z.number().optional(),
      max: z.number().optional(),
      // date spread in days back from today
      daysBack: z.number().optional(),
      // weighting for select options (parallel to options[])
      weights: z.array(z.number()).optional(),
      trend: z.enum(["flat", "up", "down"]).optional(),
    })
    .optional(),
});
export type TemplateField = z.infer<typeof templateFieldSchema>;

export const templateCollectionSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  icon: z.string().default("table"),
  color: z.string().default("khaki"),
  fields: z.array(templateFieldSchema).min(1),
  /** How many sample rows to seed when this template is applied. */
  sampleRows: z.number().int().min(0).max(500).default(60),
});
export type TemplateCollection = z.infer<typeof templateCollectionSchema>;

export const dashboardTemplateSchema = z.object({
  key: z.string().min(1),
  category: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().default("dashboard"),
  color: z.string().default("khaki"),
  collections: z.array(templateCollectionSchema).min(1).max(4),
  widgets: dashboardLayoutSchema,
});
export type DashboardTemplate = z.infer<typeof dashboardTemplateSchema>;

/* ------------------------------ computed data --------------------------- */

export interface KpiData {
  type: "kpi";
  value: number;
  unit: Unit;
  deltaPercent?: number | null;
  target?: number;
}
export interface SeriesData {
  type: "line" | "area" | "bar" | "combo";
  points: Array<Record<string, string | number>>; // { x, [label]: number }
  series: Array<{
    label: string;
    color?: string;
    /** combo でのこの系列の描き方。未指定なら棒。 */
    as?: "bar" | "line" | "area";
    /** combo で載せる軸。未指定なら左。 */
    axis?: "left" | "right";
  }>;
  stacked?: boolean;
  /** 積み上げの見せ方。"percent" なら各期間を 100% に伸ばす。 */
  stackMode?: "value" | "percent";
}
export interface BreakdownData {
  type: "donut" | "hbar" | "treemap" | "funnel";
  slices: Array<{
    label: string;
    value: number;
    color?: string;
    /**
     * 上限を超えた分をまとめた「残余」のスライス。実データの1項目ではないので、
     * ドリルダウンの対象にしてはいけない（その値で絞り込んでも1件も出ない）。
     *
     * ラベル文字列で見分けようとしないこと。残余は既定で「その他」と表示するが、
     * 実データにも「その他」という項目は普通に存在する。文字列一致だと、
     * 本物の「その他」までドリルダウン不可にしてしまう。
     */
    synthetic?: boolean;
    /**
     * 絞り込みに使う生のキー（表示ラベルではない）。選択肢型の列ではラベルが
     * 選択肢名に置き換わるため、ラベルで絞ると一致しない。残余（その他）には無い。
     */
    key?: string;
  }>;
  total: number;
  /** 絞り込み先を組み立てるための情報。 */
  groupBy?: string;
  /**
   * groupBy の列が1行に複数の値を持つか（複数選択）。
   *
   * 集計は配列を要素ごとに全バケットへ展開するので、複数選択の列は `eq` では
   * 絶対に一致しない（`has` が要る）。逆に単一値の列に `has` を使うと、
   * 絞り込みのチップが「部門 に 営業部 を含む」という硬い文言になる。
   * 型そのものを配らず、判断に必要な1ビットだけを渡す。
   */
  groupByMulti?: boolean;
  collectionId?: string;
}
export interface TableData {
  type: "table";
  columns: Array<{
    key: string;
    name: string;
    type: string;
    options?: SelectOption[] | null;
  }>;
  rows: Array<Record<string, unknown>>;
  /** 行を開くためのレコードID（`rows` と同じ並び）。 */
  rowIds?: string[];
  /** 行のリンク先を組み立てるためのスプレッドシートID。 */
  collectionId?: string;
}
export interface PivotData {
  type: "pivot" | "heatmap";
  rowLabel: string;
  colLabel: string;
  /** Distinct row headers, in display order. */
  rows: string[];
  /** Distinct column headers, in display order. */
  cols: string[];
  /** cells[rowIndex][colIndex] — null where no records matched. */
  cells: Array<Array<number | null>>;
  rowTotals: number[];
  colTotals: number[];
  grandTotal: number;
  unit: Unit;
  showTotals: boolean;
}
/** 散布図の1点 = 1レコード。 */
export interface ScatterData {
  type: "scatter";
  points: Array<{
    x: number;
    y: number;
    /** バブルの大きさに使う3つ目の量。未指定なら一定の大きさで描く。 */
    z?: number;
    /** どの行なのか（明細を開くため／ツールチップの見出し）。 */
    label: string;
    /** レコードID。押したらその行へ飛ぶ。 */
    id?: string;
    /** 色分けの区分ラベル。 */
    group?: string;
  }>;
  /** 区分ごとの色。points[].group と対応する。 */
  groups: Array<{ label: string; color?: string }>;
  /** 大きさに載せた数値の名前。未指定なら点の大きさは一定。 */
  sizeLabel?: string;
  sizeUnit?: Unit;
  xLabel: string;
  yLabel: string;
  xUnit: Unit;
  yUnit: Unit;
  collectionId?: string;
  /** 上限で描き切れなかった点の数。0 でなければ画面で断る。 */
  omitted: number;
}

/** ゲージ。値と目標だけを持ち、達成度の判断は描く側に任せない。 */
export interface GaugeData {
  type: "gauge";
  value: number;
  target: number;
  unit: Unit;
  /**
   * 達成度（0〜）。目標が 0 のときは割り算できないので null。
   * 「小さいほど良い」の反転はここで済ませてあるので、描く側は
   * 大きいほど良い前提で読んで良い。
   */
  ratio: number | null;
  lowerIsBetter: boolean;
}

/** ウォーターフォールの1段。 */
export interface WaterfallStep {
  label: string;
  /** その段の増減量（合計段では合計そのもの）。 */
  value: number;
  /** 段の下端・上端（積み上げの位置）。合計段は 0 から立つ。 */
  start: number;
  end: number;
  kind: "increase" | "decrease" | "total";
  /** まとめた残余の段。ドリルダウンの対象にしない。 */
  synthetic?: boolean;
  key?: string;
}
export interface WaterfallData {
  type: "waterfall";
  steps: WaterfallStep[];
  total: number;
  unit: Unit;
  groupBy?: string;
  /** groupBy の列が1行に複数の値を持つか。BreakdownData の同名の項目と同じ意味。 */
  groupByMulti?: boolean;
  collectionId?: string;
}

/**
 * 箱ひげの1本。
 *
 * ひげの端は Tukey の流儀で、**四分位範囲の1.5倍以内にある実データの
 * 最小・最大**。単純な最小値・最大値にすると、外れ値1件でひげが伸びきって
 * 箱が潰れ、比べたかった中央の差が見えなくなる。
 */
export interface BoxplotBox {
  label: string;
  /** ひげの下端（q1 - 1.5×IQR 以内の最小の実データ）。 */
  low: number;
  q1: number;
  median: number;
  q3: number;
  /** ひげの上端（q3 + 1.5×IQR 以内の最大の実データ）。 */
  high: number;
  /** ひげの外に出た点。「たまたま」ではなく「例外」として別に描く。 */
  outliers: number[];
  /** 数えた行数。1〜2件の箱は形に意味が無いので、画面で断るのに使う。 */
  count: number;
  key?: string;
  synthetic?: boolean;
}
export interface BoxplotData {
  type: "boxplot";
  boxes: BoxplotBox[];
  unit: Unit;
  /** 分布を見た列の名前。 */
  fieldLabel: string;
  groupBy?: string;
  /** groupBy の列が1行に複数の値を持つか。BreakdownData の同名の項目と同じ意味。 */
  groupByMulti?: boolean;
  collectionId?: string;
}

/** レーダー。軸の並びと、多角形ごとの値（軸と同じ並び）。 */
export interface RadarData {
  type: "radar";
  axes: string[];
  series: Array<{
    label: string;
    color?: string;
    /** axes と同じ長さ・同じ並び。該当が無い軸は 0。 */
    values: number[];
  }>;
  unit: Unit;
  max: number;
}

/** サンキー。節点と、節点間の流れ。 */
export interface SankeyData {
  type: "sankey";
  nodes: Array<{
    /** 画面に出す名前。 */
    label: string;
    /** 左（出発）か右（到着）か。 */
    side: "from" | "to";
  }>;
  /** nodes の添字で結ぶ。 */
  links: Array<{ source: number; target: number; value: number }>;
  unit: Unit;
  fromLabel: string;
  toLabel: string;
}

/** 日本地図（都道府県タイル）。 */
export interface JapanMapData {
  type: "japanmap";
  /** 値のあった県だけ。無い県は塗らない（0 と「データ無し」は違う）。 */
  values: Array<{
    code: string;
    name: string;
    value: number;
    /**
     * 絞り込みに使う **生キー**（正規化前の、実データにそのまま入っている値）。
     *
     * `name` は正規化後の表示名（「東京都」）で、実データは「東京」「13」
     * 「東京都渋谷区…」のこともある。表示名で絞ると1件も一致しないので、
     * 1つの県に積まれた書き方を全部持っておき、そのいずれかで絞る。
     */
    keys: string[];
    /**
     * 生キーを取り切れなかった（種類が多すぎる／配列だった）。
     * true の県は、中途半端に絞った表を出さないために押させない。
     */
    keysPartial?: boolean;
  }>;
  max: number;
  min: number;
  unit: Unit;
  /**
   * 都道府県として読めなかった値。数だけでなく実例も返す——
   * 「12件が読めませんでした」だけでは、何を直せばいいのか分からない。
   */
  unmatched: { count: number; samples: string[] };
  groupBy?: string;
  /** groupBy の列が1行に複数の値を持つか。BreakdownData の同名の項目と同じ意味。 */
  groupByMulti?: boolean;
  collectionId?: string;
}

export type WidgetData =
  | KpiData
  | BoxplotData
  | RadarData
  | SankeyData
  | JapanMapData
  | GaugeData
  | WaterfallData
  | PivotData
  | SeriesData
  | BreakdownData
  | TableData
  | ScatterData;
