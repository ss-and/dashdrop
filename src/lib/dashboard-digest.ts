/**
 * ダッシュボードを「文章で読める形」に畳む。
 *
 * SlackにもNotionにもグラフそのものは送れない。送れるのは数字と言葉だけなので、
 * *その画面を見なくても要点が分かる* 要約をここで1つだけ作り、両方が同じものを
 * 使う。別々に組み立てると、Slackには合計が出てNotionには出ない、といった食い
 * 違いがすぐ生まれる。
 *
 * 数字の書式は画面と同じ `formatValue`。共有した先だけ `1329000` と書いてある、
 * という状態を作らないため。
 */
import type { WidgetSpec, WidgetData } from "./widgets";
import { formatValue, formatCompact } from "./utils";

/** 要約に載せる指標の数。Slackの fields は10個までなので、それに合わせる。 */
const MAX_KPIS = 10;
/** 内訳をいくつまで載せるか。 */
const MAX_BREAKDOWNS = 3;
/** 1つの内訳から載せる項目数。 */
const MAX_ROWS_PER_BREAKDOWN = 5;

export interface DigestRow {
  label: string;
  value: string;
}

export interface DigestBreakdown {
  title: string;
  rows: DigestRow[];
}

export interface DashboardDigest {
  /** 指標（KPIタイル）。 */
  kpis: DigestRow[];
  /** 構成比・ランキングの上位。 */
  breakdowns: DigestBreakdown[];
  /** ダッシュボード全体のウィジェット数。 */
  widgetCount: number;
}

export interface ComputedWidget {
  widget: WidgetSpec;
  data: WidgetData;
}

export function buildDigest(computed: ComputedWidget[]): DashboardDigest {
  const kpis: DigestRow[] = [];
  const breakdowns: DigestBreakdown[] = [];

  for (const { widget, data } of computed) {
    if (data.type === "kpi" && kpis.length < MAX_KPIS) {
      kpis.push({ label: widget.title, value: formatValue(data.value, data.unit) });
      continue;
    }
    if (
      (data.type === "donut" ||
        data.type === "hbar" ||
        data.type === "funnel" ||
        data.type === "treemap") &&
      breakdowns.length < MAX_BREAKDOWNS &&
      data.slices.length > 0
    ) {
      breakdowns.push({
        title: widget.title,
        rows: data.slices.slice(0, MAX_ROWS_PER_BREAKDOWN).map((s) => ({
          label: s.label,
          // 内訳は桁が大きくなりがちなので、万・億でそろえる（軸の表示と同じ）。
          value: formatCompact(s.value),
        })),
      });
    }
  }

  return { kpis, breakdowns, widgetCount: computed.length };
}

/**
 * 内訳を1行ずつのテキストにする。Slackの本文とNotionの箇条書きで共通に使う。
 */
export function breakdownLines(b: DigestBreakdown): string[] {
  return b.rows.map((r) => `${r.label}: ${r.value}`);
}

/**
 * 中身が空のときの一言。
 *
 * 「0件でした」と言えるのと、何も言わずに空の投稿が飛ぶのとでは、受け取る側の
 * 解釈がまったく違う。前者は事実、後者は故障に見える。
 */
export function isEmptyDigest(d: DashboardDigest): boolean {
  return d.kpis.length === 0 && d.breakdowns.length === 0;
}
