/**
 * 日本の実務 Excel を読むための正規化。
 *
 * この製品の約束は「Excel を置いたらダッシュボードが出る」だが、日本の会社で
 * 実際に回っている Excel は *表* ではなく **紙の帳票が表計算に住んでいるもの**
 * であることが多い。汎用の取り込みはきれいな CSV では動いて、経理から出てくる
 * 実ファイルで壊れる。壊れ方が静かなのが最悪で、
 *
 *   - 「2026年4月1日」が日付にならず文字列のまま → 時系列グラフが作れない
 *   - 「令和6年4月1日」も同じ → 官公庁向けの資料はほぼ全部これ
 *   - 「売上（千円）」の中身をそのまま数として読む → グラフの桁が1000倍ずれる
 *   - 月が横に並んだ表 → 折れ線グラフが原理的に描けない
 *
 * のいずれも、エラーを出さずに「なんとなく変なダッシュボード」を作って終わる。
 * 利用者は何が悪いのか分からないまま離れる。
 *
 * ここに置くのは **純粋関数だけ**。Excel の読み取り（src/lib/excel.ts）にも
 * 型推論（src/lib/field-types.ts）にも依存しないので、実ファイルで見つけた癖を
 * テストだけで足していける。この層の厚みがそのまま製品の差になる。
 */

/* ========================================================================== *
 * 和暦・日本語の日付
 * ========================================================================== */

/** 元号の定義。`base + 元号年 = 西暦` になるように base を持つ。 */
interface Era {
  /** 正式名。 */
  name: string;
  /** 1文字の略記（R6.4.1 のような書き方で使われる）。 */
  initials: string[];
  /** 元号1年の前年。令和1年 = 2019 なので base は 2018。 */
  base: number;
  /** 元号が始まった西暦年。妥当性の下限に使う。 */
  startYear: number;
}

/**
 * 明治以降の元号。
 *
 * 明治より前は Excel の日付列に出てこない（出てきても西暦併記が普通）ので
 * 扱わない。当て推量で古い元号まで読むより、読めないものは読めないと
 * 言った方が安全。
 */
const ERAS: Era[] = [
  { name: "令和", initials: ["R", "r", "令"], base: 2018, startYear: 2019 },
  { name: "平成", initials: ["H", "h", "平"], base: 1988, startYear: 1989 },
  { name: "昭和", initials: ["S", "s", "昭"], base: 1925, startYear: 1926 },
  { name: "大正", initials: ["T", "t", "大"], base: 1911, startYear: 1912 },
  { name: "明治", initials: ["M", "m", "明"], base: 1867, startYear: 1868 },
];

/** 日付をどこまで特定できたか。 */
export type DatePrecision = "day" | "month" | "year" | "fiscalYear";

export interface JapaneseDate {
  /** YYYY-MM-DD。月までしか分からない場合は 01 日、年だけなら 01-01。 */
  date: string;
  precision: DatePrecision;
  /** 和暦で書かれていた場合の元号名（表示に使える）。西暦ならば null。 */
  era: string | null;
}

/** 2桁ゼロ埋め。 */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 「元年」を 1 に読み替えつつ、算用数字を取り出す。
 *
 * 元年は改元の年を指す（令和元年 = 令和1年 = 2019）。官公庁の資料では
 * 「1年」より「元年」の方がよく使われるので、これを読めないと改元年の
 * データだけが落ちる。
 */
function eraYearNumber(raw: string): number | null {
  const s = raw.trim();
  if (s === "元") return 1;
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n : null;
}

/** その月の日数（グレゴリオ暦）。 */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 年月日が実在するか。2026-02-30 のような値を弾く。 */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  if (d < 1) return false;
  return d <= daysInMonth(y, m);
}

