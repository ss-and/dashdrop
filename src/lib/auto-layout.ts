/**
 * 取り込み直後の自動ダッシュボードを組み立てる。
 *
 * 作り直した理由は、実際の営業案件Excelを入れたときの利用者の言葉:
 *   「ダッシュボードで3つしかないし、日付別の棒グラフにもなってないな」
 *   「ドリルダウンもできずに、どの案件なのかも全くわからないから使い物にならない」
 *
 * 以前の版は列名と型だけで組み立てていたので、
 *   - `案件ID` を軸にドーナツを作り（10案件が10等分された円＝情報量ゼロ）、
 *   - 値がキャッシュされていない数式列を数値列として合計し（常に 0）、
 *   - 明細表は先頭6列そのままで、案件名より前にIDが並び、
 *   - ウィジェットは実質3〜4個で終わっていた。
 *
 * ここでは **中身を数えてから**（`data-profile`）軸を決める。区分（フェーズ・
 * 担当）とランキング（顧客別）を区別し、日付列があれば必ず月次の棒グラフを置き、
 * 明細表は「どの案件か」が分かる列を先頭に出す。
 */
import { genWidgetId } from "./widget-builder";
import {
  measureFields,
  categoryFields,
  rankableFields,
  dateAxisFields,
  detailColumns,
  STATUS_NAME,
  type ProfiledField,
} from "./data-profile";
import type { WidgetSpec, Unit } from "./widgets";
import {
  DEFAULT_INTENT,
  audienceMeta,
  weightOf,
  type AudienceMeta,
  type DashboardIntent,
  type Lens,
  type WidgetRole,
} from "./dashboard-intent";

export interface ProfiledSheet {
  slug: string;
  name: string;
  rowCount: number;
  fields: ProfiledField[];
}

/** 金額らしい列を先に。名前で見当が付くならそれを優先する。 */
const MONEY_NAME = /金額|売上|価格|単価|合計|額$|収益|コスト|費用/;

/**
 * 表示単位。Excel から取り込んだ金額列は型が `number` になる（`currency` は
 * 利用者が明示したときだけ）ので、名前でも判断する。そうしないと 57,100,000 が
 * ただの数として並び、金額なのかどうかが画面から読み取れない。
 */
/**
 * 主役シートで最低限そろえる枚数。利用者の要望「ダッシュボードの数、基本8以上」。
 * 埋めるための箱は置かず、単体で読む意味のある候補だけを足していく。
 */
const MIN_WIDGETS_PER_SHEET = 8;

/*
 * 主役シートの上限は、この定数ではなく「誰が見るか」で決まるようになった
 * （src/lib/dashboard-intent.ts の AudienceMeta.maxWidgets）。既定の
 * 「チームで見る」が 15 枚で、これは以前の固定値と同じ。
 */

/**
 * ツリーマップに切り替える項目数の目安。
 * これ未満なら横棒（ランキング）の方が読みやすい。
 */
const TREEMAP_MIN_DISTINCT = 10;

const unitOf = (f?: ProfiledField): Unit =>
  f && (f.type === "currency" || MONEY_NAME.test(f.name)) ? "currency" : "number";

function orderedMeasures(fields: ProfiledField[]): ProfiledField[] {
  const ms = measureFields(fields);
  return [...ms].sort((a, b) => {
    const am = MONEY_NAME.test(a.name) ? 0 : 1;
    const bm = MONEY_NAME.test(b.name) ? 0 : 1;
    if (am !== bm) return am - bm;
    return 0;
  });
}

/**
 * 1シート分のウィジェットを組み立てる。
 * 4列グリッドなので、各行の span 合計が 4 になるように積む。
 *
 * 【ゲージを自動では置かない理由】
 * ゲージは目標があって初めて意味を持つが、**目標はExcelのどこにも書いていない**。
 * 「今の合計をきりの良い数字に切り上げる」ような推測で目標を作ると、
 * 必ず達成しているゲージが出来上がり、しかもそれらしく見えるので誰も直さない。
 * 嘘の目標に緑が点いている画面は、目標が無い画面より悪い。ビルダーから
 * 人が目標を入れたときだけ出す。
 */
