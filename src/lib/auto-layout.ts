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

/**
 * 主役シートの上限。図の種類が増えたぶん、条件を満たすものを全部並べると
 * 20枚近くになる。多ければ良いというものでもないので、価値の高い順に並べた
 * 中核から上限までを採る（明細表は別枠で必ず最後に付く）。
 */
const MAX_WIDGETS_PER_SHEET = 15;

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
 */
function layoutForSheet(sheet: ProfiledSheet, isPrimary: boolean): WidgetSpec[] {
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

  // 明細（最後に置く）ぶんを1枚見込んで積む。
  for (const w of extras) {
    if (out.length >= MIN_WIDGETS_PER_SHEET - 1) break;
    out.push(w);
  }

  // 条件を満たすものを全部並べると多すぎる。価値の高い順に並べてあるので、
  // 上から上限までを採る。明細表はこの後に必ず付くので、1枚分空けておく。
  const capped = out.slice(0, MAX_WIDGETS_PER_SHEET - 1);

  /* ------------------------------- 明細 ---------------------------------- */

  const cols = detailColumns(sheet.fields, 6);
  if (cols.length > 0) {
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

  return capped;
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
export function autoLayoutFromProfiles(sheets: ProfiledSheet[]): WidgetSpec[] {
  const usable = sheets.filter((s) => s.fields.length > 0 && s.rowCount > 0);
  if (usable.length === 0) return [];

  const out: WidgetSpec[] = packRows(layoutForSheet(usable[0], true));

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
    if (cols.length > 0) {
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