/**
 * 日本語で書かれた日付を YYYY-MM-DD に読む。
 *
 * 読める書き方:
 *   2026年4月1日 / 2026年4月 / 2026年
 *   令和6年4月1日 / 令和6年 / 令和元年
 *   R6.4.1 / H31.4.30 / S60.1.1
 *   ２０２６年４月１日            … 全角
 *   2026年度                      … 年度は期初（4月1日）に寄せる
 *
 * 読めないものは null を返す。**当て推量で日付にしない**のがこの関数の
 * 一番大事な性質で、「4月1日」のように年が無いものや、「2026年4月1日〜
 * 2026年4月30日」のような期間表記は日付として扱わない（どちらも
 * 実ファイルによく出るが、勝手に片方に寄せると集計が静かに狂う）。
 */
export function parseJapaneseDate(input: string): JapaneseDate | null {
  // 全角の数字・記号を半角に畳む。実ファイルの日付列は全角混じりが普通で、
  // ここを畳まないと「２０２６年」だけが文字列のまま取り残される。
  const s = input.normalize("NFKC").trim();
  if (s === "") return null;

  /* ---------------------------- 年度 ---------------------------- */
  // 「2026年度」「令和6年度」。年度は4月始まりなので期初に寄せ、precision で
  // 「これは年度であって日付ではない」と申告する。表示側はこれを見て
  // 「2026年度」と出せるし、時系列に並べることもできる。
  const fiscal = /^(?:(令和|平成|昭和|大正|明治)\s*(元|\d{1,2})|(\d{4}))\s*年度$/u.exec(s);
  if (fiscal) {
    let year: number | null = null;
    let era: string | null = null;
    if (fiscal[3]) {
      year = Number(fiscal[3]);
    } else {
      const def = ERAS.find((e) => e.name === fiscal[1]);
      const ey = eraYearNumber(fiscal[2]);
      if (def && ey !== null) {
        year = def.base + ey;
        era = def.name;
      }
    }
    if (year === null || year < 1868 || year > 2200) return null;
    return { date: `${year}-04-01`, precision: "fiscalYear", era };
  }

  /* -------------------------- 和暦（漢字） -------------------------- */
  // 「令和6年4月1日」「平成31年4月」「令和元年」。元号名が入っている時点で
  // 日付である可能性が非常に高いので、年だけの形も受ける。
  const kanjiEra =
    /^(令和|平成|昭和|大正|明治)\s*(元|\d{1,2})\s*年(?:\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日?)?)?$/u.exec(s);
  if (kanjiEra) {
    const def = ERAS.find((e) => e.name === kanjiEra[1]);
    const ey = eraYearNumber(kanjiEra[2]);
    if (!def || ey === null) return null;
    const year = def.base + ey;
    // 元号の開始年より前になる組み合わせ（令和0年など）は弾く。
    // 逆に上限は見ない——改元前に書かれた資料には「平成32年度」のような
    // 表記が実在し、書いた人の意図は 2020 年で正しいため。
    if (year < def.startYear) return null;
    return finishDate(year, kanjiEra[3], kanjiEra[4], def.name);
  }

  /* -------------------------- 和暦（略記） -------------------------- */
  // 「R6.4.1」「H31/4/30」。略記は誤爆しやすい（"R6" は製品型番にもある）ので、
  // **年・月・日が揃っている形だけ**を受ける。年だけの "R6" は日付にしない。
  const abbrEra = /^([A-Za-z令平昭大明])\s*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{1,2})$/u.exec(s);
  if (abbrEra) {
    const def = ERAS.find((e) => e.initials.includes(abbrEra[1]));
    if (!def) return null;
    const year = def.base + Number(abbrEra[2]);
    if (year < def.startYear) return null;
    return finishDate(year, abbrEra[3], abbrEra[4], def.name);
  }

  /* -------------------------- 西暦（年月日） -------------------------- */
  // 「2026年4月1日」「2026年4月」「2026年」。既存の normalizeDateText が
  // 読むのは 2026/04/01 形式だけなので、日本語の帳票で一番よく使われる
  // この書き方がまるごと落ちていた。
  const jpYear = /^(\d{4})\s*年(?:\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日?)?)?$/u.exec(s);
  if (jpYear) {
    const year = Number(jpYear[1]);
    if (year < 1868 || year > 2200) return null;
    return finishDate(year, jpYear[2], jpYear[3], null);
  }

  return null;
}

