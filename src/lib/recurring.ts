/**
 * 定期支払い（サブスク・固定費）の検出。
 *
 * 明細を置いたときに一番知りたいのは合計額ではなく、**いま何に課金され続けて
 * いるか**。カード明細にも法人カードの利用明細にも、それは「同じ加盟店名が
 * 一定の間隔で、だいたい同じ額で出てくる」という形でしか現れない。人が目で
 * 追うと必ず取りこぼす——年1回のものは12か月分スクロールしないと見えないし、
 * 解約したつもりで引かれ続けているものは、そもそも探そうと思わない限り見えない。
 *
 * ## AI を使わない
 *
 * ここは決定的なルールだけで書く。理由は3つある。
 *
 *  1. **明細は個人情報の塊**。加盟店名の一覧を外部へ送るのは、この製品が
 *     取りたいリスクではない。送らずに済むなら送らない。
 *  2. **同じファイルを2回置いたら同じ答えが出る**必要がある。「先月は
 *     サブスク12件、今月は11件」が、実際に解約したからなのか、モデルの
 *     気分なのか分からない結果には使い道がない。
 *  3. 1明細ごとに実費が出る処理を、明細の件数だけ回すのは原価に合わない。
 *
 * ## 迷ったら「まとめない」
 *
 * この判定で一番いけないのは、**存在しない定期支払いを報告すること**。
 * 別々の店をひとつに畳んでしまうと「毎月5,000円の謎のサブスク」が生まれ、
 * 利用者は実在しないものを探しに行くことになる。逆に分けすぎた場合は、
 * 回数が足りずに報告されないだけで、嘘はつかない。
 * だから正規化は**足りないほうへ倒す**。参照コードだけを落とし、
 * 店名・店舗名は残す。
 *
 * 純関数。外部依存なし。`Date.now()` を中で呼ばない（呼ぶと「いま続いて
 * いるか」の判定がテストできなくなる）ので、基準日は必ず引数で受け取る。
 */

/** 明細1行ぶん。 */
export interface Charge {
  date: Date;
  /** 摘要・加盟店名。 */
  label: string;
  /** 金額。支出を正の数とする。 */
  amount: number;
}

export type Cadence = "weekly" | "monthly" | "quarterly" | "yearly";

export interface RecurringCharge {
  /** 表示用の名前。グループの中で一番多く出てきた綴りをそのまま使う。 */
  label: string;
  /** 突き合わせに使った正規化キー。同じ支払いをまとめた根拠。 */
  key: string;
  cadence: Cadence;
  /** 1回あたりの代表額（中央値）。 */
  amount: number;
  /**
   * 毎回額が変わるか。
   *
   * 電気・ガス・水道・通信は従量なので額が動くが、立派な定期支払い。
   * ただし「額が動く」を許すと、毎週同じコンビニに寄る人まで拾ってしまうので、
   * その場合は間隔の条件を厳しくしている（後述の judge を参照）。
   */
  variable: boolean;
  occurrences: number;
  first: Date;
  last: Date;
  /** 月あたりに直した額。年額は ÷12、週次は ×52/12。 */
  monthlyEquivalent: number;
  /**
   * まだ続いていそうか。
   *
   * 最後の1回から、想定間隔の2倍以上あいていたら false。解約済みか、
   * カードを変えたかのどちらか——どちらにせよ「いま払っているもの」の
   * 合計には入れてはいけない。
   */
  active: boolean;
}

export interface RecurringSummary {
  /** 見つかった定期支払い。月換算の大きい順。 */
  charges: RecurringCharge[];
  /** active なものだけの月換算合計。 */
  monthlyTotal: number;
  /** 同、年換算合計。 */
  yearlyTotal: number;
  /** 止まっていると判断したもの（active === false）の件数。 */
  endedCount: number;
  /** 定期支払いに畳めなかった明細の件数。 */
  unmatched: number;
}

/* -------------------------------------------------------------------------- */
/* 間隔の種類                                                                  */
/* -------------------------------------------------------------------------- */

