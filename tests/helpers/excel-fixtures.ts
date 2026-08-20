/**
 * Excel の「実際にあるいろいろな形」を組み立てる。
 *
 * 種（seed）から決まるので、失敗した1件だけをいつでも再現できる。テストでは
 * ないのでここには assert を置かない——作るのと確かめるのを混ぜない。
 */
import * as XLSX from "xlsx";

/* ------------------------------ 乱数（再現可能） ------------------------ */

/** mulberry32。種が同じなら必ず同じ列になる＝失敗を1件だけ再現できる。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRandom(seed: number) {
  const r = rng(seed);
  const int = (min: number, max: number) => min + Math.floor(r() * (max - min + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const chance = (p: number) => r() < p;
  return { r, int, pick, chance };
}

type Random = ReturnType<typeof makeRandom>;

/* ------------------------------ 列の作り方 ------------------------------ */

/** 印の列。1行1行を突き合わせるための、テスト専用の目印。 */
export const MARK = "行印";

/**
 * 印の値。**シート番号を含める**のが肝。
 *
 * シート名で突き合わせると、名前が衝突したときや、パーサ／ルートが名前を
 * 付け替えたとき（1枚しかないタブはファイル名になる）に、別のシートの行を
 * 見比べて落ちる。印そのものにシートを書いておけば、名前に一切依存せずに
 * 「どの行がどこへ入ったか」を追える。
 */
export function markOf(sheetIndex: number, row: number): string {
  return `S${sheetIndex}R${row}`;
}

/** 印として読める文字列か。 */
export const MARK_RE = /^S\d+R\d+$/;

type CellKind =
  | "label"
  | "category"
  | "money"
  | "count"
  | "date"
  | "empty"
  | "unique"
  | "constant"
  | "mixed"
  | "flag"
  | "email"
  | "url"
  | "percent";

export interface ColumnPlan {
  header: string;
  kind: CellKind;
  /** 書き込む生のセル値（行ごと）。 */
  cell: (i: number, rand: Random) => unknown;
  /** 期待する「読めるはずの値」。null は「空として読めればよい」。 */
  expect?: (i: number) => string | null;
  /**
   * パーサが列名を付け替える列（空欄・重複）。値の突き合わせは名前で行うので、
   * 付け替えられた列は対象から外す（外さないと、正しく動いていても落ちる）。
   */
  renamed?: boolean;
}

/** 濁点・半濁点を含む見出し。NFKD で分解されると静かに壊れる。 */
export const DAKUTEN_HEADERS = [
  "フェーズ",
  "ガイド",
  "パーセント",
  "ブランド",
  "ページビュー",
];

const LABEL_HEADERS = ["顧客名", "案件名", "商品名", "取引先", "氏名"];
const CATEGORY_HEADERS = ["ステータス", "区分", "チャネル", "分類", "部署"];
const MONEY_HEADERS = ["金額", "売上", "単価", "提案金額", "原価"];
const COUNT_HEADERS = ["数量", "件数", "個数"];
const DATE_HEADERS = ["受注日", "完了予定日", "登録日", "支払期日"];

const CATEGORIES = ["A: 契約完了", "B: 内諾あり", "C: 提案", "D: 初回", "失注"];
const CHANNELS = ["Web", "紹介", "セミナー", "既存", "アウトバウンド"];

/** 数値の書かれ方。実務のExcelは素の数値ばかりではない。 */
type NumberStyle = "raw" | "comma" | "yen" | "fullwidth";

function writeNumber(n: number, style: NumberStyle): unknown {
  switch (style) {
    case "comma":
      return n.toLocaleString("en-US");
    case "yen":
      return `¥${n.toLocaleString("en-US")}`;
    case "fullwidth":
      return String(n).replace(/[0-9]/g, (d) =>
        String.fromCharCode(d.charCodeAt(0) + 0xfee0),
      );
    default:
      return n;
  }
}

/** 日付の書かれ方。Date / 文字列 / シリアル値 が実際に混ざる。 */
type DateStyle = "date" | "iso" | "slash" | "serial";

