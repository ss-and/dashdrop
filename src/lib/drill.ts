/**
 * ドリルダウン — グラフのひと切れから、その裏の行へ。
 *
 * この製品が Looker Studio や Power BI と決定的に違うのは、**行データが自分の
 * ところにある**こと。あちらは集計結果しか持っていないので、棒グラフの棒から
 * 元の行に戻ることが原理的にできない。こちらはできる——ダッシュボード →
 * グラフのひと切れ → その裏の行 → レコード詳細 → 関連レコード、と辿れる。
 * これが最大の差別化なので、ここが静かに壊れていると製品の芯が抜ける。
 *
 * ## なぜ専用のモジュールが要るのか
 *
 * 以前は各ウィジェットがURLを手で組み立てていて、**3種類の書き方が並立して
 * いた**:
 *   - `?f=部門&v=営業部`   … 受け側が読む唯一の形（BreakdownChart）
 *   - `?f_部門=営業部`     … 受け側がまったく読まない（箱ひげ・ウォーター
 *                            フォール・日本地図）。遷移はするので、**絞り込ま
 *                            れていない全件の表が、何の説明も無く開く**
 * どこにも共通の型が無いので、この食い違いはコンパイルでも実行時でも
 * 検出されなかった。1か所に集めて、URLの形を型で縛る。
 *
 * ## 突き合わせの規則は集計側（bucketKeys）と必ず一致させること
 *
 * グラフのグループ分けは `src/lib/aggregate.ts` の `bucketKeys()` が決める。
 * ここでの絞り込みがその規則とずれると、「グラフは37件と言っているのに表は
 * 0件」という、いちばん信用を失う壊れ方をする。とくに:
 *   - 空・null・"" は「—」という1つのグループになる（値ではない）
 *   - 複数選択（配列）は **要素ごとに全バケットへ入る**。配列全体を String()
 *     して比べると絶対に一致しない
 * この2つは専用の演算子（empty / has）で表す。
 */
import { z } from "zod";
import { isComputedField } from "./field-types";

/** 空グループの表示キー。`bucketKeys()`（aggregate.ts）と必ず同じ字にすること。 */
export const EMPTY_BUCKET = "—";

/* ========================================================================== *
 * URL の形
 * ========================================================================== */

/**
 * 絞り込み条件1つ。URL の `?d=` 1個 = これ1つ。
 *
 * 条件を1個ずつ独立した `d` に入れるのは、**1つずつ外せる**ようにするため。
 * 1つのパラメータに詰め込むと、解除のたびに全体を組み直すことになり、
 * チップの ✕ が「その条件だけ抜いたURL」を指せない。
 *
 * `label` は画面表示用の言い換え（選択肢の表示名など）。無ければ受け側が
 * 項目定義から組み立てるので、**省略しても壊れない**。URLは信用できない
 * 入力なので、意味に関わる判断（計算列かどうか等）は絶対にここに入れず、
 * サーバ側で項目定義から導出する。
 */
const drillFilterVariants = z.discriminatedUnion("op", [
  /** 単一値。表示ラベルではなく **生キー** で突き合わせる。 */
  z.object({
    op: z.literal("eq"),
    field: z.string().min(1).max(120),
    value: z.string().max(400),
    label: z.string().max(120).optional(),
  }),
  /**
   * 複数選択の列。`bucketKeys()` が配列を要素ごとに展開するので、配列列に
   * eq を使うと必ず0件になる（実際にそうなっていた）。要素として含むか、で見る。
   */
  z.object({
    op: z.literal("has"),
    field: z.string().min(1).max(120),
    value: z.string().max(400),
    label: z.string().max(120).optional(),
  }),
  /** 空・null・"" のグループ（`bucketKeys()` が「—」にまとめるもの）。 */
  z.object({
    op: z.literal("empty"),
    field: z.string().min(1).max(120),
  }),
  /**
   * 「その他」に畳まれたグループ。上位N件から漏れた複数のキーをまとめて指す。
   * 集計側が残余のキー一覧を出すようになるまでは使われないが、URLの形として
   * 先に用意しておく（後から足すとURLの互換を壊すため）。
   */
  z.object({
    op: z.literal("in"),
    field: z.string().min(1).max(120),
    values: z.array(z.string().max(400)).min(1).max(64),
    label: z.string().max(120).optional(),
  }),
  /**
   * 日付のバケット。**表示ラベルでは持てない**——日次・週次のラベルは
   * 「04/28」のように年が落ちており、そこから範囲を復元できないため。
   * epoch ミリ秒の半開区間 [from, to) で持つ。
   */
  z.object({
    op: z.literal("range"),
    field: z.string().min(1).max(120),
    from: z.number().int(),
    to: z.number().int(),
    label: z.string().max(120).optional(),
  }),
]);