/** 年・月・日の断片から JapaneseDate を組む。月日が欠けていれば precision を下げる。 */
function finishDate(
  year: number,
  monthRaw: string | undefined,
  dayRaw: string | undefined,
  era: string | null,
): JapaneseDate | null {
  if (monthRaw === undefined) {
    return { date: `${year}-01-01`, precision: "year", era };
  }
  const month = Number(monthRaw);
  if (month < 1 || month > 12) return null;

  if (dayRaw === undefined) {
    return { date: `${year}-${pad2(month)}-01`, precision: "month", era };
  }
  const day = Number(dayRaw);
  if (!isRealDate(year, month, day)) return null;
  return { date: `${year}-${pad2(month)}-${pad2(day)}`, precision: "day", era };
}

/* ========================================================================== *
 * 列名に埋まっている単位
 * ========================================================================== */

/** 列名から読み取った単位。 */
export interface ColumnUnit {
  /** 単位を取り除いた列名。「売上（千円）」→「売上」。 */
  label: string;
  /** 基本単位に直すための倍率。千円なら 1000。倍率が無い単位は 1。 */
  scale: number;
  /** 書かれていた単位そのもの。「千円」「%」「㎡」など。表示に使う。 */
  unit: string;
  /** 金額かどうか。軸の書式（¥）を決めるのに使う。 */
  currency: boolean;
}

/** 金額の基本綴りと倍率。 */
const CURRENCY_BASES: Array<[string, number]> = [
  ["兆円", 1e12],
  ["億円", 1e8],
  ["百万円", 1e6],
  ["十万円", 1e5],
  ["万円", 1e4],
  ["千円", 1e3],
  ["円", 1],
];

/**
 * 金額の綴りに実際に付く前置き・後置き。
 *
 * 経理から出てくる表は「税抜千円」「税込百万円」「千円単位」のように書く。
 * ここを知らないと、単位付きの列がまるごと単位なしとして扱われ、桁が
 * 1000倍ずれたままグラフになる。
 */
const CURRENCY_PREFIXES = ["", "税抜", "税込", "税別", "消費税抜", "消費税込"];
const CURRENCY_SUFFIXES = ["", "単位"];

/**
 * 認識する金額の綴りの全部。前置き × 基本綴り × 後置き を展開して持つ。
 *
 * 照合は **完全一致**。後方一致（`endsWith`）にすると、括弧の中が単位で
 * ないときまで単位として読んでしまう——「売上（見込千円）」の「見込」は
 * 単位ではなく区分なので、これを千円の列として扱うと、隣の「売上（実績
 * 千円）」と同じ列名「売上」に化けて衝突する。知っている綴りだけを読み、
 * 知らないものは単位なしとして元の列名のまま残すのが安全側。
 *
 * 新しい綴りを見つけたら上の3つの配列に足す。展開して持つので、足しても
 * 既存の判定は壊れない。
 */
const CURRENCY_SCALES: Array<[string, number]> = CURRENCY_PREFIXES.flatMap(
  (prefix) =>
    CURRENCY_BASES.flatMap(([base, scale]) =>
      CURRENCY_SUFFIXES.map(
        (suffix) => [`${prefix}${base}${suffix}`, scale] as [string, number],
      ),
    ),
);

/** 展開した綴りから基本綴りだけを取り出す。「税抜千円単位」→「千円」。 */
function baseSpellingOf(spelling: string): string {
  for (const [base] of CURRENCY_BASES) {
    if (spelling.includes(base)) return base;
  }
  return spelling;
}

/** 列名の末尾に付く括弧。全角・半角・角括弧・隅付き括弧まで見る。 */
const BRACKETED = /^(.*?)[\s]*[（(\[【]\s*([^（()\]）】]+?)\s*[）)\]】]\s*$/u;

