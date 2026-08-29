/**
 * データの整備 —「同じものが違う書き方で入っている」を見つける。
 *
 * 業務Excelで集計が合わない原因の大半はこれ。「株式会社山田商事」と
 * 「(株)山田商事」と「山田商事」が別の取引先として3行に分かれ、売上構成比の
 * 円グラフが3つのかけらになる。人は同じものだと分かっているので、
 * **グラフが間違っていることに気づけない**——数字は正しく足されているし、
 * エラーも出ない。ただ「なんとなく細かい」だけの図が出る。
 *
 * ## 直さない。見つけて、聞く
 *
 * ここは検出だけを担う。勝手に統一してはいけないからで、理由は単純に
 * **こちらには判断できない**から。「ABC」と「ABC株式会社」が同じ会社か、
 * 「田中」と「田中太郎」が同じ人かは、データを入れた人しか知らない。
 * まとめてしまえば戻せない（元の書き方が消える）が、聞けば済む。
 *
 * まとめる基準は緩く、**提案として出す**。緩くしても、実際に書き換わるのは
 * 人が選んだときだけなので害が無い。逆にここを厳しくすると、一番よくある
 * 「株式会社の有無」を拾えなくなって、機能そのものの意味が消える。
 *
 * ## なぜ AI に投げないか
 *
 * 表記ゆれは決まった規則の集まりで、規則で書けるものを毎回外に出す理由がない。
 * 加えて、この処理の入力は**取引先名と個人名の一覧そのもの**——外に出す
 * ものとして、この製品で最も出したくない類のデータになる。
 *
 * 純関数。外部依存なし。
 */

/* -------------------------------------------------------------------------- */
/* 正規化                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * まとめる段階。上から順に緩くなる。
 *
 * 段階に分けてあるのは、**なぜ同じものと見なしたかを人に説明する**ため。
 * 「まとめました」だけでは、正しいかどうかを確かめようがない。
 * 「全角と半角の違いです」と言えれば、その場で判断できる。
 */
export type VariantKind =
  /** 全角・半角の違い（ＡＢＣ / ABC、ｱｲｳ / アイウ）。 */
  | "width"
  /** ハイフン・ダッシュの種類（‐ ‑ – — ― − / -）。 */
  | "dash"
  /** 前後・途中の空白（全角空白を含む）。 */
  | "space"
  /** 大文字・小文字。 */
  | "case"
  /** 語尾の長音（サーバー / サーバ、センター / センタ）。 */
  | "longVowel"
  /** 法人格の有無（株式会社山田商事 / (株)山田商事 / 山田商事）。 */
  | "company";

export const VARIANT_KIND_LABEL: Record<VariantKind, string> = {
  width: "全角・半角",
  dash: "ハイフンの種類",
  space: "空白",
  case: "大文字・小文字",
  longVowel: "語尾の長音",
  company: "法人格の有無",
};

/**
 * ダッシュに見える文字。
 *
 * **長音記号（ー, U+30FC）は入れない。** 見た目が似ているので混ぜたくなるが、
 * これを「-」に畳むと「コーヒー」が「コ-ヒ-」になり、カタカナ語が軒並み
 * 壊れる。長音は別の段階（longVowel）で、語尾のものだけを扱う。
 */
const DASHES = /[‐‑‒–—―−﹣]/g;

/** 空白に見える文字。全角空白（U+3000）は業務Excelに普通に混ざっている。 */
const SPACES = /[\s　]+/g;

/**
 * 法人格。NFKC を通したあとの形で書く（㈱ → (株)、㈲ → (有) に畳まれている）。
 * 前に付くものと後ろに付くものの両方があるので、どちらも見る。
 */
const COMPANY_FORMS = [
  "株式会社",
  "(株)",
  "有限会社",
  "(有)",
  "合同会社",
  "合資会社",
  "合名会社",
  "一般社団法人",
  "公益社団法人",
  "一般財団法人",
  "公益財団法人",
  "特定非営利活動法人",
  "npo法人",
  "医療法人社団",
  "医療法人",
  "学校法人",
  "社会福祉法人",
  "宗教法人",
  "独立行政法人",
  "国立大学法人",
];

/** 正規化の各段階。順に適用していく。 */
const STAGES: Array<{ kind: VariantKind; apply: (s: string) => string }> = [
  { kind: "width", apply: (s) => s.normalize("NFKC") },
  { kind: "dash", apply: (s) => s.replace(DASHES, "-") },
  { kind: "space", apply: (s) => s.replace(SPACES, " ").trim() },
  { kind: "case", apply: (s) => s.toLowerCase() },
  { kind: "longVowel", apply: stripTrailingLongVowel },
  { kind: "company", apply: stripCompanyForm },
];

