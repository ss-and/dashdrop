/**
 * Aggregation engine — turns a WidgetSpec + a workspace's records into a
 * WidgetData the UI renders. Pure and deterministic (given a `now`), so it is
 * fully unit-testable. Used by the dashboard renderer for every widget.
 */
import type {
  WidgetSpec,
  WidgetData,
  Measure,
  Filter,
  KpiWidget,
  SeriesWidget,
  BreakdownWidget,
  TableWidget,
  PivotWidget,
  HeatmapWidget,
  ScatterWidget,
  HistogramWidget,
  GaugeWidget,
  GaugeData,
  WaterfallWidget,
  WaterfallData,
  WaterfallStep,
  SeriesData,
  Unit,
} from "./widgets";
import { foldWidthVariants } from "./formula";
import { formatCompact } from "./utils";

export interface AggRecord {
  id: string;
  data: Record<string, unknown>;
  createdAt: Date | string;
  isSampleData?: boolean;
}

export interface AggCollection {
  slug: string;
  name: string;
  /**
   * スプレッドシートの実体ID。ウィジェットから「その明細を開く」ためのリンクに
   * 使う。slug は URL に出せるが、レコード画面もグリッドも id で引くので、
   * ここまで持ち回らないとダッシュボードが行き止まりになる。
   */
  id?: string;
  fields: Array<{
    key: string;
    name: string;
    type: string;
    options?: Array<{ label: string; value: string; color?: string }> | null;
  }>;
  records: AggRecord[];
}

export type CollectionMap = Map<string, AggCollection>;

/* ------------------------------ primitives ------------------------------ */

/**
 * 10進の数値リテラルだけを受け付ける。
 *
 * `Number()` は "0x10" を 16、"0b11" を 3、"Infinity" を ∞ と読んでしまう。
 * 業務データでその形の文字列は商品コードや型番であって数値ではないので、
 * 黙って別の数字に化けるより弾く。指数表記（"1e3" → 1000）は表計算ソフトが
 * 実際にそう書き出すため受け付ける。
 */
const NUMERIC_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * 値を数値に変換する。数値として読めなければ null。
 *
 * 回帰: 以前は `Number("")` が 0 で `Number.isFinite` を通ってしまい、空文字・
 * 空白のみ・「¥」だけのセルが 0 として集計されていた。結果、100 / "" / "  " /
 * "¥" の4行で 最小 0（正しくは 100）・平均 25（正しくは 100）になっていた。
 * 「数値でない値は 0 ではなく“寄与しない”」は formula エンジン
 * （src/lib/formula/functions.ts の toNumber）と同じ規則で、集計側もそれに揃える。
 */
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    // 桁区切り・通貨記号・空白（全角含む）は数値の飾りなので落とす。
    // 全角も畳む。ここだけ畳まないと「１２３」が数式と vlookup では 123、
  // 集計では null になり、同じセルが画面によって別の数字になる。
  // 文字列全体の NFKC は使わないこと（「①」を 1 と読んでしまう）。
  const stripped = foldWidthVariants(v).replace(/[,\s¥$€£]/g, "");
    if (stripped === "" || !NUMERIC_RE.test(stripped)) return null;
    const n = Number(stripped);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function recordDate(rec: AggRecord, dateField?: string): Date | null {
  if (dateField && dateField !== "createdAt") {
    const d = toDate(rec.data[dateField]);
    if (d) return d;
  }
  return toDate(rec.createdAt);
}

/** 表示用の丸め（小数2桁）。全ウィジェットで同じ規則を使う。 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** ISO-ish date string: "2026-07-19" or "2026-07-19T09:00:00Z". */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Order a value for gt/gte/lt/lte.
 *
 * Dates must be handled before numbers: `Number("2026-07-19")` is NaN, so a
 * range filter on a date column used to match *nothing at all* — silently, with
 * no error. Date values are stored as "YYYY-MM-DD" (coerceValue slices to 10
 * chars), so we parse those to a timestamp and compare on that.
 */
function toComparable(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" && ISO_DATE_RE.test(v)) {
    const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v);
    if (Number.isFinite(t)) return t;
  }
  return toNumber(v);
}

function matchFilter(rec: AggRecord, f: Filter): boolean {
  const v = rec.data[f.field];
  switch (f.op) {
    case "eq":
      return String(v ?? "") === String(f.value ?? "");
    case "neq":
      return String(v ?? "") !== String(f.value ?? "");
    case "in": {
      // 回帰: 両辺が配列のとき、レコード側を String() で潰して "x,y" という
      // 1個の文字列にしていたため、複数選択・リレーションのセル（["x","y"]）は
      // ["x"] に一度も一致せず 0 件になっていた。どちらの辺が配列でも
      // 「共通する要素があれば真」で判定する（"in" の素直な読み方）。
      const wanted = Array.isArray(f.value)
        ? f.value.map(String)
        : [String(f.value ?? "")];
      const actual = Array.isArray(v) ? v.map(String) : [String(v ?? "")];
      return actual.some((a) => wanted.includes(a));
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toComparable(v);
      const b = toComparable(f.value);
      if (a === null || b === null) return false;
      if (f.op === "gt") return a > b;
      if (f.op === "gte") return a >= b;
      if (f.op === "lt") return a < b;
      return a <= b;
    }
    case "truthy":
      return Boolean(v) && v !== "false" && v !== "0";
    case "falsy":
      return !v || v === "false" || v === "0";
    default:
      return true;
  }
}

function applyFilters(records: AggRecord[], filters?: Filter[]): AggRecord[] {
  if (!filters || filters.length === 0) return records;
  return records.filter((r) => filters.every((f) => matchFilter(r, f)));
}

/* --------------------------- measure accumulator ------------------------ */

/**
 * すべてのウィジェットが共有する集計バケット。
 *
 * 合計だけを貯めると 最小/最大 が合計を表示し、平均が同条件の KPI とずれる
 * （クロス集計とカテゴリ内訳の両方で実際に起きた不具合）。件数・最小・最大を
 * 別々に持ち、取り出し方だけを measure の種類で切り替えることで、KPI・推移・
 * 内訳・クロス集計が必ず同じ答えを返す。
 */
interface MeasureBucket {
  sum: number;
  count: number;
  min: number | null;
  max: number | null;
}

function emptyBucket(): MeasureBucket {
  return { sum: 0, count: 0, min: null, max: null };
}