function layoutForSheet(
  sheet: ProfiledSheet,
  isPrimary: boolean,
  intent: DashboardIntent,
): WidgetSpec[] {
  const S = sheet.slug;
  const out: WidgetSpec[] = [];

  const measures = orderedMeasures(sheet.fields);
  const cats = categoryFields(sheet.fields);
  const ranks = rankableFields(sheet.fields).filter(
    (f) => !cats.some((c) => c.key === f.key),
  );
  const dates = dateAxisFields(sheet.fields);
  const money = measures[0];

  /* --------------------------------- KPI --------------------------------- */

  out.push({
    id: genWidgetId(),
    type: "kpi",
    title: `${sheet.name}の件数`,
    collection: S,
    span: 1,
    measure: { kind: "count" },
    unit: "number",
  });

  if (money) {
    out.push({
      id: genWidgetId(),
      type: "kpi",
      title: `${money.name}の合計`,
      collection: S,
      span: 1,
      measure: { kind: "sum", field: money.key },
      unit: unitOf(money),
    });
    out.push({
      id: genWidgetId(),
      type: "kpi",
      title: `${money.name}の平均`,
      collection: S,
      span: 1,
      measure: { kind: "avg", field: money.key },
      unit: unitOf(money),
    });
    out.push({
      id: genWidgetId(),
      type: "kpi",
      title: `${money.name}の最大`,
      collection: S,
      span: 1,
      measure: { kind: "max", field: money.key },
      unit: unitOf(money),
    });
  } else if (measures[1]) {
    out.push({
      id: genWidgetId(),
      type: "kpi",
      title: `${measures[1].name}の合計`,
      collection: S,
      span: 1,
      measure: { kind: "sum", field: measures[1].key },
      unit: unitOf(measures[1]),
    });
  }

  /* ------------------------------- 時系列 -------------------------------- */

  // 日付列があるなら必ず出す。「日付別の棒グラフにもなってない」という指摘は、
  // 日付列があるのに月次の棒が出ていなかったこと（軸が空だった）を指している。
  if (dates[0]) {
    out.push({
      id: genWidgetId(),
      type: "bar",
      title: money
        ? `${dates[0].name}別の${money.name}`
        : `${dates[0].name}別の件数`,
      collection: S,
      span: 2,
      dateField: dates[0].key,
      bucket: "month",
      rangeCount: 24,
      // 取り込んだ表は未来の日付（完了予定日・納期）を持っていることが多い。
      // 「今日まで」で切ると棒が1本も立たないので、データの範囲に合わせる。
      anchor: "data",
      measures: [
        money
          ? { label: money.name, measure: { kind: "sum", field: money.key } }
          : { label: "件数", measure: { kind: "count" } },
      ],
    });
  }

  /*
   * 区分別の積み上げ。
   *
   * 合計の推移だけでは「増えたのは分かるが、どこが増えたのか」が分からない。
   * 同じ時間軸に区分を重ねると、内訳まで一度に読める（Tableau で色に
   * ディメンションを載せたときの図）。
   */
  if (dates[0] && cats[0]) {
    out.push({
      id: genWidgetId(),
      type: "bar",
      title: money
        ? `${dates[0].name}別の${money.name}（${cats[0].name}別）`
        : `${dates[0].name}別の件数（${cats[0].name}別）`,
      collection: S,
      span: 2,
      dateField: dates[0].key,
      bucket: "month",
      rangeCount: 24,
      anchor: "data",
      stacked: true,
      splitBy: cats[0].key,
      splitLimit: 5,
      measures: [
        money
          ? { label: money.name, measure: { kind: "sum", field: money.key } }
          : { label: "件数", measure: { kind: "count" } },
      ],
    });
  } else if (dates[0] && money) {
    /*
     * 区分が無いファイルでは、代わりに件数と金額を1枚に重ねる。単位が違うので
     * 軸を左右に分ける——同じ軸に載せると件数が金額の足元で平らになる。
     */
    out.push({
      id: genWidgetId(),
      type: "combo",
      title: `${dates[0].name}別の件数と${money.name}`,
      collection: S,
      span: 2,
      dateField: dates[0].key,
      bucket: "month",
      rangeCount: 24,
      anchor: "data",
      measures: [
        { label: "件数", measure: { kind: "count" }, as: "bar", axis: "left" },
        {
          label: money.name,
          measure: { kind: "sum", field: money.key },
          as: "line",
          axis: "right",
          color: "info",
        },
      ],
    });
  }

  /* ------------------------------ 構成比 --------------------------------- */

  if (cats[0]) {
    out.push({
      id: genWidgetId(),
      type: "donut",
      title: money ? `${cats[0].name}別の${money.name}` : `${cats[0].name}別`,
      collection: S,
      span: 2,
      groupBy: cats[0].key,
      measure: money ? { kind: "sum", field: money.key } : { kind: "count" },
      limit: 8,
    });
  }

  /*
   * ファネル。
   *
   * 「フェーズ」「ステータス」のような**段階**の列は、大きい順に並べると
   * 意味が壊れる。段階の順に上から並べて初めて「どこで落ちているか」が読める。
   * 段階らしい名前のときだけ出す（ただの分類に漏斗を当てても意味が無い）。
   */
  if (cats[0] && STATUS_NAME.test(cats[0].name)) {
    out.push({
      id: genWidgetId(),
      type: "funnel",
      title: `${cats[0].name}の段階別 件数`,
      collection: S,
      span: 2,
      groupBy: cats[0].key,
      measure: { kind: "count" },
      limit: 8,
      order: "label",
    });
  }

  if (cats[1]) {
    out.push({
      id: genWidgetId(),
      type: "hbar",
      title: money ? `${cats[1].name}別の${money.name}` : `${cats[1].name}別`,
      collection: S,
      span: 2,
      groupBy: cats[1].key,
      measure: money ? { kind: "sum", field: money.key } : { kind: "count" },
      limit: 8,
    });
  }

  /* ----------------------------- ランキング ------------------------------ */

  // 顧客名のように「全行違う」列でも、金額の上位を並べれば意味がある。
  // ドーナツには向かないが、ランキングには向く——ここを分けたのが今回の肝。
  if (ranks[0] && money) {
    out.push({
      id: genWidgetId(),
      type: "hbar",
      title: `${ranks[0].name}別の${money.name}（上位）`,
      collection: S,
      span: 2,
      groupBy: ranks[0].key,
      measure: { kind: "sum", field: money.key },
      limit: 8,
    });
  }

  /*
   * ツリーマップ。
   *
   * 顧客のように項目数が多い列は、横棒だと上位8件しか見えず「残りがどれくらい
   * あるのか」が分からない。面積なら多くの項目を同時に置けるので、ランキング
   * （誰が一番か）と構成（全体でどう分かれているか）を別々に読める。
   * 項目が少ないうちは横棒の方が読みやすいので、そのときは出さない。
   */
  if (ranks[0] && money && ranks[0].stats.distinct >= TREEMAP_MIN_DISTINCT) {
    out.push({
      id: genWidgetId(),
      type: "treemap",
      title: `${ranks[0].name}別の${money.name}（構成）`,
      collection: S,
      span: 2,
      groupBy: ranks[0].key,
      measure: { kind: "sum", field: money.key },
      limit: 12,
    });
  }

  /*
   * ヒストグラム（分布）。
   *
   * 合計と平均だけでは分布が分からない。「平均1,000万」が、1,000万前後に
   * 集まっているのか、100万が9件と1億が1件なのかで打ち手はまったく違う。
   */
  if (money) {
    out.push({
      id: genWidgetId(),
      type: "histogram",
      title: `${money.name}の分布`,
      collection: S,
      span: 2,
      field: money.key,
      bins: 10,
      unit: unitOf(money),
    });
  }

  /*
   * ウォーターフォール（増減の内訳）。
   *
   * 負の値を持つ数値列があるときだけ、中核に置く。差異・損益・増減のように
   * 上下する列は、合計や構成比では「何が押し上げ、何が引き下げたか」が
   * 出せない——プラスとマイナスが相殺されて、動いていないように見える。
   * 全部が正の列でこれを出すと、ただの積み上げランキングになるので出さない
   * （「内訳を知りたい」を選んだときだけ、下の lensExtras が足す）。
   */
  const signed = measures.find((m) => m.stats.hasNegativeNumber);
  if (signed && cats[0]) {
    out.push({
      id: genWidgetId(),
      type: "waterfall",
      title: `${cats[0].name}別の${signed.name}（増減）`,
      collection: S,
      span: 2,
      groupBy: cats[0].key,
      measure: { kind: "sum", field: signed.key },
      limit: 8,
      showTotal: true,
      unit: unitOf(signed),
    });
  }

  /*
   * 100% 積み上げ（構成比の推移）。
   *
   * 実数の積み上げと必ず対で置く。実数だけでは「全体が増えたのか、割合が
   * 動いたのか」を切り分けられない——母数が倍になれば、比率が落ちていても
   * 棒は伸びる。同じ集計の見せ方違いなので、数字が食い違うことはない。
   */
  if (dates[0] && cats[0]) {
    out.push({
      id: genWidgetId(),
      type: "bar",
      title: `${dates[0].name}別の${cats[0].name}構成比`,
      collection: S,
      span: 2,
      dateField: dates[0].key,
      bucket: "month",
      rangeCount: 24,
      anchor: "data",
      stacked: true,
      stackMode: "percent",
      splitBy: cats[0].key,
      splitLimit: 5,
      measures: [
        money
          ? { label: money.name, measure: { kind: "sum", field: money.key } }
          : { label: "件数", measure: { kind: "count" } },
      ],
    });
  }

  /*
   * ヒートマップ。3本目の区分があるときだけ。クロス集計（下）と同じ組み合わせで
   * 出すと同じ表が2枚並ぶので、別の軸を当てる。数字を1つずつ読むのではなく、
   * 濃淡で「どこが厚いか」を先に掴むための図。
   */
  if (cats[0] && cats[2]) {
    out.push({
      id: genWidgetId(),
      type: "heatmap",
      title: `${cats[0].name} × ${cats[2].name}（件数）`,
      collection: S,
      span: 4,
      rowField: cats[0].key,
      colField: cats[2].key,
      measure: { kind: "count" },
      unit: "number",
      rowLimit: 12,
      colLimit: 8,
      showTotals: true,
    });
  }

  /*
   * 散布図。数値が2本以上あるときだけ。集計すると必ず消えてしまう「外れ値」が、
   * そのまま見える唯一の図で、押せばその行まで辿れる。
   */
  if (measures[1]) {
    out.push({
      id: genWidgetId(),
      type: "scatter",
      title: `${measures[0].name} × ${measures[1].name}`,
      collection: S,
      span: 2,
      xField: measures[0].key,
      yField: measures[1].key,
      /*
       * 数値が3本以上あるなら、3本目を点の大きさに載せる（バブル）。
       * 縦横だけでは2つの量しか比べられないので、載せられるなら載せる。
       * 2本しか無いときは大きさを一定にする——何も載っていない大小があると、
       * 見る人は必ず意味を読み取ろうとする。
       */
      sizeField: measures[2]?.key,
      sizeUnit: measures[2] ? unitOf(measures[2]) : undefined,
      colorBy: cats[0]?.key,
      labelField: detailColumns(sheet.fields, 1)[0]?.key,
      limit: 500,
      xUnit: unitOf(measures[0]),
      yUnit: unitOf(measures[1]),
    });
  }

  /* ---------------------------- クロス集計 ------------------------------- */

  if (cats[0] && cats[1] && money) {
    out.push({
      id: genWidgetId(),
      type: "pivot",
      title: `${cats[0].name} × ${cats[1].name}`,
      collection: S,
      span: 4,
      rowField: cats[0].key,
      colField: cats[1].key,
      measure: { kind: "sum", field: money.key },
      unit: unitOf(money),
      rowLimit: 12,
      colLimit: 8,
      showTotals: true,
    });
  }

  /* --------------------------- 枚数を満たす ------------------------------ */

  /*
   * 「基本8枚以上」を満たすための控え。
   *
   * 列の少ないファイルだと中核だけでは3〜4枚で終わり、画面が寂しくなる。ただし
   * 枚数のために意味の無い箱を置いても仕方ないので、候補はすべて「それ単体で
   * 読む意味があるもの」に限る。足りない分だけ順に採る。
   */
  const extras: WidgetSpec[] = [];

  // 2本目以降の数値列（消費税・原価など）の合計。
  for (const m of measures.slice(1, 4)) {
    extras.push({
      id: genWidgetId(),
      type: "kpi",
      title: `${m.name}の合計`,
      collection: S,
      span: 1,
      measure: { kind: "sum", field: m.key },
      unit: unitOf(m),
    });
  }

  // 2本目の日付列（受注日に対する納期など）の推移。
  if (dates[1]) {
    extras.push({
      id: genWidgetId(),
      type: "bar",
      title: money
        ? `${dates[1].name}別の${money.name}`
        : `${dates[1].name}別の件数`,
      collection: S,
      span: 2,
      dateField: dates[1].key,
      bucket: "month",
      rangeCount: 24,
      anchor: "data",
      measures: [
        money
          ? { label: money.name, measure: { kind: "sum", field: money.key } }
          : { label: "件数", measure: { kind: "count" } },
      ],
    });
  }

  // 金額の推移とは別に、件数の推移。金額と件数は動きが違う。
  if (dates[0] && money) {
    extras.push({
      id: genWidgetId(),
      type: "bar",
      title: `${dates[0].name}別の件数`,
      collection: S,
      span: 2,
      dateField: dates[0].key,
      bucket: "month",
      rangeCount: 24,
      anchor: "data",
      measures: [{ label: "件数", measure: { kind: "count" } }],
    });
  }

  // 3本目以降の区分は件数で見る。
  for (const c of cats.slice(2, 5)) {
    extras.push({
      id: genWidgetId(),
      type: "donut",
      title: `${c.name}別の件数`,
      collection: S,
      span: 2,
      groupBy: c.key,
      measure: { kind: "count" },
      limit: 8,
    });
  }

  // 金額が無いときの構成比（件数）。
  if (!money) {
    for (const c of cats.slice(0, 2)) {
      extras.push({
        id: genWidgetId(),
        type: "hbar",
        title: `${c.name}別の件数`,
        collection: S,
        span: 2,
        groupBy: c.key,
        measure: { kind: "count" },
        limit: 8,
      });
    }
    /*
     * 件数のランキングは、値が繰り返される列でしか意味がない。全行違う列
     * （氏名・案件名）を件数で並べると、全部 1 の棒が並ぶだけ——`案件ID` の
     * ドーナツと同じ失敗になる。金額でのランキングとは条件が違う。
     */
    for (const r of ranks.filter((f) => !f.stats.idLike).slice(0, 2)) {
      extras.push({
        id: genWidgetId(),
        type: "hbar",
        title: `${r.name}別の件数（上位）`,
        collection: S,
        span: 2,
        groupBy: r.key,
        measure: { kind: "count" },
        limit: 8,
      });
    }
  }

  /*
   * 主要区分の内訳を、単独のKPIとして出す。「A: 契約完了 の件数」「その割合」は
   * 円グラフを読むより速く、列の少ない表でも成立する。枚数合わせの箱ではなく、
   * それだけ見ても意味が通る指標だけを選ぶ。
   */
  if (cats[0]) {
    const top = cats[0].stats.topValues.slice(0, 3);
    for (const v of top) {
      extras.push({
        id: genWidgetId(),
        type: "kpi",
        title: `${v.value} の件数`,
        collection: S,
        span: 1,
        measure: { kind: "count" },
        unit: "number",
        filters: [{ field: cats[0].key, op: "eq", value: v.value }],
      });
    }
    if (top[0]) {
      extras.push({
        id: genWidgetId(),
        type: "kpi",
        title: `${top[0].value} の割合`,
        collection: S,
        span: 1,
        measure: { kind: "count" },
        unit: "percent",
        rateNumerator: [{ field: cats[0].key, op: "eq", value: top[0].value }],
      });
    }
  }

  // 2本目のランキング。
  if (ranks[1] && money) {
    extras.push({
      id: genWidgetId(),
      type: "hbar",
      title: `${ranks[1].name}別の${money.name}（上位）`,
      collection: S,
      span: 2,
      groupBy: ranks[1].key,
      measure: { kind: "sum", field: money.key },
      limit: 8,
    });
  }

  // 金額が無くてもクロス集計は件数で成立する。
  if (cats[0] && cats[1] && !money) {
    extras.push({
      id: genWidgetId(),
      type: "pivot",
      title: `${cats[0].name} × ${cats[1].name}`,
      collection: S,
      span: 4,
      rowField: cats[0].key,
      colField: cats[1].key,
      measure: { kind: "count" },
      unit: "number",
      rowLimit: 12,
      colLimit: 8,
      showTotals: true,
    });
  }

  extras.push(...lensExtras(sheet, intent.lens));

  const aud = audienceMeta(intent.audience);
  const capped = selectByIntent(out, extras, intent.lens, aud);

  /* ------------------------------- 明細 ---------------------------------- */

  const cols = detailColumns(sheet.fields, 6);
  if (aud.detail && cols.length > 0) {
    capped.push({
      id: genWidgetId(),
      type: "table",
      title: `${sheet.name} 明細`,
      collection: S,
      span: 4,
      columns: cols.map((f) => f.key),
      sort: money ? { field: money.key, dir: "desc" } : undefined,
      limit: isPrimary ? 12 : 8,
    });
  }

  return capped.map((w) => restyle(w, intent.lens));
}