/*
 * 範囲の妥当性は共用体の外で見る。zod の判別共用体は枝に .refine を付けた
 * 形（ZodEffects）を受け付けないため、枝は素の object のままにして、
 * union 全体に条件を掛ける。
 *
 * from === to を弾くのは、半開区間 [from, to) だと必ず0件になるから。
 * 「押したのに何も出ない」を、条件が読めなかった扱いにして捨てる方が良い。
 */
export const drillFilterSchema = drillFilterVariants.refine(
  (f) => f.op !== "range" || f.to > f.from,
  { message: "終了は開始より後である必要があります" },
);

export type DrillFilter = z.infer<typeof drillFilterVariants>;

/** 1画面に許す条件の数。多すぎるURLは共有時に壊れるので上限を置く。 */
export const MAX_DRILL_FILTERS = 8;

/** 条件1つをURLに載せる形にする。 */
export function serializeDrill(filter: DrillFilter): string {
  return JSON.stringify(filter);
}

/**
 * `?d=` の生文字列から条件を組み立てる。
 *
 * **壊れた条件は黙って捨てる。** URLは利用者が編集できるし、共有されたURLは
 * 列が消された後に開かれることもある。1つ壊れているだけで画面ごとエラーに
 * するより、読めた条件で表を出して、何で絞られているかをチップで見せる方が
 * 使える。捨てた事実は呼び出し側が `dropped` で受け取れる。
 */
export function parseDrill(raw: string[] | undefined): {
  filters: DrillFilter[];
  dropped: number;
} {
  if (!raw || raw.length === 0) return { filters: [], dropped: 0 };
  const filters: DrillFilter[] = [];
  let dropped = 0;
  for (const s of raw) {
    if (filters.length >= MAX_DRILL_FILTERS) {
      dropped += 1;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      dropped += 1;
      continue;
    }
    const result = drillFilterSchema.safeParse(parsed);
    if (result.success) filters.push(result.data);
    else dropped += 1;
  }
  return { filters, dropped };
}

/**
 * 旧い `?f=&v=` 形式を1つの eq として読む。
 *
 * すでに共有されたURLと、まだ直していないウィジェットのために残す。新しい
 * 形式と混ざっても良いように、条件の配列として返す。
 */
export function parseLegacyDrill(
  field: string | undefined,
  value: string | undefined,
): DrillFilter[] {
  if (!field || value === undefined) return [];
  return [{ op: "eq", field, value }];
}

/** 条件の並びから、表の画面へのリンクを組む。 */
export function drillHref(collectionId: string, filters: DrillFilter[]): string {
  if (filters.length === 0) return `/c/${collectionId}`;
  const params = new URLSearchParams();
  for (const f of filters.slice(0, MAX_DRILL_FILTERS)) {
    params.append("d", serializeDrill(f));
  }
  return `/c/${collectionId}?${params.toString()}`;
}

/** 条件を1つ外したリンク（チップの ✕ 用）。 */
export function drillHrefWithout(
  collectionId: string,
  filters: DrillFilter[],
  index: number,
): string {
  return drillHref(
    collectionId,
    filters.filter((_, i) => i !== index),
  );
}

/* ========================================================================== *
 * 突き合わせ
 * ========================================================================== */

/**
 * 1つの値を、集計側と同じ規則でバケットキーに直す。
 * `src/lib/aggregate.ts` の `bucketKeys()` と**同じ振る舞いでなければならない**。
 */
export function drillBucketKeys(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.length ? raw.map((v) => String(v)) : [EMPTY_BUCKET];
  }
  return [
    raw === null || raw === undefined || raw === "" ? EMPTY_BUCKET : String(raw),
  ];
}

/** 日付らしき値を epoch ミリ秒にする。読めなければ null。 */
function toMillis(raw: unknown): number | null {
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s === "") return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** 値1つが条件に当てはまるか。 */
export function matchesFilter(raw: unknown, filter: DrillFilter): boolean {
  switch (filter.op) {
    case "empty":
      return drillBucketKeys(raw).includes(EMPTY_BUCKET);
    case "eq": {
      // 配列は has で扱う。eq で配列に当てると、集計側の数と食い違う。
      if (Array.isArray(raw)) return false;
      const keys = drillBucketKeys(raw);
      return keys.length === 1 && keys[0] === filter.value;
    }
    case "has":
      return drillBucketKeys(raw).includes(filter.value);
    case "in": {
      const keys = drillBucketKeys(raw);
      return filter.values.some((v) => keys.includes(v));
    }
    case "range": {
      const ms = toMillis(raw);
      if (ms === null) return false;
      // 半開区間 [from, to)。境界の行が隣の月にも数えられないようにする。
      return ms >= filter.from && ms < filter.to;
    }
  }
}