function calendarOf(i: number): { y: number; m: number; d: number } {
  // 2026-01-05 から1日ずつ。月またぎ・年またぎを必ず含む幅にする。
  const base = Date.UTC(2026, 0, 5) + i * 86400000 * 11;
  const dt = new Date(base);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function isoOf(i: number): string {
  const { y, m, d } = calendarOf(i);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function writeDate(i: number, style: DateStyle): unknown {
  const { y, m, d } = calendarOf(i);
  switch (style) {
    case "iso":
      return isoOf(i);
    case "slash":
      return `${y}/${m}/${d}`;
    case "serial": {
      // Excel のシリアル値（1900年系）。正午にして、丸め誤差で前日に落ちない
      // ようにする——実際のファイルもこの形で入ってくる。
      const days = Math.round(
        (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000,
      );
      return days;
    }
    default:
      // ローカル時刻の正午。UTC深夜にすると JST で前日になる（実際の不具合）。
      return new Date(y, m - 1, d, 12, 0, 0);
  }
}

/* ------------------------------ 生成 ------------------------------------ */

interface SheetPlan {
  name: string;
  columns: ColumnPlan[];
  rowCount: number;
  /** 見出しの上に置く表題行。 */
  titleRows: string[][];
  /** 合計行を末尾に付けるか。 */
  totalsRow: boolean;
  /** 途中に空行を入れるか。 */
  blankRows: boolean;
  hidden: boolean;
  /** 表題行を結合するか。 */
  mergeTitle: boolean;
}

function planColumns(rand: Random, sheetIndex: number): ColumnPlan[] {
  const cols: ColumnPlan[] = [];

  // 目印は必ず先頭。これがあるので、行の増減も並べ替えも検出できる。
  cols.push({
    header: MARK,
    kind: "label",
    cell: (i) => markOf(sheetIndex, i),
    expect: (i) => markOf(sheetIndex, i),
  });

  // 名前らしい列（明細表の先頭に来るべきもの）。
  const labelHeader = rand.pick(LABEL_HEADERS);
  cols.push({
    header: labelHeader,
    kind: "label",
    cell: (i) => `${labelHeader}${i % 7}`,
    expect: (i) => `${labelHeader}${i % 7}`,
  });

  // 区分。濁点入りの見出しを混ぜる。
  const catHeader = rand.chance(0.4) ? rand.pick(DAKUTEN_HEADERS) : rand.pick(CATEGORY_HEADERS);
  const pool = rand.chance(0.5) ? CATEGORIES : CHANNELS;
  cols.push({
    header: catHeader,
    kind: "category",
    cell: (i) => pool[i % pool.length],
    expect: (i) => pool[i % pool.length],
  });

  // 金額。書き方はシートごとに固定（実際のExcelも列単位で揃っている）。
  if (rand.chance(0.85)) {
    const style: NumberStyle = rand.pick(["raw", "comma", "yen", "fullwidth"] as const);
    const header = rand.pick(MONEY_HEADERS);
    cols.push({
      header,
      kind: "money",
      cell: (i) => writeNumber((i + 1) * 1000 + (i % 3) * 250, style),
    });
  }

  // 個数。負・0・巨大値を混ぜる。
  if (rand.chance(0.5)) {
    const header = rand.pick(COUNT_HEADERS);
    cols.push({
      header,
      kind: "count",
      cell: (i) => (i % 9 === 0 ? 0 : i % 11 === 0 ? -i : i % 13 === 0 ? 1e9 + i : i + 1),
    });
  }

  // 日付。
  if (rand.chance(0.8)) {
    const style: DateStyle = rand.pick(["date", "iso", "slash", "serial"] as const);
    const header = rand.pick(DATE_HEADERS);
    cols.push({ header, kind: "date", cell: (i) => writeDate(i, style) });
  }

  // 値が一度も入らない列（キャッシュの無い数式列）。
  if (rand.chance(0.35)) {
    cols.push({ header: "見込額", kind: "empty", cell: () => "", expect: () => null });
  }

  // 全行が違う列（ID）。構成比の軸にしてはいけない。
  if (rand.chance(0.5)) {
    cols.push({
      header: rand.pick(["案件ID", "管理番号", "伝票No."]),
      kind: "unique",
      cell: (i) => `PRJ-${String(i).padStart(4, "0")}`,
      expect: (i) => `PRJ-${String(i).padStart(4, "0")}`,
    });
  }

  // 全行が同じ列。
  if (rand.chance(0.3)) {
    cols.push({ header: "会社", kind: "constant", cell: () => "自社", expect: () => "自社" });
  }

  // 数値と文字が混ざる列。実務では「未定」「-」が入る。
  if (rand.chance(0.4)) {
    cols.push({
      header: "備考",
      kind: "mixed",
      cell: (i) => (i % 4 === 0 ? "未定" : i % 4 === 1 ? "" : i % 4 === 2 ? i * 3 : "追加見積あり"),
    });
  }

  // 改行・絵文字・とても長い文字列。
  if (rand.chance(0.25)) {
    cols.push({
      header: "メモ",
      kind: "mixed",
      cell: (i) =>
        i % 3 === 0 ? "1行目\n2行目" : i % 3 === 1 ? "対応済 ✅" : "あ".repeat(300),
    });
  }

  // チェック欄。TRUE/FALSE・○×・1/0 と書き方が割れる。
  if (rand.chance(0.3)) {
    const style = rand.int(0, 2);
    cols.push({
      header: "対応済",
      kind: "flag",
      cell: (i) =>
        style === 0 ? i % 2 === 0 : style === 1 ? (i % 2 === 0 ? "TRUE" : "FALSE") : i % 2,
    });
  }

  // メールアドレス・URL。型推定が別の分岐に入る。
  if (rand.chance(0.25)) {
    cols.push({
      header: "連絡先",
      kind: "email",
      cell: (i) => `person${i}@example.co.jp`,
      expect: (i) => `person${i}@example.co.jp`,
    });
  }
  if (rand.chance(0.2)) {
    cols.push({
      header: "参考URL",
      kind: "url",
      cell: (i) => `https://example.co.jp/items/${i}`,
      expect: (i) => `https://example.co.jp/items/${i}`,
    });
  }

  // 率。「%」付きの文字列と素の小数が混ざる。
  if (rand.chance(0.25)) {
    const withSign = rand.chance(0.5);
    cols.push({
      header: "達成率",
      kind: "percent",
      cell: (i) => (withSign ? `${(i % 100) + 1}%` : ((i % 100) + 1) / 100),
    });
  }

  /*
   * 列名が空欄の列。人が作った表では珍しくない（作業列・区切り列）。
   * パーサは「列3」のような仮の名前に開く。
   */
  if (rand.chance(0.25)) {
    cols.push({
      header: "",
      kind: "mixed",
      cell: (i) => (i % 2 === 0 ? "" : `作業${i}`),
      renamed: true,
    });
  }

  /*
   * 同じ列名が2つある表。「金額」「金額」のように、上段の結合見出しを
   * 解除した表でよく起きる。パーサは「金額-2」に開く。
   */
  if (rand.chance(0.25) && cols.length > 1) {
    const dup = cols[1].header;
    cols.push({
      header: dup,
      kind: "mixed",
      cell: (i) => `${dup}補足${i}`,
      renamed: true,
    });
  }

  /*
   * 見出しの前後に空白（全角含む）。人の手入力では普通に混ざる。
   * 別の列として扱われると、同じ意味の列が2本に割れる。
   */
  if (rand.chance(0.2)) {
    cols.push({
      header: rand.chance(0.5) ? " 補足 " : "　摘要　",
      kind: "mixed",
      cell: (i) => `補足${i}`,
      renamed: true,
    });
  }

  return cols;
}

function planSheet(rand: Random, index: number): SheetPlan {
  return {
    name: rand.pick(["受注一覧", "売上台帳", "案件管理", "Sheet1", "2026年度"]) + (index ? `_${index}` : ""),
    // 1本だけの表・行が1〜2しか無い表も、実際には普通に入ってくる。
    columns: rand.chance(0.08)
      ? [{ header: "備考", kind: "mixed", cell: (i) => `メモ${i}` }]
      : planColumns(rand, index),
    rowCount: rand.chance(0.1) ? rand.int(0, 2) : rand.int(3, 40),
    titleRows: rand.chance(0.4)
      ? rand.chance(0.5)
        ? [["2026年度 売上台帳"]]
        : [["2026年度 売上台帳"], ["作成: 営業部"]]
      : [],
    totalsRow: rand.chance(0.35),
    blankRows: rand.chance(0.3),
    hidden: false,
    mergeTitle: rand.chance(0.5),
  };
}

export interface GeneratedSheet {
  plan: SheetPlan;
  /** 目印 → 期待値（列見出し → 文字列 or null）。 */
  expected: Map<string, Record<string, string | null>>;
  /** 目印 → 日付列の期待カレンダー日（YYYY-MM-DD）。 */
  expectedDates: Map<string, Record<string, string>>;
}

export function buildWorkbook(seed: number): {
  buffer: Buffer;
  sheets: GeneratedSheet[];
  hiddenNames: Set<string>;
} {
  const rand = makeRandom(seed);
  const wb = XLSX.utils.book_new();
  const sheetCount = rand.int(1, 3);
  const sheets: GeneratedSheet[] = [];
  const hiddenNames = new Set<string>();
  const usedNames = new Set<string>();

  for (let s = 0; s < sheetCount; s++) {
    const plan = planSheet(rand, s);
    while (usedNames.has(plan.name)) plan.name = `${plan.name}'`;
    usedNames.add(plan.name);

    const aoa: unknown[][] = [];
    for (const t of plan.titleRows) aoa.push([...t]);
    const headerRowIndex = aoa.length;
    aoa.push(plan.columns.map((c) => c.header));

    const expected = new Map<string, Record<string, string | null>>();
    const expectedDates = new Map<string, Record<string, string>>();

    for (let i = 0; i < plan.rowCount; i++) {
      // 途中の空行。実務のExcelには区切りとして普通に入っている。
      if (plan.blankRows && i > 0 && i % 7 === 0) aoa.push([]);

      const row = plan.columns.map((c) => c.cell(i, rand));
      aoa.push(row);

      const mark = markOf(s, i);
      const exp: Record<string, string | null> = {};
      const dates: Record<string, string> = {};
      plan.columns.forEach((c) => {
        if (c.expect) exp[c.header] = c.expect(i);
        if (c.kind === "date") dates[c.header] = isoOf(i);
      });
      expected.set(mark, exp);
      expectedDates.set(mark, dates);
    }

    if (plan.totalsRow) {
      // 「合計」だけが入り、他はほとんど空——人が付ける合計行の形。
      const row = plan.columns.map((c, ci) =>
        ci === 0 ? "合計" : c.kind === "money" ? 999999 : "",
      );
      aoa.push(row);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (plan.mergeTitle && plan.titleRows.length > 0 && plan.columns.length > 1) {
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: Math.min(2, plan.columns.length - 1) } },
      ];
    }
    XLSX.utils.book_append_sheet(wb, ws, plan.name);
    sheets.push({ plan, expected, expectedDates });
    void headerRowIndex;
  }

  // 空のタブ・非表示のタブ。既定選択から外れるべきもの。
  if (rand.chance(0.3)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), "空タブ");
  }
  if (rand.chance(0.25) && wb.SheetNames.length > 1) {
    const target = wb.SheetNames[wb.SheetNames.length - 1];
    hiddenNames.add(target);
    wb.Workbook = {
      Sheets: wb.SheetNames.map((n) => ({ name: n, Hidden: n === target ? 1 : 0 })),
    };
  }

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { buffer, sheets, hiddenNames };
}

