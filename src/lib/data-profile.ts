/**
 * 列の中身を数える。
 *
 * 自動ダッシュボードが的外れだったのは、**列名と型しか見ていなかった**から。
 * 最初に見つかった「グループ化できそうな列」を軸に選ぶので、実データでは
 * `案件ID` でドーナツを作り、10件の案件が10等分された円が出ていた。情報量ゼロ。
 * 逆に、Excelの数式列（値がキャッシュされておらず全部空）は数値列として扱われ、
 * 合計 0 のKPIが並んだ。
 *
 * どちらも「1行読めば分かる」ことなので、組み立てる前に数える。純粋関数なので
 * サーバー・クライアントどちらからでも使え、テストもしやすい。
 */
import { FIELD_TYPE_META, type FieldType } from "./field-types";

export interface FieldStats {
  /** 数えた行数。 */
  rows: number;
  /** 値が入っている行数（null・空文字を除く）。 */
  nonNull: number;
  /** 異なる値の数。 */
  distinct: number;
  /** 一度も値が入っていない。数式列でキャッシュが無いときにこうなる。 */
  empty: boolean;
  /** ほぼ全行が違う値（ID・氏名など）。構成比の軸には使えない。 */
  idLike: boolean;
  /** 数値列で、0 以外の値が1つでもあるか。合計が常に0の列を除くために使う。 */
  hasNonZeroNumber: boolean;
  /** 多い順の値（上位のみ）。軸の見当をつけるのに使う。 */
  topValues: Array<{ value: string; count: number }>;
}

/** 上位いくつまで数えるか。 */
const TOP_VALUES = 12;

/**
 * ID・コード列の名前。値が全部違うのは正しい状態なので、統計だけでは
 * 「一意な氏名」と区別が付かない。ランキング軸から外すのに名前も見る。
 */
const IDENTIFIER_NAME = /(^|[^a-zA-Z])(id|ID|Id)([^a-zA-Z]|$)|コード|番号|No\.?$/;

/** 「その行が何なのか」を人が見て分かる列の名前。明細表の先頭に置く。 */
const LABEL_NAME = /名|名称|件名|タイトル|title|name/i;

/**
 * 業務上いちばん見たい区分。種類の少なさだけで選ぶと、営業案件のExcelで
 * 「営業担当(4種)」が「フェーズ(5種)」に勝ってしまう。パイプラインを見るとき
 * 最初に欲しいのは段階別の金額なので、この手の列を優先する。
 */
const STATUS_NAME =
  /フェーズ|フェイズ|ステータス|ステージ|状態|状況|区分|段階|進捗|種別|分類|カテゴリ|stage|status|phase|state|category|type/i;

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (typeof v === "string" && v.trim() === "");
}

export function profileField(
  records: Array<Record<string, unknown>>,
  key: string,
): FieldStats {
  const counts = new Map<string, number>();
  let nonNull = 0;
  let hasNonZeroNumber = false;

  for (const r of records) {
    const v = r[key];
    if (isBlank(v)) continue;
    nonNull += 1;

    const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s¥%]/g, ""));
    if (Number.isFinite(n) && n !== 0) hasNonZeroNumber = true;

    const label = String(v);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const distinct = counts.size;
  const topValues = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_VALUES)
    .map(([value, count]) => ({ value, count }));

  return {
    rows: records.length,
    nonNull,
    distinct,
    empty: nonNull === 0,
    // 「ほぼ全行が違う」かつ十分な数がある場合だけ。3行のシートで3種類でも
    // それは一意ではなく、単に行が少ないだけ。
    idLike: nonNull >= 8 && distinct / nonNull >= 0.9,
    hasNonZeroNumber,
    topValues,
  };
}

export interface ProfiledField {
  key: string;
  name: string;
  type: string;
  stats: FieldStats;
}

export function profileFields(
  records: Array<Record<string, unknown>>,
  fields: Array<{ key: string; name: string; type: string }>,
): ProfiledField[] {
  return fields.map((f) => ({ ...f, stats: profileField(records, f.key) }));
}

/* ----------------------------- 役割の判定 ------------------------------ */

const numeric = (type: string) => FIELD_TYPE_META[type as FieldType]?.numeric === true;

/** 合計・平均に使える列（実際に値が入っているものだけ）。 */
export function measureFields(fields: ProfiledField[]): ProfiledField[] {
  return fields.filter((f) => numeric(f.type) && !f.stats.empty && f.stats.hasNonZeroNumber);
}

/**
 * 構成比（ドーナツ・クロス集計）の軸に使える列。
 * 種類が少なく、一意でなく、ほとんどの行に値があるもの。
 */
export function categoryFields(fields: ProfiledField[]): ProfiledField[] {
  return fields
    .filter((f) => !numeric(f.type) && f.type !== "date")
    .filter((f) => !f.stats.empty && !f.stats.idLike)
    .filter((f) => f.stats.distinct >= 2 && f.stats.distinct <= 12)
    .filter((f) => f.stats.nonNull / Math.max(1, f.stats.rows) >= 0.5)
    // 業務的に意味のある区分を先に。同格なら種類が少ないほど「区分」らしい。
    .sort((a, b) => {
      const ap = STATUS_NAME.test(a.name) ? 0 : 1;
      const bp = STATUS_NAME.test(b.name) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.stats.distinct - b.stats.distinct;
    });
}

/**
 * ランキング（横棒）の軸。構成比と違い、種類が多くてよい——
 * 「顧客別の金額 上位8件」は、顧客が全行で違っても意味がある。
 * ただし ID・コード列は、並べても人には読めないので外す。
 */
export function rankableFields(fields: ProfiledField[]): ProfiledField[] {
  return fields
    .filter((f) => !numeric(f.type) && f.type !== "date")
    .filter((f) => !f.stats.empty && f.stats.distinct >= 3)
    .filter((f) => !IDENTIFIER_NAME.test(f.name))
    .sort((a, b) => b.stats.distinct - a.stats.distinct);
}

/** 時系列の軸。値が入っている日付列のうち、いちばん埋まっているもの順。 */
export function dateAxisFields(fields: ProfiledField[]): ProfiledField[] {
  return fields
    .filter((f) => f.type === "date" && !f.stats.empty)
    .sort((a, b) => b.stats.nonNull - a.stats.nonNull);
}

/**
 * 明細表の列順。「どの案件か」が分かる列を先に出す。
 * 以前は先頭6列をそのまま出していたので、ID列ばかりが並ぶこともあった。
 */
export function detailColumns(fields: ProfiledField[], limit = 6): ProfiledField[] {
  const withValues = fields.filter((f) => !f.stats.empty);
  const labels = withValues.filter((f) => LABEL_NAME.test(f.name));
  const measures = withValues.filter((f) => numeric(f.type) && f.stats.hasNonZeroNumber);
  const dates = withValues.filter((f) => f.type === "date");
  const rest = withValues.filter(
    (f) => !labels.includes(f) && !measures.includes(f) && !dates.includes(f),
  );

  const ordered: ProfiledField[] = [];
  const push = (list: ProfiledField[]) => {
    for (const f of list) {
      if (ordered.length >= limit) return;
      if (!ordered.includes(f)) ordered.push(f);
    }
  };
  // 名前 → 区分 → 日付 → 金額 の順。人が表を読むときの順序。
  push(labels);
  push(rest);
  push(dates);
  push(measures);
  return ordered;
}

export { IDENTIFIER_NAME, LABEL_NAME, STATUS_NAME };