interface CadenceSpec {
  /** 想定間隔（日）。 */
  days: number;
  /**
   * 許容する間隔の幅（日）。
   *
   * 月次を 26〜35 と広めに取ってあるのは**月末問題**のため。1/31 → 2/28 は
   * 28日、2/28 → 3/31 は 31日で、どちらも「毎月同じ日」なのに間隔は揺れる。
   * 28〜31 だけに絞ると、月末が引き落とし日の支払い（日本ではむしろ多数派）を
   * 落としてしまう。
   *
   * 幅どうしは重ならないようにしてある。重なると1つの間隔が2種類に該当し、
   * どちらを採るかという答えの無い判断が要るようになる。
   */
  min: number;
  max: number;
  /** 1か月あたりに直すときに掛ける数。 */
  perMonth: number;
}

const CADENCES: Record<Cadence, CadenceSpec> = {
  weekly: { days: 7, min: 6, max: 8, perMonth: 52 / 12 },
  monthly: { days: 30, min: 26, max: 35, perMonth: 1 },
  quarterly: { days: 91, min: 84, max: 98, perMonth: 1 / 3 },
  yearly: { days: 365, min: 350, max: 380, perMonth: 1 / 12 },
};

const CADENCE_ORDER: Cadence[] = ["weekly", "monthly", "quarterly", "yearly"];

/**
 * 定期と認めるのに要る最低回数。
 *
 * 3回。2回だと「たまたま1か月あけて2回買った」がすべてサブスクになる——
 * 実際の明細でこれをやると、報告の大半が誤検出で埋まって使い物にならない。
 * 3回目が同じ間隔で来て、はじめて「繰り返している」と言える。
 */
export const MIN_OCCURRENCES = 3;

/**
 * 「定額」と見なす額のブレ幅。
 *
 * 消費税の端数や為替（ドル建てのサブスク）で1〜2%は動く。3%までを定額とし、
 * それ以上を variable として別扱いにする。
 */
const FIXED_AMOUNT_TOLERANCE = 0.03;

const DAY_MS = 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* 加盟店名の正規化                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 明細の摘要を、突き合わせ用のキーに畳む。
 *
 * 実際の明細に出てくる形:
 *   AMAZON.CO.JP*M12AB3CD4        … 取引参照コードが付く
 *   ＡＰＰＬＥ　ＣＯＭ　ＢＩＬＬ   … 全角
 *   NETFLIX.COM 866-579-7172      … 電話番号が付く
 *   GOOGLE *YouTubePremium        … * のあとが**本当のサービス名**
 *   ｾﾌﾞﾝ-ｲﾚﾌﾞﾝ/ﾄｳｷｮｳｼﾌﾞﾔ1        … 半角カナ＋店舗番号
 *
 * 「* のあとを捨てる」という単純な規則は使えない。AMAZON では捨てたいものが、
 * GOOGLE では捨ててはいけないものになる——Google Play の課金がすべて
 * 「google」に潰れ、別々のサブスクが1つの巨大な定期支払いに化ける。
 *
 * なので語（トークン）単位で見て、**それ自体が識別子にしか見えないもの**だけを
 * 落とす。判定を外したときにどちらへ転ぶかを揃えてあるのが肝で、
 * 迷ったら残す＝まとめない側に倒れる。
 */
