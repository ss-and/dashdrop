import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
// 型だけの取り込み（実行時の依存は増えない）。
import type { Unit } from "./widgets";

/** Merge Tailwind classes with conditional logic, de-duplicating conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Turn an arbitrary label into a URL/DB-safe slug.
 *
 * 【回帰防止】NFKD ではなく NFKC。NFKD は「ズ」を「ス」＋結合濁点に分解し、
 * 続く記号除去が結合文字ごと落とすため、日本語の濁音・半濁音が静かに消えていた
 * （フェーズ → フェース、ガイド → カ_イト、パーセント → ハ_ーセント）。
 * NFKC なら合成済みのまま、全角英数の半角化などの正規化だけが効く。
 */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "item";
}

/**
 * Turn a human label into a stable machine key (snake_case-ish).
 * 濁点が消える問題については `slugify` の注記を参照。
 */
export function toFieldKey(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return base || "field";
}

/** Ensure a candidate value is unique within a set, appending -2, -3, … */
export function uniqueName(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) return candidate;
  let i = 2;
  while (taken.has(`${candidate}-${i}`)) i++;
  return `${candidate}-${i}`;
}

/** Format a number with thousands separators, no decimals by default. */
export function formatNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/**
 * グラフの軸やラベル用の短い数値表記。
 *
 * 業務データの金額は 8〜9桁が普通で、`15,000,000` をそのまま軸に置くと幅が
 * 足りずに「000」だけが残る（実際そうなっていた）。日本語の帳票と同じ 万・億 に
 * 丸めれば、幅も意味も収まる。1万未満はそのまま出す。
 */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e8) {
    const v = abs / 1e8;
    return `${sign}${formatNumber(v, v >= 100 ? 0 : 1)}億`;
  }
  if (abs >= 1e4) {
    const v = abs / 1e4;
    return `${sign}${formatNumber(v, v >= 100 ? 0 : 1)}万`;
  }
  return formatNumber(value, Number.isInteger(value) ? 0 : 1);
}

/**
 * 指標の値を単位に合わせて文字列にする。
 *
 * KPIタイル・クロス集計・Slack/Notionへの共有が同じ数字を同じ形で出すために、
 * ここ1か所に置く。画面では ¥1,329,000 と出ているのに、共有した先では
 * 1329000 と書いてある——という食い違いを作らないため。
 */
export function formatValue(value: number, unit: Unit | undefined): string {
  switch (unit) {
    case "currency":
      return `¥${formatNumber(Math.round(value))}`;
    case "percent":
      return `${formatNumber(value)}%`;
    case "days":
      return `${formatNumber(value)}日`;
    case "number":
    default:
      // 平均のような小数には1桁だけ残す。
      return formatNumber(value, Number.isInteger(value) ? 0 : 1);
  }
}

/** Percentage helper returning an integer 0–100 (guards divide-by-zero). */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}