function addValue(b: MeasureBucket, v: number): void {
  b.sum += v;
  b.count += 1;
  b.min = b.min === null || v < b.min ? v : b.min;
  b.max = b.max === null || v > b.max ? v : b.max;
}

/**
 * 1レコードがこの measure に寄与する値。数値として読めなければ null＝まったく
 * 寄与しない。0 として数えると平均が下がり、最小が 0 に化けるため。
 */
function contributionOf(rec: AggRecord, m: Measure): number | null {
  if (m.kind === "count") return 1;
  return toNumber(rec.data[m.field]);
}

/**
 * バケットを合成する。合計は「集計済みのセル」ではなく元の値から計算する必要
 * がある（平均の合計は平均ではないし、最小の合計は最小ではない）。
 */
function mergeBuckets(
  parts: Array<MeasureBucket | undefined>,
): MeasureBucket | undefined {
  let found = false;
  const out = emptyBucket();
  for (const b of parts) {
    if (!b) continue;
    found = true;
    out.sum += b.sum;
    out.count += b.count;
    if (b.min !== null) out.min = out.min === null ? b.min : Math.min(out.min, b.min);
    if (b.max !== null) out.max = out.max === null ? b.max : Math.max(out.max, b.max);
  }
  return found ? out : undefined;
}

/** バケットから measure の値を取り出す。寄与が無ければ null（「0」とは別物）。 */
function bucketValue(
  b: MeasureBucket | undefined,
  kind: Measure["kind"],
): number | null {
  if (!b || b.count === 0) return null;
  switch (kind) {
    case "avg":
      return b.sum / b.count;
    case "min":
      return b.min ?? 0;
    case "max":
      return b.max ?? 0;
    default: // count / sum
      return b.sum;
  }
}

function collectBucket(records: AggRecord[], m: Measure): MeasureBucket {
  const b = emptyBucket();
  for (const r of records) {
    const v = contributionOf(r, m);
    if (v === null) continue;
    addValue(b, v);
  }
  return b;
}

/**
 * 単一の measure を計算する。
 *
 * 回帰: 最小/最大 は `Math.min(...nums)` で求めていたが、引数の展開はレコード
 * 数ぶんのスタックを使うため 13万行で RangeError になり、ダッシュボード
 * （公開共有ページ含む）が丸ごと 500 になっていた。Business プランは 100万行
 * まで許可しているので、行数に依存しない逐次比較で積む。
 */
function computeMeasure(records: AggRecord[], m: Measure): number {
  return bucketValue(collectBucket(records, m), m.kind) ?? 0;
}

/* ------------------------------ bucketing ------------------------------- */

/**
 * 集計に使うタイムゾーンは日本時間に固定する。
 *
 * 検証: 2026-08-08 07:00 JST に作られたレコードが 08/07 のバケットに入って
 * いた。ローカル時刻（getFullYear など）で日付を切っていて、デプロイ先の
 * サーバーは UTC のため、9時前に作られたレコードが丸ごと前日に落ち、今週/今月
 * の KPI も 9 時間遅れで切り替わっていた。DashDrop は日本の事業者向けで、JST は
 * 夏時間を持たない＝固定オフセットで正しく切れるため、ワークスペースごとの
 * 設定は持たずここで +09:00 に固定する。
 * （日付「フィールド」は "YYYY-MM-DD" で保存されており影響しない。影響するのは
 * createdAt を軸にしたとき＝日付列を持たないシートの既定軸。）
 */
const TZ_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC ゲッターで JST の暦要素を読むためのシフト済み Date。 */
function zoned(t: number): Date {
  return new Date(t + TZ_OFFSET_MS);
}

function startOfDayMs(t: number): number {
  return Math.floor((t + TZ_OFFSET_MS) / DAY_MS) * DAY_MS - TZ_OFFSET_MS;
}

function startOfWeekMs(t: number): number {
  const day = startOfDayMs(t);
  // 1970-01-01（epoch day 0）は木曜。0=日曜に正規化してから月曜起点にする。
  const epochDay = Math.floor((day + TZ_OFFSET_MS) / DAY_MS);
  const dow = ((((epochDay % 7) + 4) % 7) + 7) % 7;
  return day - ((dow + 6) % 7) * DAY_MS;
}

function startOfMonthMs(t: number): number {
  const z = zoned(t);
  return Date.UTC(z.getUTCFullYear(), z.getUTCMonth(), 1) - TZ_OFFSET_MS;
}

function bucketStartMs(d: Date, bucket: "day" | "week" | "month"): number {
  const t = d.getTime();
  if (bucket === "week") return startOfWeekMs(t);
  if (bucket === "month") return startOfMonthMs(t);
  return startOfDayMs(t);
}

function bucketStart(d: Date, bucket: "day" | "week" | "month"): Date {
  return new Date(bucketStartMs(d, bucket));
}

function addBucket(d: Date, bucket: "day" | "week" | "month", n: number): Date {
  if (bucket === "month") {
    const z = zoned(d.getTime());
    return new Date(
      Date.UTC(
        z.getUTCFullYear(),
        z.getUTCMonth() + n,
        z.getUTCDate(),
        z.getUTCHours(),
        z.getUTCMinutes(),
        z.getUTCSeconds(),
        z.getUTCMilliseconds(),
      ) - TZ_OFFSET_MS,
    );
  }
  // JST は夏時間を持たないので、日・週は素の加算で正しい。
  return new Date(d.getTime() + n * (bucket === "week" ? 7 : 1) * DAY_MS);
}