export function normalizeMerchant(label: string): string {
  // NFKC で全角英数を半角に、半角カナを全角カナに寄せる。ここを通さないと
  // 「ＮＥＴＦＬＩＸ」と「NETFLIX」が別のサブスクとして二重に出る。
  const normalized = label.normalize("NFKC");

  // 区切りは空白のほか、明細でよく使われる * / , と全角の読点まで見る。
  const tokens = normalized
    .split(/[\s*/,、，]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const kept = tokens.filter((t) => !looksLikeIdentifier(t));

  // 全部落ちたら、落とす前のものを使う。空のキーを作ると、無関係な明細が
  // すべて「名前の無い1つの定期支払い」に集まってしまう。
  const source = kept.length > 0 ? kept.join(" ") : normalized;

  return source.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * その語が、意味のある名前ではなく識別子（参照コード・電話番号・伝票番号）か。
 *
 * 大文字と数字だけで6文字以上、かつ数字を2つ以上含むものを参照コードとみなす。
 * 小文字が1つでも入っていれば人が読む言葉として残す（YouTubePremium が
 * 落ちないのはこの条件のおかげ）。NETFLIX のような全部大文字の語も、
 * 数字が無いので残る。
 */
function looksLikeIdentifier(token: string): boolean {
  // 4桁以上の数字だけ（伝票番号・店舗番号の単独表記）。
  if (/^\d{4,}$/.test(token)) return true;
  // 数字とハイフンだけで7文字以上（電話番号）。
  if (/^[\d-]{7,}$/.test(token) && /\d/.test(token)) return true;
  // 大文字と数字だけの6文字以上で、数字を2つ以上含む（参照コード）。
  if (/^[A-Z0-9]{6,}$/.test(token)) {
    const digits = token.replace(/\D/g, "").length;
    if (digits >= 2) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* 検出                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 明細から定期支払いを見つける。
 *
 * `asOf` は「いま続いているか」を決める基準日。既定値を持たせず必ず受け取るのは、
 * 中で `new Date()` を呼ぶとテストが書けなくなるため（「3か月前に止まった」と
 * いう判定は、今日がいつかを固定できないと確かめられない）。
 */
export function detectRecurring(
  charges: readonly Charge[],
  asOf: Date,
): RecurringSummary {
  const groups = new Map<string, Charge[]>();
  let unmatched = 0;

  for (const c of charges) {
    // 返金・キャンセル（0以下）と、日付が読めなかったものは定期支払いの
    // 材料にならない。件数だけ数えて外す。
    if (!(c.amount > 0) || Number.isNaN(c.date.getTime())) {
      unmatched += 1;
      continue;
    }
    const key = normalizeMerchant(c.label);
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  const found: RecurringCharge[] = [];

  for (const [key, list] of groups) {
    const judged = judge(key, list, asOf);
    if (judged) found.push(judged);
    else unmatched += list.length;
  }

  // 月換算の大きい順。金額が同じときは名前順で、並びが実行のたびに変わらない
  // ようにする（同じファイルから毎回同じ画面が出ることが、この機能の前提）。
  found.sort(
    (a, b) =>
      b.monthlyEquivalent - a.monthlyEquivalent || a.label.localeCompare(b.label),
  );

  const active = found.filter((c) => c.active);
  const monthlyTotal = round2(
    active.reduce((sum, c) => sum + c.monthlyEquivalent, 0),
  );

  return {
    charges: found,
    monthlyTotal,
    yearlyTotal: round2(monthlyTotal * 12),
    endedCount: found.length - active.length,
    unmatched,
  };
}

/**
 * 1グループを定期支払いと認めるか。認めないなら null。
 */
function judge(
  key: string,
  list: readonly Charge[],
  asOf: Date,
): RecurringCharge | null {
  if (list.length < MIN_OCCURRENCES) return null;

  const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());

  // 同じ日に複数回あるとき（同日に2本立てる支払い）は間隔0が混じる。
  // 0日は定期の証拠にならないので、間隔を作る前に同日をまとめる。
  const days = dedupeSameDay(sorted);
  if (days.length < MIN_OCCURRENCES) return null;

  const intervals: number[] = [];
  for (let i = 1; i < days.length; i += 1) {
    intervals.push(
      Math.round((days[i].date.getTime() - days[i - 1].date.getTime()) / DAY_MS),
    );
  }

  const cadence = classifyCadence(median(intervals));
  if (!cadence) return null;

  const spec = CADENCES[cadence];
  const inWindow = intervals.filter((d) => d >= spec.min && d <= spec.max).length;

  const amounts = sorted.map((c) => c.amount);
  const amount = median(amounts);
  if (!(amount > 0)) return null;
  const spread = (Math.max(...amounts) - Math.min(...amounts)) / amount;
  const variable = spread > FIXED_AMOUNT_TOLERANCE;

  /*
   * 通す条件を、額が一定かどうかで変える。
   *
   * 額が一定なら、間隔が1回飛んでも定期と認めてよい（カードの期限切れで
   * 1か月止まり、翌月から再開するのは実際によくある）。全体の 2/3 を満たせば通す。
   *
   * 額が動くものは、間隔が**全部**そろっていることを求める。ここを緩めると、
   * 毎週同じコンビニに寄る人の買い物が「毎週定期支払い」として並ぶ。
   * 電気・ガスのような本物の従量課金は、引き落とし日が動かないので
   * この厳しい条件を問題なく通る。
   */
  const required = variable
    ? intervals.length
    : Math.ceil((intervals.length * 2) / 3);
  if (inWindow < required) return null;

  // 週次で額が動くものは、定期支払いではなく買い物の習慣。名前を付けて
  // 報告すると、利用者は解約できないものを解約しに行くことになる。
  if (variable && cadence === "weekly") return null;

  const last = days[days.length - 1].date;
  const idleDays = (asOf.getTime() - last.getTime()) / DAY_MS;

  return {
    label: dominantLabel(sorted),
    key,
    cadence,
    amount: round2(amount),
    variable,
    occurrences: sorted.length,
    first: days[0].date,
    last,
    monthlyEquivalent: round2(amount * spec.perMonth),
    active: idleDays <= spec.days * 2,
  };
}

/** 同じ日の明細を1つに畳む（金額は合算せず、最初の1件を代表にする）。 */
function dedupeSameDay(sorted: readonly Charge[]): Charge[] {
  const out: Charge[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && sameDay(prev.date, c.date)) continue;
    out.push(c);
  }
  return out;
}

function sameDay(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) < DAY_MS && a.getDate() === b.getDate();
}

/** 間隔（日）から支払いの周期を決める。どの幅にも入らなければ null。 */
export function classifyCadence(intervalDays: number): Cadence | null {
  for (const c of CADENCE_ORDER) {
    const spec = CADENCES[c];
    if (intervalDays >= spec.min && intervalDays <= spec.max) return c;
  }
  return null;
}

/** グループの中で一番多く出てきた綴り。同数なら先に出てきたほうを採る。 */
function dominantLabel(list: readonly Charge[]): string {
  const counts = new Map<string, number>();
  for (const c of list) {
    counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
  }
  let best = list[0].label;
  let bestCount = 0;
  for (const c of list) {
    const n = counts.get(c.label) ?? 0;
    if (n > bestCount) {
      best = c.label;
      bestCount = n;
    }
  }
  return best;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * 円単位の金額を扱うので小数第2位まで。浮動小数のまま合計すると
 * 「¥12,340.000000000002」が画面に出る。
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* 明細の列を見つける                                                          */
/* -------------------------------------------------------------------------- */

export interface ChargeColumns {
  dateKey: string;
  labelKey: string;
  amountKey: string;
}

/**
 * 取り込んだ表が「明細」の形をしているかを見て、日付・摘要・金額の列を選ぶ。
 *
 * 見つからなければ null。**推測で埋めない**——列を1つでも取り違えると、
 * 出てくるのは間違った定期支払いの一覧になる。空で返せば何も出ないだけで、
 * 利用者が嘘を掴まされることはない。
 */
export function detectChargeColumns(
  fields: readonly { key: string; name: string; type: string }[],
): ChargeColumns | null {
  const dateKey = pick(fields, ["date"], DATE_WORDS);
  const amountKey = pick(fields, ["currency", "number"], AMOUNT_WORDS);
  if (!dateKey || !amountKey) return null;

  // 摘要は「文字の列で、日付でも金額でもないもの」。名前が当たれば優先する。
  const labelKey =
    pick(fields, ["text", "select"], LABEL_WORDS) ??
    fields.find(
      (f) =>
        (f.type === "text" || f.type === "select") &&
        f.key !== dateKey &&
        f.key !== amountKey,
    )?.key;
  if (!labelKey) return null;

  return { dateKey, labelKey, amountKey };
}

const DATE_WORDS = ["日付", "利用日", "ご利用日", "取引日", "決済日", "date"];
const AMOUNT_WORDS = [
  "金額",
  "利用金額",
  "ご利用金額",
  "支払金額",
  "請求額",
  "amount",
];
const LABEL_WORDS = [
  "摘要",
  "利用店名",
  "ご利用先",
  "加盟店",
  "店名",
  "内容",
  "品目",
  "merchant",
  "description",
];

/** 型が合う列のうち、名前が語彙に当たるものを優先して1つ選ぶ。 */
function pick(
  fields: readonly { key: string; name: string; type: string }[],
  types: readonly string[],
  words: readonly string[],
): string | undefined {
  const typed = fields.filter((f) => types.includes(f.type));
  if (typed.length === 0) return undefined;
  const named = typed.find((f) =>
    words.some((w) => f.name.toLowerCase().includes(w.toLowerCase())),
  );
  // 名前が当たらなくても、その型の列がちょうど1つしか無ければそれで確定できる。
  // 2つ以上あるときに勝手に選ぶと、取り違えたまま黙って進むことになる。
  return named?.key ?? (typed.length === 1 ? typed[0].key : undefined);
}

/** 画面に出す周期の名前。 */
export const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "毎週",
  monthly: "毎月",
  quarterly: "3か月ごと",
  yearly: "年1回",
};