/**
 * 列名に埋まっている単位を取り出す。
 *
 * 日本の帳票は単位を列名に書く。「売上（千円）」「売上高(百万円)」のように。
 * これを読まずに中身をそのまま数として扱うと、**グラフの桁が黙って 1000 倍
 * ずれる**。エラーは出ないので、金額の桁を見慣れていない人は気づけない。
 * 実際には「売上1,200」が 120万円なのか 1,200円なのかで意味がまるで違う。
 *
 * ここでは倍率を **返すだけ** で、掛けはしない。単位付きのまま表示する方が
 * 正しい場面（元の帳票と数字を突き合わせたい）と、基本単位に揃えたい場面
 * （別の列と足したい）の両方があり、決めるのは呼び出し側の仕事だから。
 *
 * 単位が見つからなければ null。「売上（前年比）」のように括弧の中が単位で
 * ないものは、単位として認識せず null を返す（列名は元のまま使う）。
 */
export function parseColumnUnit(header: string): ColumnUnit | null {
  const normalized = header.normalize("NFKC").trim();
  const m = BRACKETED.exec(normalized);
  if (!m) return null;

  const label = m[1].trim();
  const inner = m[2].trim();
  if (label === "" || inner === "") return null;

  // 金額（倍率つき）。表示に使う `unit` は "単位" を落とした綴りに揃える。
  for (const [suffix, scale] of CURRENCY_SCALES) {
    if (inner === suffix) {
      return { label, scale, unit: baseSpellingOf(suffix), currency: true };
    }
  }

  // 「単位：千円」と書く流儀。中身だけ取り出して同じ判定に掛ける。
  const explicit = /^単位\s*[:：]\s*(.+)$/u.exec(inner);
  if (explicit) {
    const nested = parseColumnUnit(`${label}（${explicit[1].trim()}）`);
    if (nested) return nested;
  }

  // 倍率を持たない単位。ここに無いものを単位と決めつけると
  // 「売上（前年比）」の「前年比」まで単位にしてしまうので、明示列挙にする。
  const PLAIN_UNITS = [
    "%", "％", "件", "人", "個", "台", "点", "回", "社", "名",
    "kg", "g", "t", "km", "m", "cm", "mm", "㎡", "m2", "坪", "l", "L",
    "時間", "分", "秒", "日", "月", "年", "%ポイント",
  ];
  if (PLAIN_UNITS.includes(inner)) {
    return { label, scale: 1, unit: inner, currency: false };
  }

  return null;
}

/* ========================================================================== *
 * 横持ち（月が列に並ぶ表）
 * ========================================================================== */

/** 見出しが表していた期間の種類。 */
export type PeriodKind = "month" | "quarter" | "year" | "yearMonth";

export interface WideLayout {
  /** 左側の、そのまま残す列（部門名・担当者名など）。 */
  idColumns: string[];
  /** 期間を表している列（「4月」「5月」…）。 */
  periodColumns: string[];
  periodKind: PeriodKind;
  /** 縦持ちにしたときの期間列の名前。「月」「四半期」など。 */
  periodLabel: string;
}

/** 「4月」「04月」「4」（月の文脈）。 */
const MONTH_RE = /^(\d{1,2})\s*月$/u;
/** 「Q1」「第1四半期」「1Q」。 */
const QUARTER_RE = /^(?:Q\s*([1-4])|([1-4])\s*Q|第\s*([1-4])\s*四半期)$/iu;
/** 「2026年」「2026年度」「FY2026」。 */
const YEAR_RE = /^(?:FY\s*)?(\d{4})\s*年?度?$/iu;
/** 「2026年4月」「2026/04」「2026-04」。 */
const YEAR_MONTH_RE = /^(\d{4})\s*[年/\-.]\s*(\d{1,2})\s*月?$/u;

/** 見出し1つが、どの期間の種類に見えるか。 */
function periodKindOf(header: string): PeriodKind | null {
  const s = header.normalize("NFKC").trim();
  if (s === "") return null;
  if (YEAR_MONTH_RE.test(s)) return "yearMonth";
  if (MONTH_RE.test(s)) return "month";
  if (QUARTER_RE.test(s)) return "quarter";
  if (YEAR_RE.test(s)) return "year";
  return null;
}

const PERIOD_LABEL: Record<PeriodKind, string> = {
  month: "月",
  quarter: "四半期",
  year: "年",
  yearMonth: "年月",
};

