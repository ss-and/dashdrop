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

  /* ------------------------------- 明細 ---------------------------------- */

  const cols = detailColumns(sheet.fields, 6);
  if (cols.length > 0) {
    out.push({
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

  return out;
}

/**
 * ファイル全体のレイアウト。
 * 先頭のシートを主役として厚く作り、残りのシートは件数と明細だけ添える。
 */
export function autoLayoutFromProfiles(sheets: ProfiledSheet[]): WidgetSpec[] {
  const usable = sheets.filter((s) => s.fields.length > 0 && s.rowCount > 0);
  if (usable.length === 0) return [];

  const out: WidgetSpec[] = layoutForSheet(usable[0], true);

  for (const sheet of usable.slice(1)) {
    const money = orderedMeasures(sheet.fields)[0];
    out.push({
      id: genWidgetId(),
      type: "kpi",
      title: `${sheet.name}の件数`,
      collection: sheet.slug,
      span: 1,
      measure: { kind: "count" },
      unit: "number",
    });
    if (money) {
      out.push({
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
      out.push({
        id: genWidgetId(),
        type: "table",
        title: `${sheet.name} 明細`,
        collection: sheet.slug,
        span: 4,
        columns: cols.map((f) => f.key),
        limit: 8,
      });
    }
  }

  return out;
}