/* ============================ 欲しい画面に寄せる =========================== */

/**
 * 図の「役割」を、出来上がった仕様から読み取る。
 *
 * 生成する側（上の長い関数）に役割を書き足して回るのではなく、後から見て
 * 判定するようにした。追加のたびにタグを付け忘れる余地を作りたくない——
 * 付け忘れは型では検出できず、「なぜかこの図だけ選ばれない」という
 * 分かりにくい症状になる。
 *
 * 横棒だけは実際には2つの役割を兼ねている（顧客別の売上＝順位、
 * フェーズ別の件数＝構成）。ここでは順位として扱う。取り違えても
 * 重みが少しずれるだけで、間違った図が出るわけではない。
 */
function roleOf(w: WidgetSpec): WidgetRole {
  switch (w.type) {
    case "kpi":
      return "kpi";
    case "gauge":
      return "target";
    case "waterfall":
      return "delta";
    case "line":
    case "area":
    case "bar":
    case "combo":
      return w.splitBy ? "trend-split" : "trend";
    case "hbar":
      return "ranking";
    case "donut":
    case "treemap":
      return "composition";
    case "funnel":
      return "stage";
    case "pivot":
    case "heatmap":
      return "cross";
    case "scatter":
      return "relation";
    case "histogram":
      return "distribution";
    case "table":
      return "detail";
  }
}