function bucketLabel(d: Date, bucket: "day" | "week" | "month"): string {
  const z = zoned(d.getTime());
  const mm = String(z.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(z.getUTCDate()).padStart(2, "0");
  if (bucket === "month") return `${z.getUTCFullYear()}/${mm}`;
  return `${mm}/${dd}`;
}

/* ------------------------------ 「その他」 ------------------------------- */

/**
 * 上限を超えた分をまとめる残余バケットのキー。
 *
 * 回帰: 以前は素の文字列 "その他" を番兵に使っていた。「その他」は日本語の
 * 業務データではごく普通のカテゴリ値で、DashDrop 自身のサンプルシートや
 * テンプレートも { label: "その他", value: "other" } を持っている。実データの
 * 「その他」と残余が同じキーになると、その行が二重に並び（React の key も重複）、
 * 列合計は rowKeys を舐めるので同じ行を二度足していた——同じ表の中で列合計と
 * 総計が食い違う（rowLimit:2 で colTotals [232] / grandTotal 116）。
 * U+FFFF は Unicode の非文字でテキストとしては出現し得ないため、実データの
 * どの値とも衝突しないキーとして使う。
 */
const OTHER_KEY = "\uFFFF__other__";
const OTHER_LABEL = "その他";

/**
 * 残余の表示名。実データ由来のラベルに「その他」がいるときだけ言い換える。
 * 衝突しない限り従来どおり「その他」のままにして、画面の見え方は変えない。
 */
function otherLabelFor(taken: Set<string>): string {
  if (!taken.has(OTHER_LABEL)) return OTHER_LABEL;
  const alt = `${OTHER_LABEL}（上位以外）`;
  if (!taken.has(alt)) return alt;
  // 「その他（上位以外）」まで実データに居る場合の保険。候補数は taken より
  // 多いので必ずどこかで空きが見つかる。
  for (let n = 2; n <= taken.size + 2; n++) {
    const candidate = `${OTHER_LABEL}（上位以外${n}）`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${OTHER_LABEL}（上位以外${taken.size + 3}）`;
}

/** グルーピング対象の値をバケットキー列にする（複数選択は全バケットに入る）。 */
function bucketKeys(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.length ? raw.map((v) => String(v)) : ["—"];
  }
  return [raw === null || raw === undefined || raw === "" ? "—" : String(raw)];
}

/* ------------------------------- widgets -------------------------------- */

/*
 * 色は、ここでは決めない。
 *
 * 以前はここに ["khaki","info","success","warning","danger"] の輪があり、
 * 系列や切れ端に順番で割り当てていた。名前は意味を持つ側の名前（success /
 * danger）なのに、実体は**ただの5番目までの席順**という二重の使い方に
 * なっていて、配色テーマを入れた途端に壊れた——5区分の内訳を描くと、
 * 3切れが「意味を持つ色」と見なされてテーマを無視し、藍のダッシュボードの
 * 中に緑と橙と赤が混ざった。
 *
 * 割り当てないでおけば、描く側（src/lib/palette.ts）が並び順に応じて
 * テーマの色を当てる。ここが決めるのは「何番目か」だけで良い。
 * 利用者が選択肢に付けた色（optionMeta）は、意図のある指定なので今までどおり効く。
 */

function computeKpi(w: KpiWidget, col: AggCollection, now: Date): WidgetData {
  const base = applyFilters(col.records, w.filters);
  const unit: Unit = w.unit ?? (w.measure.kind === "count" ? "number" : "number");

  if (w.rateNumerator) {
    const numer = applyFilters(base, w.rateNumerator).length;
    const denom = base.length;
    const value = denom > 0 ? Math.round((numer / denom) * 100) : 0;
    return { type: "kpi", value, unit: "percent", target: w.target };
  }

  let value = computeMeasure(base, w.measure);
  let deltaPercent: number | null | undefined = undefined;

  if (w.delta) {
    // A KPI with a delta is period-scoped: the headline value is THIS period's
    // measure (matching titles like "今週の新規…"), the chip is vs the previous.
    const bucket = w.delta.period === "month" ? "month" : "week";
    const curStart = bucketStart(now, bucket);
    const prevStart = addBucket(curStart, bucket, -1);
    const inRange = (r: AggRecord, from: Date, to: Date) => {
      const d = recordDate(r, w.delta?.dateField);
      return d ? d >= from && d < to : false;
    };
    const cur = computeMeasure(
      base.filter((r) => inRange(r, curStart, addBucket(curStart, bucket, 1))),
      w.measure,
    );
    const prev = computeMeasure(
      base.filter((r) => inRange(r, prevStart, curStart)),
      w.measure,
    );
    value = cur;
    deltaPercent =
      prev === 0 ? (cur === 0 ? 0 : 100) : Math.round(((cur - prev) / prev) * 100);
  }

  return {
    type: "kpi",
    value: round2(value),
    unit,
    deltaPercent,
    target: w.target,
  };
}

/**
 * ゲージ — 目標に対する進捗。
 *
 * 達成度の計算だけをここで済ませ、描く側には「大きいほど良い」形で渡す。
 * 「小さいほど良い」（コスト・リードタイム・不良率）の反転を各レンダラーに
 * 任せると、片方だけ直し忘れたときに**超過が達成の色で塗られる**——
 * しかも数字は合っているので、見た人は間違いに気づけない。
 */
function computeGauge(w: GaugeWidget, col: AggCollection): GaugeData {
  const base = applyFilters(col.records, w.filters);
  const value = round2(computeMeasure(base, w.measure));
  const unit: Unit = w.unit ?? "number";
  const lowerIsBetter = w.lowerIsBetter ?? false;

  /*
   * 目標が 0 のときは割り算が定義できない。0 を返すと「まったく達していない」、
   * 1 を返すと「達成」に見えるが、どちらも嘘なので null にして
   * 描く側に「達成度は出せない」と伝える。
   */
  let ratio: number | null = null;
  if (w.target !== 0) {
    ratio = lowerIsBetter ? w.target / (value || w.target) : value / w.target;
    if (!Number.isFinite(ratio)) ratio = null;
  }

  return {
    type: "gauge",
    value,
    target: w.target,
    unit,
    ratio: ratio === null ? null : round2(ratio),
    lowerIsBetter,
  };
}

/**
 * ウォーターフォール — 増減の内訳。
 *
 * 各段は「前の段の終わりから、いくつ動いたか」を表す。内訳の合計と最後の
 * 合計段が一致することが、この図の唯一の約束——ここがずれると、読んだ人は
 * 「足りない分はどこへ行ったのか」を延々と探すことになる。だから残余（その他）も
 * 必ず段として置き、畳んだ分を黙って捨てない。
 */
function computeWaterfall(w: WaterfallWidget, col: AggCollection): WaterfallData {
  const filtered = applyFilters(col.records, w.filters);
  const field = col.fields.find((f) => f.key === w.groupBy);
  const optionMeta = new Map((field?.options ?? []).map((o) => [o.value, o]));

  const groups = new Map<string, MeasureBucket>();
  for (const r of filtered) {
    const v = contributionOf(r, w.measure);
    if (v === null) continue;
    for (const k of bucketKeys(r.data[w.groupBy])) {
      let b = groups.get(k);
      if (!b) {
        b = emptyBucket();
        groups.set(k, b);
      }
      addValue(b, v);
    }
  }

  const entries = Array.from(groups.entries()).map(([key, bucket]) => ({
    key,
    label: optionMeta.get(key)?.label ?? key,
    value: round2(bucketValue(bucket, w.measure.kind) ?? 0),
  }));

  /*
   * 並び順。既定は押し上げた順（大きい順）で読めるようにする。
   * "label" は費目の定義順（選択肢の順、なければラベル順）。売上→原価→販管費の
   * ように**順序に意味がある**分解では、大きい順に並べ替えると図が壊れる。
   */
  if (w.order === "label") {
    const optionIndex = new Map(
      (field?.options ?? []).map((o, i) => [o.value, i] as const),
    );
    entries.sort((a, b) => {
      const ai = optionIndex.get(a.key);
      const bi = optionIndex.get(b.key);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.label.localeCompare(b.label, "ja");
    });
  } else {
    entries.sort((a, b) => b.value - a.value);
  }

  const overflow = entries.length > w.limit;
  const head = overflow ? entries.slice(0, w.limit - 1) : entries;
  const tail = overflow ? entries.slice(w.limit - 1) : [];

  const steps: WaterfallStep[] = [];
  let running = 0;
  const push = (
    label: string,
    value: number,
    extra: { synthetic?: boolean; key?: string } = {},
  ) => {
    const start = running;
    running = round2(running + value);
    steps.push({
      label,
      value,
      start: Math.min(start, running),
      end: Math.max(start, running),
      kind: value < 0 ? "decrease" : "increase",
      ...extra,
    });
  };

  for (const e of head) push(e.label, e.value, { key: e.key });
  if (tail.length > 0) {
    push(
      otherLabelFor(new Set(steps.map((s) => s.label))),
      round2(tail.reduce((n, e) => n + e.value, 0)),
      { synthetic: true },
    );
  }

  const total = running;
  if (w.showTotal) {
    steps.push({
      label: "合計",
      value: total,
      start: Math.min(0, total),
      end: Math.max(0, total),
      kind: "total",
      synthetic: true,
    });
  }

  return {
    type: "waterfall",
    steps,
    total,
    unit: w.unit ?? "number",
    groupBy: w.groupBy,
    collectionId: col.id,
  };
}

/** points の中で横軸が使う予約キー。系列名がこれと衝突すると軸が消える。 */
const X_KEY = "x";

/**
 * 系列の表示名を一意にする。
 *
 * 回帰: points は 1 バケット 1 オブジェクトで、系列の値は系列名をキーにして
 * 同じオブジェクトへ詰めている。ラベルが同じ measure が2つあると後勝ちで
 * 上書きされ、2本の線がまったく同じ値を描いていた。ラベルが "x" のときは
 * 横軸のキーを潰してしまい、軸ラベルが消えて measure の値がカテゴリとして
 * 並んでいた。SeriesData の series[].label はレンダラーで dataKey 兼 凡例名
 * なので、ここで一意化した名前をそのまま表示名として返す。
 */
function uniqueSeriesLabels(labels: string[]): string[] {
  const used = new Set<string>([X_KEY]);
  return labels.map((label) => {
    let candidate = label;
    for (let n = 2; used.has(candidate); n++) candidate = `${label}（${n}）`;
    used.add(candidate);
    return candidate;
  });
}

/** 区分別に割るときの既定の系列本数。これ以上は「その他」に畳む。 */
const DEFAULT_SPLIT_LIMIT = 5;

/** 1本の系列。measures そのままのときも、区分で割ったときも同じ形にそろえる。 */
interface SeriesDef {
  label: string;
  measure: Measure;
  filters?: Filter[];
  color?: string;
  as?: "bar" | "line" | "area";
  axis?: "left" | "right";
  /** 区分別のときの、この系列が受け持つ生キー。残余は OTHER_KEY。 */
  splitKey?: string;
}

/** 区分キーから系列番号を引く。残余（その他）は最後の1本が受ける。 */
function indexOfSplitKey(defs: SeriesDef[], key: string): number {
  let other = -1;
  for (let i = 0; i < defs.length; i++) {
    if (defs[i].splitKey === key) return i;
    if (defs[i].splitKey === OTHER_KEY) other = i;
  }
  return other;
}

/**
 * 系列の一覧を決める。
 *
 * `splitBy` が無ければ measures がそのまま系列。あるときは、**窓の中に入る行
 * だけ**で区分ごとの重みを数え、重い順に splitLimit 本を残す。窓の外まで
 * 数えると、画面に出ていない期間の大きさで系列が選ばれてしまう。
 */
function seriesDefs(
  w: SeriesWidget,
  col: AggCollection,
  rows: AggRecord[],
  indexOfStart: Map<number, number>,
): SeriesDef[] {
  if (!w.splitBy) {
    return w.measures.map((sm) => ({
      label: sm.label,
      measure: sm.measure,
      filters: sm.filters,
      color: sm.color,
      as: sm.as,
      axis: sm.axis,
    }));
  }

  const base = w.measures[0];
  const field = col.fields.find((f) => f.key === w.splitBy);
  const optionMeta = new Map((field?.options ?? []).map((o) => [o.value, o]));

  const weights = new Map<string, number>();
  for (const r of rows) {
    const d = recordDate(r, w.dateField);
    if (!d) continue;
    if (indexOfStart.get(bucketStartMs(d, w.bucket)) === undefined) continue;
    if (base.filters && !base.filters.every((f) => matchFilter(r, f))) continue;
    const v = contributionOf(r, base.measure);
    if (v === null) continue;
    for (const k of bucketKeys(r.data[w.splitBy])) {
      weights.set(k, (weights.get(k) ?? 0) + Math.abs(v));
    }
  }

  const ranked = Array.from(weights.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  if (ranked.length === 0) {
    // 区分の値が1つも読めなかった。指標そのものを1本だけ描くほうが、
    // 空のグラフを出すより読める。
    return [
      {
        label: base.label,
        measure: base.measure,
        filters: base.filters,
        color: base.color,
        as: base.as,
        axis: base.axis,
      },
    ];
  }

  const limit = w.splitLimit ?? DEFAULT_SPLIT_LIMIT;
  const overflow = ranked.length > limit;
  const kept = overflow ? ranked.slice(0, limit - 1) : ranked;
  const labels = kept.map((k) => optionMeta.get(k)?.label ?? k);

  const defs: SeriesDef[] = kept.map((k, i) => ({
    label: labels[i],
    measure: base.measure,
    filters: base.filters,
    color: optionMeta.get(k)?.color,
    as: base.as,
    axis: base.axis,
    splitKey: k,
  }));

  if (overflow) {
    defs.push({
      label: otherLabelFor(new Set(labels)),
      measure: base.measure,
      filters: base.filters,
      color: "neutral",
      as: base.as,
      axis: base.axis,
      splitKey: OTHER_KEY,
    });
  }
  return defs;
}

/**
 * 時系列（折れ線 / エリア / 棒）。
 *
 * 性能: 以前は「バケット × measure」ごとに全レコードを filter し直し、その
 * たびに new Date を作っていた（50,000行・60バケット・2系列で 1.3 秒、同じ
 * ウィジェット6枚で 8 秒）。レコードを1回だけ舐め、日付から所属バケットを
 * 直接引いて積む形に変える。結果は同じ。
 */
function computeSeries(w: SeriesWidget, col: AggCollection, now: Date): WidgetData {
  const bucket = w.bucket;
  const rows = applyFilters(col.records, w.filters);

  /*
   * 窓の右端と本数を決める。
   *
   * 既定は「今日まで」。ただし取り込んだ表は未来の日付を持っていることが多く
   * （完了予定日・納期・支払期日）、今日で切ると全部が窓の外に落ちる。
   * anchor: "data" のときはデータ自身の範囲に合わせ、持っている期間だけを出す。
   */
  let currentStart = bucketStart(now, bucket);
  let count = w.rangeCount;

  if (w.anchor === "data") {
    let minMs: number | null = null;
    let maxMs: number | null = null;
    for (const r of rows) {
      const d = recordDate(r, w.dateField);
      if (!d) continue;
      const ms = bucketStartMs(d, bucket);
      if (minMs === null || ms < minMs) minMs = ms;
      if (maxMs === null || ms > maxMs) maxMs = ms;
    }
    if (maxMs !== null && minMs !== null) {
      currentStart = new Date(maxMs);
      // min から max までが何バケットあるか数え、上限で頭打ちにする。
      let span = 1;
      let cursor = new Date(minMs);
      while (cursor.getTime() < maxMs && span < w.rangeCount) {
        cursor = addBucket(cursor, bucket, 1);
        span += 1;
      }
      count = Math.max(2, span);
    }
  }

  // Build the ordered list of bucket starts (oldest → newest).
  const starts: number[] = [];
  for (let i = count - 1; i >= 0; i--) {
    starts.push(addBucket(currentStart, bucket, -i).getTime());
  }
  const indexOfStart = new Map<number, number>();
  starts.forEach((ms, i) => indexOfStart.set(ms, i));

  /*
   * 系列の定義。
   *
   * 通常は measures がそのまま系列になる。`splitBy` があるときは違って、
   * 「measures[0] の指標を、区分の値ごとに1本ずつ」になる（Tableau で色に
   * ディメンションを載せたときと同じ）。合計の推移だけでは「どこが伸びたか」が
   * 分からないので、内訳を保ったまま同じ時間軸に載せる。
   */
  const defs = seriesDefs(w, col, rows, indexOfStart);
  const labels = uniqueSeriesLabels(defs.map((d) => d.label));

  // acc[バケット][系列]
  const acc: MeasureBucket[][] = starts.map(() => defs.map(() => emptyBucket()));

  for (const r of rows) {
    const d = recordDate(r, w.dateField);
    if (!d) continue;
    const bi = indexOfStart.get(bucketStartMs(d, bucket));
    if (bi === undefined) continue;

    if (w.splitBy) {
      // 区分別。1レコードが同じ系列に2回入らないようにする（複数選択の列で
      // 2つの値がどちらも残余「その他」に落ちるときに二重計上になるため）。
      const def0 = defs[0];
      if (def0.filters && !def0.filters.every((f) => matchFilter(r, f))) continue;
      const v = contributionOf(r, def0.measure);
      if (v === null) continue;
      const seen = new Set<number>();
      for (const k of bucketKeys(r.data[w.splitBy])) {
        const di = indexOfSplitKey(defs, k);
        if (di === -1 || seen.has(di)) continue;
        seen.add(di);
        addValue(acc[bi][di], v);
      }
      continue;
    }

    for (let mi = 0; mi < defs.length; mi++) {
      const sm = defs[mi];
      if (sm.filters && !sm.filters.every((f) => matchFilter(r, f))) continue;
      const v = contributionOf(r, sm.measure);
      if (v === null) continue;
      addValue(acc[bi][mi], v);
    }
  }

  const points = starts.map((ms, bi) => {
    const row: Record<string, string | number> = {
      [X_KEY]: bucketLabel(new Date(ms), bucket),
    };
    defs.forEach((sm, mi) => {
      row[labels[mi]] = round2(bucketValue(acc[bi][mi], sm.measure.kind) ?? 0);
    });
    return row;
  });

  return {
    type: w.type,
    points,
    // 区分別は積み上げが既定。1本ずつ重ねて描くと、色が重なって読めない。
    stacked: w.stacked ?? (w.splitBy ? true : undefined),
    /*
     * 100% 表示は積み上げていないと意味を持たない（1本を100%に伸ばしても
     * 常に全部が1色になる）。積み上がっているときだけ通す。
     */
    stackMode:
      (w.stacked ?? Boolean(w.splitBy)) && w.stackMode === "percent"
        ? "percent"
        : undefined,
    series: defs.map((sm, i) => ({
      label: labels[i],
      color: sm.color,
      as: sm.as,
      axis: sm.axis,
    })),
  };
}

/**
 * カテゴリ内訳（ドーナツ / 横棒）。
 *
 * 回帰: measure の種類を一切見ずに合計だけを積んでいたため、ビルダーで
 * 平均・最小・最大 を選んでも常に合計が出ていた（A に 100/200 で 平均 300、
 * 最小 300、最大 300）。クロス集計と同じ MeasureBucket に積み、取り出しだけを
 * 種類で切り替えるので、同条件の KPI タイルと必ず一致する。
 */
function computeBreakdown(w: BreakdownWidget, col: AggCollection): WidgetData {
  const filtered = applyFilters(col.records, w.filters);
  const field = col.fields.find((f) => f.key === w.groupBy);
  const optionMeta = new Map((field?.options ?? []).map((o) => [o.value, o]));

  const groups = new Map<string, MeasureBucket>();
  for (const r of filtered) {
    const v = contributionOf(r, w.measure);
    if (v === null) continue;
    for (const k of bucketKeys(r.data[w.groupBy])) {
      let b = groups.get(k);
      if (!b) {
        b = emptyBucket();
        groups.set(k, b);
      }
      addValue(b, v);
    }
  }

  const entries = Array.from(groups.entries())
    .map(([key, bucket]) => ({
      key,
      bucket,
      value: round2(bucketValue(bucket, w.measure.kind) ?? 0),
    }))
    .sort((a, b) => b.value - a.value);

  // 上限を超えた分は残余にまとめる。合計値ではなく元の値を合成するので、
  // 平均の残余は平均のまま、最小の残余は最小のままになる。
  const overflow = entries.length > w.limit;
  const head = overflow ? entries.slice(0, w.limit - 1) : entries;
  const tail = overflow ? entries.slice(w.limit - 1) : [];

  const slices: Array<{
    label: string;
    value: number;
    color?: string;
    synthetic?: boolean;
    key?: string;
  }> = head.map(
    (e) => {
      const meta = optionMeta.get(e.key);
      // `key` は絞り込み用の生キー。表示ラベルは選択肢名に置き換わるので、
      // ラベルで絞り込むと選択肢型の列で一致しなくなる。
      return {
        label: meta?.label ?? e.key,
        value: e.value,
        color: meta?.color,
        key: e.key,
      };
    },
  );

  if (tail.length > 0) {
    slices.push({
      // 実データに「その他」が居るときだけ言い換えて、残余と取り違えないようにする。
      label: otherLabelFor(new Set(slices.map((s) => s.label))),
      value: round2(bucketValue(mergeBuckets(tail.map((e) => e.bucket)), w.measure.kind) ?? 0),
      color: "neutral",
      // 合成した残余であることを構造で示す。表示側がラベル文字列で判定すると、
      // 本物の「その他」項目まで巻き添えにする。
      synthetic: true,
    });
  }

  /*
   * 表示順。
   *
   * 既定は値の大きい順（限度を超えた分を残余に畳むときも、まず大きい順に選ぶ）。
   * ファネルだけは段階の順でなければ漏斗として読めないので、選択肢型の列なら
   * 選択肢の定義順、そうでなければラベル順に並べ替える。残余は必ず最後。
   */
  const order = w.order ?? (w.type === "funnel" ? "label" : "value");
  if (order === "label") {
    const optionIndex = new Map(
      (field?.options ?? []).map((o, i) => [o.value, i] as const),
    );
    slices.sort((a, b) => {
      if (a.synthetic !== b.synthetic) return a.synthetic ? 1 : -1;
      const ai = a.key === undefined ? undefined : optionIndex.get(a.key);
      const bi = b.key === undefined ? undefined : optionIndex.get(b.key);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.label.localeCompare(b.label, "ja");
    });
  }

  return {
    type: w.type,
    slices,
    // 合計もスライスの足し算ではなく元の値から出す（平均の合計は平均ではない）。
    total: round2(
      bucketValue(mergeBuckets(entries.map((e) => e.bucket)), w.measure.kind) ?? 0,
    ),
    groupBy: w.groupBy,
    collectionId: col.id,
  };
}

/**
 * 並べ替えのための比較。全順序（推移律）を保証する。
 *
 * 回帰: 「両方数値なら引き算、それ以外は localeCompare」は推移律を満たさない。
 * 数値としては 9 < 10 なのに文字列としては "10" < "3x" < "9" なので、100 と
 * N/A が混ざった列は入力順しだいで並びが変わっていた（同じ4値で5通りの結果）。
 * 数値として読める値をすべて前に置き、読めない値はその後ろで文字列比較する。
 */
function compareValues(av: unknown, bv: unknown): number {
  const an = toNumber(av);
  const bn = toNumber(bv);
  if (an !== null && bn !== null) return an - bn;
  if (an !== null) return -1;
  if (bn !== null) return 1;
  // ロケールを固定しないと実行環境で並びが変わるため "ja" を明示する。
  return String(av ?? "").localeCompare(String(bv ?? ""), "ja");
}

function computeTable(w: TableWidget, col: AggCollection): WidgetData {
  let rows = applyFilters(col.records, w.filters).slice();
  if (w.sort) {
    const { field, dir } = w.sort;
    rows.sort((a, b) => {
      const cmp = compareValues(a.data[field], b.data[field]);
      return dir === "asc" ? cmp : -cmp;
    });
  } else {
    rows.sort((a, b) => {
      const ad = toDate(a.createdAt)?.getTime() ?? 0;
      const bd = toDate(b.createdAt)?.getTime() ?? 0;
      return bd - ad;
    });
  }
  rows = rows.slice(0, w.limit);

  const columns = w.columns.map((key) => {
    const f = col.fields.find((x) => x.key === key);
    return {
      key,
      name: f?.name ?? key,
      type: f?.type ?? "text",
      options: f?.options ?? null,
    };
  });

  return {
    type: "table",
    columns,
    rows: rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const c of w.columns) out[c] = r.data[c];
      return out;
    }),
    // 行から実レコードへ辿れるようにする。「どの案件なのか全く分からない」という
    // 指摘の直接の答えで、明細表が読むだけの箱で終わらなくなる。
    rowIds: rows.map((r) => r.id),
    collectionId: col.id,
  };
}

/**
 * Cross-tab: group down the side by `rowField`, across the top by `colField`,
 * and aggregate `measure` in each cell.
 *
 * The long tail on both axes collapses into 「その他」 so a high-cardinality
 * column can't produce a 500-wide table. Cells with no matching records stay
 * `null` (rendered as 「—」) rather than 0 — "no data" and "zero" are different
 * answers and conflating them misleads.
 */
function computePivot(
  w: PivotWidget | HeatmapWidget,
  col: AggCollection,
): WidgetData {
  const filtered = applyFilters(col.records, w.filters);
  const rowField = col.fields.find((f) => f.key === w.rowField);
  const colField = col.fields.find((f) => f.key === w.colField);
  const labelOf = (f: typeof rowField, key: string) =>
    (f?.options ?? []).find((o) => o.value === key)?.label ?? key;

  const cells = new Map<string, MeasureBucket>();
  const rowWeight = new Map<string, number>();
  const colWeight = new Map<string, number>();

  for (const r of filtered) {
    // A record with a non-numeric measure value contributes nothing at all —
    // not a zero, which would drag averages down and fake a min of 0.
    const contribution = contributionOf(r, w.measure);
    if (contribution === null) continue;
    for (const rk of bucketKeys(r.data[w.rowField])) {
      for (const ck of bucketKeys(r.data[w.colField])) {
        const k = `${rk}\u0000${ck}`;
        const cur = cells.get(k) ?? emptyBucket();
        addValue(cur, contribution);
        cells.set(k, cur);
        // Axis weight ranks which rows/columns survive the limit. Absolute
        // value, so a column of large negatives isn't ranked as the smallest.
        rowWeight.set(rk, (rowWeight.get(rk) ?? 0) + Math.abs(contribution));
        colWeight.set(ck, (colWeight.get(ck) ?? 0) + Math.abs(contribution));
      }
    }
  }

  /** 重い順に N 本だけ残し、あふれた分は残余キーにまとめる。 */
  const trim = (weights: Map<string, number>, limit: number): string[] => {
    const sorted = Array.from(weights.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    if (sorted.length <= limit) return sorted;
    return [...sorted.slice(0, limit - 1), OTHER_KEY];
  };
  const rowKeys = trim(rowWeight, w.rowLimit);
  const colKeys = trim(colWeight, w.colLimit);
  const rowSet = new Set(rowKeys);
  const colSet = new Set(colKeys);
  const bucketOf = (key: string, keep: Set<string>) =>
    keep.has(key) ? key : OTHER_KEY;

  // Re-bin into the trimmed axes, folding the tail into the remainder bucket.
  const grid = new Map<string, MeasureBucket>();
  for (const [k, v] of cells) {
    const [rk, ck] = k.split("\u0000");
    const gk = `${bucketOf(rk, rowSet)}\u0000${bucketOf(ck, colSet)}`;
    grid.set(gk, mergeBuckets([grid.get(gk), v]) ?? emptyBucket());
  }

  const value = (b: MeasureBucket | undefined): number | null => {
    const v = bucketValue(b, w.measure.kind);
    return v === null ? null : round2(v);
  };

  const matrix = rowKeys.map((rk) =>
    colKeys.map((ck) => value(grid.get(`${rk}\u0000${ck}`))),
  );
  const rowTotals = rowKeys.map(
    (rk) => value(mergeBuckets(colKeys.map((ck) => grid.get(`${rk}\u0000${ck}`)))) ?? 0,
  );
  const colTotals = colKeys.map(
    (ck) => value(mergeBuckets(rowKeys.map((rk) => grid.get(`${rk}\u0000${ck}`)))) ?? 0,
  );
  const grandTotal = value(mergeBuckets(Array.from(grid.values()))) ?? 0;

  /** 見出し。実データのラベルはそのまま、残余だけ衝突しない名前にする。 */
  const headers = (keys: string[], f: typeof rowField): string[] => {
    const real = keys.filter((k) => k !== OTHER_KEY).map((k) => labelOf(f, k));
    const other = otherLabelFor(new Set(real));
    let i = 0;
    return keys.map((k) => (k === OTHER_KEY ? other : real[i++]));
  };

  return {
    // ヒートマップはクロス集計と同じ計算で、描き方だけが違う。
    type: w.type,
    rowLabel: rowField?.name ?? w.rowField,
    colLabel: colField?.name ?? w.colField,
    rows: headers(rowKeys, rowField),
    cols: headers(colKeys, colField),
    cells: matrix,
    rowTotals,
    colTotals,
    grandTotal,
    unit: w.unit ?? "number",
    showTotals: w.showTotals,
  };
}

/* -------------------------------- 散布図 -------------------------------- */

/** 色分けの上限。これを超える区分は「その他」に畳む。 */
const SCATTER_GROUP_LIMIT = 6;

/**
 * 散布図。1行 = 1点。
 *
 * 集計するとどうしても消えるのが「外れ値」で、平均も合計も内訳もそれを均して
 * しまう。1件だけ桁違いに大きい案件があるのか、全体がなだらかなのかは、点を
 * そのまま置くのがいちばん速い。押せばその行に飛べる。
 */
function computeScatter(w: ScatterWidget, col: AggCollection): WidgetData {
  const filtered = applyFilters(col.records, w.filters);
  const nameOf = (key: string) =>
    col.fields.find((f) => f.key === key)?.name ?? key;
  const groupField = w.colorBy
    ? col.fields.find((f) => f.key === w.colorBy)
    : undefined;
  const optionMeta = new Map((groupField?.options ?? []).map((o) => [o.value, o]));

  const raw: Array<{
    x: number;
    y: number;
    z?: number;
    label: string;
    id: string;
    groupKey?: string;
  }> = [];

  for (const r of filtered) {
    const x = toNumber(r.data[w.xField]);
    const y = toNumber(r.data[w.yField]);
    // どちらか一方でも数値として読めない行は、置く場所が決まらない。
    if (x === null || y === null) continue;
    /*
     * 大きさ（バブル）。読めない行は落とさず、大きさだけ無しにする。
     * 3本目が欠けていることと、置く場所が決まらないことは別の話で、
     * ここで落とすと「金額が未入力の案件だけ図から消える」ことになる。
     */
    const z = w.sizeField ? (toNumber(r.data[w.sizeField]) ?? undefined) : undefined;
    const labelRaw = w.labelField ? r.data[w.labelField] : null;
    raw.push({
      x,
      y,
      z: z === undefined ? undefined : Math.max(0, z),
      label:
        labelRaw === null || labelRaw === undefined || labelRaw === ""
          ? ""
          : String(labelRaw),
      id: r.id,
      groupKey: w.colorBy ? bucketKeys(r.data[w.colorBy])[0] : undefined,
    });
  }

  // 色分けは種類の多い順ではなく件数の多い順。全部違う色にすると凡例が読めない。
  const counts = new Map<string, number>();
  for (const p of raw) {
    if (p.groupKey === undefined) continue;
    counts.set(p.groupKey, (counts.get(p.groupKey) ?? 0) + 1);
  }
  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  const overflow = ranked.length > SCATTER_GROUP_LIMIT;
  const kept = new Set(
    overflow ? ranked.slice(0, SCATTER_GROUP_LIMIT - 1) : ranked,
  );
  const labelOfGroup = (k: string) => optionMeta.get(k)?.label ?? k;
  const keptLabels = Array.from(kept).map(labelOfGroup);
  const otherLabel = otherLabelFor(new Set(keptLabels));

  const groups = Array.from(kept).map((k) => ({
    label: labelOfGroup(k),
    color: optionMeta.get(k)?.color,
  }));
  if (overflow) groups.push({ label: otherLabel, color: "neutral" });

  // 上限を超える分は描かない。数万点を重ねても図ではなく塗りつぶしになる。
  // 何点落としたかは返して、画面で断る。
  const shown = raw.slice(0, w.limit);

  return {
    type: "scatter",
    points: shown.map((p) => ({
      x: p.x,
      y: p.y,
      z: p.z,
      label: p.label,
      id: p.id,
      group:
        p.groupKey === undefined
          ? undefined
          : kept.has(p.groupKey)
            ? labelOfGroup(p.groupKey)
            : otherLabel,
    })),
    groups,
    xLabel: nameOf(w.xField),
    yLabel: nameOf(w.yField),
    xUnit: w.xUnit ?? "number",
    yUnit: w.yUnit ?? "number",
    sizeLabel: w.sizeField ? nameOf(w.sizeField) : undefined,
    sizeUnit: w.sizeField ? (w.sizeUnit ?? "number") : undefined,
    collectionId: col.id,
    omitted: raw.length - shown.length,
  };
}

/* ------------------------------ ヒストグラム ----------------------------- */

/**
 * 区間の幅を「読める数字」に丸める。1 / 2 / 5 × 10^n だけを使う。
 * 生の (最大-最小)/区間数 をそのまま使うと 137,428 のような幅になり、
 * 目盛りが読めなくなる。
 */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const f = raw / base;
  const mult = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return mult * base;
}

/** 区間の数の上限。丸めで増えることはあっても、増えすぎないように止める。 */
const HISTOGRAM_MAX_BINS = 40;

/**
 * ヒストグラム（度数分布）。
 *
 * 平均と合計だけでは分布が分からない。「平均1,000万」が、1,000万前後に集まって
 * いるのか、100万が9件と1億が1件なのかで打ち手はまったく違う。等間隔に区切って
 * 件数を数えるだけだが、それが分かるのはこの図しかない。
 */
function computeHistogram(w: HistogramWidget, col: AggCollection): SeriesData {
  const filtered = applyFilters(col.records, w.filters);
  const values: number[] = [];
  for (const r of filtered) {
    const v = toNumber(r.data[w.field]);
    if (v !== null) values.push(v);
  }
  const series = [{ label: "件数" }];
  if (values.length === 0) return { type: "bar", points: [], series: [] };

  const min = Math.min(...values);
  const max = Math.max(...values);
  const fmt = (n: number) =>
    w.unit === "percent" ? `${round2(n)}%` : formatCompact(n);

  // 全部同じ値なら区間を切る意味が無い。1本だけ立てる。
  if (min === max) {
    return {
      type: "bar",
      points: [{ [X_KEY]: fmt(min), 件数: values.length }],
      series,
    };
  }

  const step = niceStep((max - min) / w.bins);
  const start = Math.floor(min / step) * step;
  const binCount = Math.min(
    HISTOGRAM_MAX_BINS,
    Math.max(1, Math.ceil((max - start) / step)),
  );
  const counts = new Array<number>(binCount).fill(0);
  for (const v of values) {
    // 最大値はちょうど境界に乗ることがあるので、最後の区間に含める。
    const i = Math.min(binCount - 1, Math.floor((v - start) / step));
    counts[i >= 0 ? i : 0] += 1;
  }

  return {
    type: "bar",
    points: counts.map((c, i) => ({
      [X_KEY]: `${fmt(start + step * i)}〜`,
      件数: c,
    })),
    series,
  };
}

/**
 * Compute a single widget. Returns a null-ish empty WidgetData when the source
 * collection is missing so the renderer can show a graceful empty state.
 */
export function computeWidget(
  widget: WidgetSpec,
  collections: CollectionMap,
  now: Date = new Date(),
): WidgetData {
  const col = collections.get(widget.collection);
  if (!col) {
    // Empty fallbacks per widget type.
    switch (widget.type) {
      case "kpi":
        return { type: "kpi", value: 0, unit: "number" };
      case "line":
      case "area":
      case "bar":
      case "combo":
        return { type: widget.type, points: [], series: [] };
      case "histogram":
        return { type: "bar", points: [], series: [] };
      case "donut":
      case "hbar":
      case "treemap":
      case "funnel":
        return { type: widget.type, slices: [], total: 0 };
      case "table":
        return { type: "table", columns: [], rows: [] };
      case "gauge":
        return {
          type: "gauge",
          value: 0,
          target: widget.target,
          unit: widget.unit ?? "number",
          ratio: null,
          lowerIsBetter: widget.lowerIsBetter ?? false,
        };
      case "waterfall":
        return {
          type: "waterfall",
          steps: [],
          total: 0,
          unit: widget.unit ?? "number",
        };
      case "scatter":
        return {
          type: "scatter",
          points: [],
          groups: [],
          xLabel: "",
          yLabel: "",
          xUnit: "number",
          yUnit: "number",
          omitted: 0,
        };
      case "pivot":
      case "heatmap":
        return {
          type: widget.type,
          rowLabel: "",
          colLabel: "",
          rows: [],
          cols: [],
          cells: [],
          rowTotals: [],
          colTotals: [],
          grandTotal: 0,
          unit: "number",
          showTotals: false,
        };
    }
  }

  switch (widget.type) {
    case "kpi":
      return computeKpi(widget, col, now);
    case "line":
    case "area":
    case "bar":
    case "combo":
      return computeSeries(widget, col, now);
    case "donut":
    case "hbar":
    case "treemap":
    case "funnel":
      return computeBreakdown(widget, col);
    case "table":
      return computeTable(widget, col);
    case "pivot":
    case "heatmap":
      return computePivot(widget, col);
    case "scatter":
      return computeScatter(widget, col);
    case "histogram":
      return computeHistogram(widget, col);
    case "gauge":
      return computeGauge(widget, col);
    case "waterfall":
      return computeWaterfall(widget, col);
  }
}

/** Compute every widget in a layout, pairing each with its spec. */
export function computeDashboard(
  layout: WidgetSpec[],
  collections: CollectionMap,
  now: Date = new Date(),
): Array<{ widget: WidgetSpec; data: WidgetData }> {
  return layout.map((widget) => ({
    widget,
    data: computeWidget(widget, collections, now),
  }));
}