/**
 * 語尾の長音を落とす（サーバー → サーバ）。
 *
 * 落とすのは**末尾の1文字だけ**。途中の長音まで落とすと、上に書いた
 * 「コーヒー」問題がそのまま起きる。語尾だけなら、JIS の表記ゆれ
 * （サーバー / サーバ、センター / センタ、コンピューター / コンピュータ）を
 * 拾いつつ、語の中身は壊さない。
 */
function stripTrailingLongVowel(s: string): string {
  return s.endsWith("ー") && s.length > 1 ? s.slice(0, -1) : s;
}

/** 前後どちらかに付いている法人格を落とす。落として空になるなら落とさない。 */
function stripCompanyForm(s: string): string {
  for (const form of COMPANY_FORMS) {
    for (const stripped of [
      s.startsWith(form) ? s.slice(form.length) : null,
      s.endsWith(form) ? s.slice(0, -form.length) : null,
    ]) {
      if (stripped === null) continue;
      const t = stripped.trim();
      // 「株式会社」だけが入っている行を、空のキーにまとめてしまわない。
      if (t !== "") return t;
    }
  }
  return s;
}

/** 突き合わせ用のキー。すべての段階を通したもの。 */
export function normalizeLabel(input: string): string {
  return STAGES.reduce((s, stage) => stage.apply(s), input);
}

/* -------------------------------------------------------------------------- */
/* 表記ゆれ                                                                    */
/* -------------------------------------------------------------------------- */

export interface Variant {
  /** データに実際に入っている書き方。 */
  value: string;
  count: number;
}

export interface VariantGroup {
  /** 突き合わせに使ったキー。 */
  key: string;
  /** 書き方の一覧。件数の多い順、同数なら文字順（並びが揺れない）。 */
  variants: Variant[];
  /** 提案する統一先。一番多い書き方をそのまま使う。 */
  suggested: string;
  /** 統一したときに書き換わる行数。 */
  affected: number;
  /** なぜ同じものと見なしたか。 */
  kinds: VariantKind[];
}

/**
 * 値の一覧から、表記ゆれの群を見つける。
 *
 * 群は「書き方が2つ以上あるもの」だけを返す。1つしか無いものは
 * ゆれていないので、報告する意味がない（報告すると、直すところの無い一覧が
 * 延々と並んで、本当にゆれているものが埋もれる）。
 */