/**
 * 横持ちの表を見つける。
 *
 * 日本の業務 Excel の標準形はこれ:
 *
 *     部門     4月    5月    6月
 *     営業部   120    135    150
 *     開発部    80     90     85
 *
 * この形のままでは **折れ線グラフが原理的に描けない**。時間が行ではなく列に
 * 入っているので、集計エンジンから見ると「4月」「5月」は別々の指標であって、
 * 同じ指標の推移ではないからだ。取り込んだ人には「なぜか月ごとのグラフが
 * 出ない」としか見えない。
 *
 * 判定は保守的に:
 *   - 右側に **3列以上** 連続して同じ種類の期間見出しが並んでいること
 *     （2列だと「前年」「今年」のような比較列と区別が付かない）
 *   - 左側に **1列以上** の非期間列が残ること（全部が期間なら、それは
 *     そもそも1行しかない集計表で、縦持ちにする意味がない）
 *   - 期間列の中身が数値であること（後段で確認する）
 *
 * 見つからなければ null。**勝手に変換はしない**——検出を返すだけで、
 * 実際に縦にするかどうかは利用者に聞く。
 */
export function detectWideLayout(headers: string[]): WideLayout | null {
  if (headers.length < 4) return null;

  // 右端から遡って、同じ種類の期間見出しが何列続くかを数える。
  // 先頭から探すと「月次報告書（2026年）」のようなタイトル列を拾ってしまう。
  const lastKind = periodKindOf(headers[headers.length - 1]);
  if (lastKind === null) return null;

  let start = headers.length;
  while (start - 1 >= 0 && periodKindOf(headers[start - 1]) === lastKind) {
    start -= 1;
  }

  const periodColumns = headers.slice(start);
  const idColumns = headers.slice(0, start);

  if (periodColumns.length < 3) return null;
  if (idColumns.length < 1) return null;

  return {
    idColumns,
    periodColumns,
    periodKind: lastKind,
    periodLabel: PERIOD_LABEL[lastKind],
  };
}

/** 縦持ちに直した結果。 */
export interface UnpivotResult {
  headers: string[];
  rows: unknown[][];
  /** 値が空だったために落とした組み合わせの数。申告用。 */
  skipped: number;
}

/**
 * 横持ちを縦持ちに直す。
 *
 *     部門     4月   5月          部門    月    値
 *     営業部   120   135    →     営業部  4月   120
 *                                 営業部  5月   135
 *
 * 空セルは行にしない（`skipped` で申告する）。まだ数字が入っていない先の月まで
 * 0 として並べると、折れ線が月末に向かって崖のように落ちる絵になるため。
 * この製品は「打ち切りを黙って行わない」を徹底しているので、ここでも
 * 落とした数は必ず返して呼び出し側から見えるようにする。
 *
 * `valueLabel` は値列の名前。元の表に単位が書いてあれば（「売上（千円）」）
 * それを渡すと、縦持ちにしても単位が失われない。
 */
export function unpivot(
  headers: string[],
  rows: unknown[][],
  layout: WideLayout,
  valueLabel = "値",
): UnpivotResult {
  const indexOf = new Map(headers.map((h, i) => [h, i]));
  const idIdx = layout.idColumns.map((h) => indexOf.get(h) ?? -1);
  const periodIdx = layout.periodColumns.map((h) => indexOf.get(h) ?? -1);

  const out: unknown[][] = [];
  let skipped = 0;

  for (const row of rows) {
    const idValues = idIdx.map((i) => (i >= 0 ? (row[i] ?? null) : null));
    for (let p = 0; p < periodIdx.length; p++) {
      const i = periodIdx[p];
      const value = i >= 0 ? (row[i] ?? null) : null;
      if (value === null || value === "") {
        skipped += 1;
        continue;
      }
      out.push([...idValues, layout.periodColumns[p], value]);
    }
  }

  return {
    headers: [...layout.idColumns, layout.periodLabel, valueLabel],
    rows: out,
    skipped,
  };
}