/**
 * 候補から、この画面に載せるぶんだけを選ぶ。
 *
 * KPI は常に先頭。上段の数字は帯としてまとまって並ぶ設計（DashboardGrid）
 * なので、間に図が挟まると帯が割れて、同じ画面に細い帯が2本できる。
 *
 * 「おまかせ」は、これまでの並び（データから見て価値の高い順）をそのまま
 * 使う。視点を選んだときだけ、役割の重みで並べ替える。同点は元の順序を
 * 保つ（安定ソート）ので、同じファイルと同じ答えなら必ず同じ画面になる。
 */
function selectByIntent(
  core: WidgetSpec[],
  extras: WidgetSpec[],
  lens: Lens,
  aud: AudienceMeta,
): WidgetSpec[] {
  /*
   * 上段の数字は core と extras の両方から出る（extras 側は「2本目以降の
   * 数値列の合計」）。片方だけを数えると、重み付けの段で extras の KPI が
   * 図と同じ土俵に乗り、視点によっては KPI が10枚並んで**グラフが3枚しか
   * 残らない**という壊れ方をする。しかも並びの途中に挟まるので、
   * まとまって並ぶはずの帯が2本に割れる。数える対象は最初から1つにする。
   */
  const isKpi = (w: WidgetSpec) => w.type === "kpi";
  const kpis = [...core, ...extras].filter(isKpi).slice(0, aud.maxKpis);
  const coreRest = core.filter((w) => !isKpi(w));
  // 明細表は選抜の後に必ず足すので、その1枚ぶんを空けておく。
  const room = Math.max(1, aud.maxWidgets - kpis.length - (aud.detail ? 1 : 0));

  if (lens === "auto") {
    const merged: WidgetSpec[] = [...coreRest];
    for (const w of extras) {
      if (kpis.length + merged.length >= MIN_WIDGETS_PER_SHEET - 1) break;
      merged.push(w);
    }
    return [...kpis, ...merged.slice(0, room)];
  }

  const scored = [...coreRest, ...extras.filter((w) => !isKpi(w))].map((w, i) => ({
    w,
    i,
    score: weightOf(lens, roleOf(w)),
  }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return [...kpis, ...scored.slice(0, room).map((x) => x.w)];
}

/**
 * 視点に合わせて図の形を変える。中身（集計）は一切変えない。
 *
 * 同じ「月別の売上」でも、実績を追うなら棒——ひと月ぶんの量として読む——、
 * ばらつきを見るなら折れ線——形の変化として読む——のほうが速い。
 * どちらも同じ数字なので、間違いようがない範囲の言い換えだけを行う。
 */
function restyle(w: WidgetSpec, lens: Lens): WidgetSpec {
  if (lens === "performance" && (w.type === "line" || w.type === "area")) {
    return { ...w, type: "bar" };
  }
  if (lens === "distribution" && w.type === "bar" && !w.stacked && !w.splitBy) {
    return { ...w, type: "line" };
  }
  /*
   * 進み具合を見るときは、区分を割った棒は必ず積み上げる。
   * 横に並べると「先月と今月でどちらが多いか」を、区分ごとに目で足し算する
   * ことになる。段階の合計と内訳を同時に読みたいのが、この視点の目的。
   *
   * 今のところ生成側が既に積み上げているので、この行は保険。積んでいない
   * 区分割りの棒を後から足したときに、この視点だけは崩れないようにする。
   */
  if (lens === "pipeline" && w.type === "bar" && w.splitBy) {
    return { ...w, stacked: true };
  }
  return w;
}

/**
 * その視点でだけ欲しくなる図を足す。
 *
 * 上の生成はデータの形だけを見ているので、たとえば数値列が3本あっても
 * 分布は1本目しか描かない（普段はそれで十分で、増やすと埋め草になる）。
 * 「ばらつきを見たい」と答えた人にとっては、そこが本題なので足す。
 */
function lensExtras(sheet: ProfiledSheet, lens: Lens): WidgetSpec[] {
  const S = sheet.slug;
  const measures = orderedMeasures(sheet.fields);
  const out: WidgetSpec[] = [];

  /*
   * 「内訳を知りたい」なら、正の値しかない列でもウォーターフォールを出す。
   *
   * 全部が正だと段は上がる一方なので、増減の図というより「これらを足すと
   * 合計になる」の図になる。ドーナツと同じ問いに別の答え方をしていて、
   * 円では読み取れない**積み上がりの順序と、合計との差**が見える。
   */
  if (lens === "composition") {
    const cats = categoryFields(sheet.fields);
    /*
     * 上下する列があるときは、中核が既に増減の図を置いている。
     * ここで足すと同じ軸のウォーターフォールが2枚並ぶ——数字は正しいが、
     * 見た人は「何が違うのか」を探すことになる。
     */
    const alreadySigned = measures.some((m) => m.stats.hasNegativeNumber);
    if (cats[0] && !alreadySigned) {
      out.push({
        id: genWidgetId(),
        type: "waterfall",
        title: `${cats[0].name}別の${measures[0]?.name ?? "件数"}（積み上がり）`,
        collection: S,
        span: 2,
        groupBy: cats[0].key,
        measure: measures[0]
          ? { kind: "sum", field: measures[0].key }
          : { kind: "count" },
        limit: 8,
        showTotal: true,
        unit: measures[0] ? unitOf(measures[0]) : "number",
      });
    }
  }

  if (lens !== "distribution") return out;

  for (const m of measures.slice(1, 3)) {
    out.push({
      id: genWidgetId(),
      type: "histogram",
      title: `${m.name}の分布`,
      collection: S,
      span: 2,
      field: m.key,
      bins: 10,
      unit: unitOf(m),
    });
  }

  // 1本目 × 3本目。2本目との組み合わせは通常の生成が既に作っている。
  if (measures[2]) {
    out.push({
      id: genWidgetId(),
      type: "scatter",
      title: `${measures[0].name} × ${measures[2].name}`,
      collection: S,
      span: 2,
      xField: measures[0].key,
      yField: measures[2].key,
      colorBy: categoryFields(sheet.fields)[0]?.key,
      labelField: detailColumns(sheet.fields, 1)[0]?.key,
      limit: 500,
      xUnit: unitOf(measures[0]),
      yUnit: unitOf(measures[2]),
    });
  }
  return out;
}

/**
 * 幅2のウィジェットが1枚だけで行に取り残されないように並べ替える。
 *
 * 4カラムのグリッドで、幅2 → 幅4 と続くと、幅2の右隣が空白のまま次の行に
 * 移る。中身は正しいのに、画面には「作りかけ」に見える穴が開く。順番そのものに
 * 意味がある並び（KPIが先頭、明細が最後）は崩さず、**後ろから幅2を1枚だけ
 * 繰り上げて**穴を埋める。
 */
function packRows(widgets: WidgetSpec[]): WidgetSpec[] {
  const spanOf = (w: WidgetSpec) => Math.min(4, Math.max(1, w.span ?? 1));
  const rest = [...widgets];
  const out: WidgetSpec[] = [];

  while (rest.length > 0) {
    const row: WidgetSpec[] = [];
    let width = 0;

    // まずは順番どおりに、入るだけ入れる。
    while (rest.length > 0 && width + spanOf(rest[0]) <= 4) {
      const w = rest.shift()!;
      row.push(w);
      width += spanOf(w);
    }

    // まだ隙間があるなら、後ろからちょうど収まる1枚を繰り上げる。
    while (width < 4 && rest.length > 0) {
      const j = rest.findIndex((w) => spanOf(w) <= 4 - width);
      if (j === -1) break;
      const [w] = rest.splice(j, 1);
      row.push(w);
      width += spanOf(w);
    }

    /*
     * それでも余るなら、行の中身を広げて幅を使い切る。
     *
     * KPI だけの行は横に並ぶ帯なので、枚数で等分する（2枚なら 2+2）。
     * それ以外は、いちばん右のウィジェットに余りを足す。どちらも
     * 「右半分が空いた行」を作らないため——中身は正しいのに、穴が開いて
     * いると作りかけに見える。
     *
     * 【回帰防止】「1枚だけ残ったとき」だけを特別扱いしていたときは、金額の
     * 列が無いファイル（KPIが件数の1枚だけ）で「件数(1) + ドーナツ(2) = 3」の
     * 行が漏れていた。生成したExcel 200通りのうち166通りがこの形だった。
     */
    if (width < 4 && row.length > 0) {
      if (row.every((w) => w.type === "kpi")) {
        const base = Math.floor(4 / row.length);
        const extra = 4 % row.length;
        for (let k = 0; k < row.length; k++) {
          row[k] = { ...row[k], span: base + (k < extra ? 1 : 0) };
        }
      } else {
        const last = row.length - 1;
        row[last] = { ...row[last], span: spanOf(row[last]) + (4 - width) };
      }
    }
    out.push(...row);
  }
  return out;
}

/**
 * ファイル全体のレイアウト。
 * 先頭のシートを主役として厚く作り、残りのシートは件数と明細だけ添える。
 */
export function autoLayoutFromProfiles(
  sheets: ProfiledSheet[],
  intent: DashboardIntent = DEFAULT_INTENT,
): WidgetSpec[] {
  const usable = sheets.filter((s) => s.fields.length > 0 && s.rowCount > 0);
  if (usable.length === 0) return [];

  const out: WidgetSpec[] = packRows(layoutForSheet(usable[0], true, intent));

  for (const sheet of usable.slice(1)) {
    /*
     * 2枚目以降は「件数・金額・明細」を添える。
     *
     * 詰め直しはシートごとに行うこと。全体を一気に詰めると、後ろのシートの
     * ウィジェットが前のシートの行の隙間に繰り上がって、どのシートの数字なのかが
     * 混ざる。1シート分は必ず幅4の倍数で終わるので、そのまま連結できる。
     */
    const block: WidgetSpec[] = [];
    const money = orderedMeasures(sheet.fields)[0];
    block.push({
      id: genWidgetId(),
      type: "kpi",
      title: `${sheet.name}の件数`,
      collection: sheet.slug,
      span: 1,
      measure: { kind: "count" },
      unit: "number",
    });
    if (money) {
      block.push({
        id: genWidgetId(),
        type: "kpi",
        title: `${sheet.name}の${money.name}`,
        collection: sheet.slug,
        span: 1,
        measure: { kind: "sum", field: money.key },
        unit: unitOf(money),
      });
    }
    const cols = detailColumns(sheet.fields, 5);
    if (audienceMeta(intent.audience).detail && cols.length > 0) {
      block.push({
        id: genWidgetId(),
        type: "table",
        title: `${sheet.name} 明細`,
        collection: sheet.slug,
        span: 4,
        columns: cols.map((f) => f.key),
        limit: 8,
      });
    }
    out.push(...packRows(block));
  }

  return out;
}