export function findVariants(values: readonly unknown[]): VariantGroup[] {
  const counts = new Map<string, Map<string, number>>();

  for (const raw of values) {
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (value === "") continue;
    const key = normalizeLabel(value);
    if (key === "") continue;
    const inner = counts.get(key) ?? new Map<string, number>();
    inner.set(value, (inner.get(value) ?? 0) + 1);
    counts.set(key, inner);
  }

  const groups: VariantGroup[] = [];
  for (const [key, inner] of counts) {
    if (inner.size < 2) continue;
    const variants = [...inner.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    const total = variants.reduce((n, v) => n + v.count, 0);
    groups.push({
      key,
      variants,
      suggested: variants[0].value,
      affected: total - variants[0].count,
      kinds: kindsFor(variants.map((v) => v.value)),
    });
  }

  // 直せる行数の多い順。効く順に並べないと、上から見て直す使い方ができない。
  return groups.sort(
    (a, b) => b.affected - a.affected || a.key.localeCompare(b.key),
  );
}

/**
 * どの段階でまとまったか。
 *
 * 段階を順に適用しながら、**書き方の種類が減った段階**を記録する。
 * 「全角・半角」と出せば人はその場で正しさを判断できるが、
 * 「まとめました」だけでは確かめようがない。
 */
function kindsFor(values: readonly string[]): VariantKind[] {
  const kinds: VariantKind[] = [];
  let current = [...values];
  let distinct = new Set(current).size;

  for (const stage of STAGES) {
    current = current.map(stage.apply);
    const next = new Set(current).size;
    if (next < distinct) kinds.push(stage.kind);
    distinct = next;
  }
  return kinds;
}

/* -------------------------------------------------------------------------- */
/* 重複行                                                                      */
/* -------------------------------------------------------------------------- */

export interface DuplicateGroup {
  /** 同じ内容だった行の id。データにあった順。 */
  ids: string[];
  /** 見比べやすいように、代表の行の中身。 */
  sample: Record<string, unknown>;
}

/**
 * 中身が完全に同じ行を見つける。
 *
 * ここは表記ゆれと違って**厳しく**する。比べるのは全項目で、1項目でも
 * 違えば別の行として残す。「取引先と日付が同じなら重複」といった当て推量は
 * しない——同じ日に同じ相手と2件取引することは普通にあるので、
 * それを重複と呼ぶと、消してはいけない行を消させることになる。
 *
 * 空白と全角・半角の違いだけは吸収する。そこまで同じなら、
 * 二重入力とみて間違いない。
 */
export function findDuplicateRows(
  records: readonly { id: string; data: Record<string, unknown> }[],
  fieldKeys: readonly string[],
): DuplicateGroup[] {
  if (fieldKeys.length === 0) return [];

  const groups = new Map<string, { ids: string[]; sample: Record<string, unknown> }>();
  for (const r of records) {
    const sig = fieldKeys
      .map((k) => {
        const v = r.data[k];
        if (v === null || v === undefined) return "";
        // 配列（複数選択）は順序の違いで別物にしない。
        if (Array.isArray(v)) {
          return v.map((x) => cellKey(x)).sort().join("");
        }
        return cellKey(v);
      })
      .join("");
    const g = groups.get(sig);
    if (g) g.ids.push(r.id);
    else groups.set(sig, { ids: [r.id], sample: r.data });
  }

  return [...groups.values()]
    .filter((g) => g.ids.length > 1)
    .map((g) => ({ ids: g.ids, sample: g.sample }));
}

/** 1つのセルの値を、比較用の文字列にする。 */
function cellKey(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return String(v.getTime());
  return String(v).normalize("NFKC").replace(SPACES, " ").trim().toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* まとめ                                                                      */
/* -------------------------------------------------------------------------- */

export interface ColumnTidy {
  fieldKey: string;
  fieldName: string;
  groups: VariantGroup[];
  /** この列で書き換わる行数の合計。 */
  affected: number;
}

export interface TidyReport {
  columns: ColumnTidy[];
  duplicates: DuplicateGroup[];
  /** 表記ゆれで書き換わる行数の合計（列をまたいだ合計）。 */
  totalAffected: number;
  /** 重複としてまとめられる行数（各群の2件目以降）。 */
  duplicateRows: number;
}

/**
 * 表記ゆれを探すのに向いた列か。
 *
 * 向かないものを外すのが目的。
 *  - ID・コード       … 全部が一意なので、ゆれようがない
 *  - 自由記述のメモ   … 1つ1つ違って当たり前で、まとめる意味がない
 *  - 選択肢が1つだけ  … ゆれる余地がない
 *
 * 「値の種類が、行数に対して少ないこと」で判断する。名前では判断しない
 * （「備考」に取引先名が入っている表は普通にある）。
 */
const MAX_DISTINCT_RATIO = 0.6;
const MIN_ROWS_TO_JUDGE = 8;

export function isTidyCandidate(values: readonly unknown[]): boolean {
  const filled = values.filter(
    (v) => v !== null && v !== undefined && String(v).trim() !== "",
  );
  if (filled.length < MIN_ROWS_TO_JUDGE) return false;
  const distinct = new Set(filled.map((v) => String(v).trim())).size;
  if (distinct < 2) return false;
  return distinct / filled.length <= MAX_DISTINCT_RATIO;
}

/** 1つの表ぶんの整備結果。 */
export function tidyReport(
  fields: readonly { key: string; name: string; type: string }[],
  records: readonly { id: string; data: Record<string, unknown> }[],
): TidyReport {
  const columns: ColumnTidy[] = [];

  for (const f of fields) {
    // 数値・日付・チェックはそもそも書き方がゆれない。
    if (f.type !== "text" && f.type !== "select" && f.type !== "longtext") {
      continue;
    }
    const values = records.map((r) => r.data[f.key]);
    if (!isTidyCandidate(values)) continue;
    const groups = findVariants(values);
    if (groups.length === 0) continue;
    columns.push({
      fieldKey: f.key,
      fieldName: f.name,
      groups,
      affected: groups.reduce((n, g) => n + g.affected, 0),
    });
  }

  columns.sort((a, b) => b.affected - a.affected || a.fieldKey.localeCompare(b.fieldKey));

  const duplicates = findDuplicateRows(
    records,
    fields.map((f) => f.key),
  );

  return {
    columns,
    duplicates,
    totalAffected: columns.reduce((n, c) => n + c.affected, 0),
    duplicateRows: duplicates.reduce((n, g) => n + g.ids.length - 1, 0),
  };
}