/**
 * 1行が、すべての条件に当てはまるか（AND）。
 *
 * `lookup` は項目キーから値を引く関数。計算列（数式・ルックアップ・
 * ロールアップ）は保存されておらず読み取り時に評価されるため、生の `data`
 * だけを見ると**必ず0件になる**（実際にそうなっていた）。呼び出し側が
 * `data` と `computed` の両方を見る関数を渡すこと。
 */
export function recordMatchesDrill(
  lookup: (fieldKey: string) => unknown,
  filters: DrillFilter[],
): boolean {
  return filters.every((f) => matchesFilter(lookup(f.field), f));
}

/* ========================================================================== *
 * 日本語の表示
 * ========================================================================== */

/** 日付の範囲を、粒度に合わせた日本語にする。 */
function rangeLabel(from: number, to: number): string {
  const start = new Date(from);
  const end = new Date(to);
  const y = start.getFullYear();
  const m = start.getMonth() + 1;
  const d = start.getDate();
  const days = (to - from) / 86_400_000;

  // ちょうど1年（うるう年を含む幅）で、1月1日始まり。
  if (start.getMonth() === 0 && d === 1 && end.getFullYear() === y + 1) {
    return `${y}年`;
  }
  // 月の頭から翌月の頭まで。
  if (d === 1 && end.getDate() === 1 && days >= 28 && days <= 31) {
    return `${y}年${m}月`;
  }
  if (days === 7) return `${y}/${m}/${d} の週`;
  if (days === 1) return `${y}/${m}/${d}`;
  return `${y}/${m}/${d} 〜 ${end.getFullYear()}/${end.getMonth() + 1}/${end.getDate()}`;
}

/**
 * 条件1つを「部門 = 営業部」のような日本語にする。
 *
 * `fieldName` は項目の表示名。渡されなければキーをそのまま使う——絞り込みが
 * 効いているのに何で絞られているか出ないより、キーでも出す方が良い。
 */
export function drillLabel(filter: DrillFilter, fieldName?: string): string {
  const name = fieldName ?? filter.field;
  switch (filter.op) {
    case "empty":
      return `${name} が空`;
    case "eq":
      return `${name} = ${filter.label ?? filter.value}`;
    case "has":
      return `${name} に ${filter.label ?? filter.value} を含む`;
    case "in":
      return filter.label
        ? `${name} = ${filter.label}`
        : `${name} = ${filter.values.slice(0, 3).join("・")}${filter.values.length > 3 ? ` ほか${filter.values.length - 3}件` : ""}`;
    case "range":
      return `${name} = ${filter.label ?? rangeLabel(filter.from, filter.to)}`;
  }
}

/* ========================================================================== *
 * 計算列の扱い
 * ========================================================================== */

/**
 * 絞り込みに計算列が混ざっているか。
 *
 * 混ざっていたら、**行を解決してから絞る**必要がある。計算列（数式・VLOOKUP・
 * ルックアップ・ロールアップ）は保存されず読み取り時に評価されるので、生の
 * `data` には存在しないため。
 *
 * これは実際に起きていた不具合の芯そのもの。ダッシュボード側は computed を
 * data にマージしてから集計するのに、表の画面は生の data だけを見ていた。
 * 結果、数式で作った円グラフのスライスを押すと**静かに0件の表**が出ていた。
 * エラーも警告も出ないので、何が起きたのか誰にも分からない。
 *
 * 逆に、生の列だけで絞れるときは解決を挟まない方が速い。この判定を1か所に
 * 置いて、呼び出し側が間違えられないようにする。
 */
export function needsComputedResolution(
  fields: Array<{ key: string; type: string }>,
  filters: DrillFilter[],
): boolean {
  if (filters.length === 0) return false;
  const computed = new Set(
    fields.filter((f) => isComputedField(f.type)).map((f) => f.key),
  );
  return filters.some((f) => computed.has(f.field));
}

/**
 * 解決済みの1行から値を引く関数を作る。`recordMatchesDrill` に渡す。
 *
 * `data` を先に見るのは、保存された値が常に正になるから。`computed` は
 * 同じキーで別の意味を持つことは無い設計だが、万一かぶったときに保存値を
 * 上書きされない側に倒しておく。
 */
export function drillLookup(row: {
  data: Record<string, unknown>;
  computed: Record<string, unknown>;
}): (key: string) => unknown {
  return (key) => (key in row.data ? row.data[key] : row.computed[key]);
}
