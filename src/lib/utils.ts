import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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

/** Percentage helper returning an integer 0–100 (guards divide-by-zero). */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}
