/**
 * Realistic sample-data generator.
 *
 * Templates declare only fields (+ light `sample` hints); this module fabricates
 * believable rows so an applied dashboard's charts are populated immediately.
 * Deterministic via a seeded PRNG so a given template always seeds the same
 * demo data (stable screenshots, reproducible tests).
 *
 * Returns rows as { data, createdAt } — createdAt is spread across the recent
 * past (optionally trending) so time-series widgets look alive.
 */
import type { TemplateCollection, TemplateField } from "./widgets";

/* --------------------------- seeded PRNG (mulberry32) --------------------- */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------- value pools ----------------------------- */
const COMPANY = [
  "山田商事", "佐藤工務店", "鈴木デザイン", "田中フーズ", "高橋物流",
  "伊藤クリニック", "渡辺印刷", "中村酒店", "小林電機", "加藤農園",
  "吉田運輸", "山本製作所", "松本商店", "井上不動産", "木村食品",
  "林テック", "清水建設", "森ソフト", "阿部薬局", "池田塗装",
];
const PERSON = [
  "山本", "中島", "小川", "森田", "藤田", "後藤", "岡田", "長谷川",
  "村上", "近藤", "石井", "斎藤", "坂本", "遠藤", "青木",
];
const CITY = ["東京", "大阪", "名古屋", "福岡", "札幌", "横浜", "神戸", "仙台"];
const PRODUCT = [
  "スタンダードプラン", "プレミアムプラン", "保守サービス", "追加ライセンス",
  "初期構築", "コンサルティング", "サポート契約", "カスタム開発",
];

function poolForKey(key: string, name: string): string[] | null {
  const k = (key + " " + name).toLowerCase();
  if (/(customer|client|company|取引先|顧客|会社|企業|得意先|仕入先)/.test(k)) return COMPANY;
  if (/(assignee|owner|staff|担当|社員|従業員|氏名|名前|rep|sales)/.test(k)) return PERSON;
  if (/(city|region|area|地域|拠点|エリア|都市)/.test(k)) return CITY;
  if (/(product|item|plan|商品|品目|製品|サービス名)/.test(k)) return PRODUCT;
  return null;
}

/* ------------------------------ field values ----------------------------- */
function pickWeighted<T>(
  rng: () => number,
  items: T[],
  weights?: number[],
): T {
  if (!weights || weights.length !== items.length) {
    return items[Math.floor(rng() * items.length)] ?? items[0];
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function genValue(
  field: TemplateField,
  rng: () => number,
  rowIndex: number,
  rowDate: Date,
): unknown {
  const hint = field.sample;
  switch (field.type) {
    case "text": {
      const pool = hint?.pool ?? poolForKey(field.key, field.name);
      if (pool && pool.length) return pickWeighted(rng, pool);
      return `${field.name} ${rowIndex + 1}`;
    }
    case "longtext":
      return "";
    case "email": {
      const pool = COMPANY;
      const idx = Math.floor(rng() * 900) + 100;
      return `contact${idx}@example.com`;
    }
    case "phone":
      return `03-${1000 + Math.floor(rng() * 8999)}-${1000 + Math.floor(rng() * 8999)}`;
    case "url":
      return "https://example.com";
    case "number": {
      const min = hint?.min ?? 0;
      const max = hint?.max ?? 100;
      return Math.round(min + rng() * (max - min));
    }
    case "currency": {
      const min = hint?.min ?? 10000;
      const max = hint?.max ?? 500000;
      const raw = min + rng() * (max - min);
      return Math.round(raw / 1000) * 1000;
    }
    case "checkbox": {
      const ratio = hint?.min ?? 0.5;
      return rng() < ratio;
    }
    case "date": {
      return rowDate.toISOString().slice(0, 10);
    }
    case "select": {
      const opts = field.options ?? [];
      if (!opts.length) return null;
      return pickWeighted(rng, opts, hint?.weights).value;
    }
    case "multiselect": {
      const opts = field.options ?? [];
      if (!opts.length) return [];
      const n = 1 + Math.floor(rng() * Math.min(2, opts.length));
      const chosen = new Set<string>();
      while (chosen.size < n) chosen.add(pickWeighted(rng, opts, hint?.weights).value);
      return Array.from(chosen);
    }
    default:
      return null;
  }
}

export interface SampleRow {
  data: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Generate `count` sample rows for a template collection. `count` defaults to
 * the collection's sampleRows. Dates trend toward the present when any field
 * hints `trend: "up"`, giving charts a pleasant upward slope.
 */
export function generateSampleRows(
  collection: TemplateCollection,
  count?: number,
): SampleRow[] {
  const n = count ?? collection.sampleRows ?? 60;
  const rng = makeRng(hashSeed(collection.slug));
  const now = new Date();

  // Determine the date-spread window from any date field hint (default 90d).
  const dateField = collection.fields.find((f) => f.type === "date");
  const daysBack = dateField?.sample?.daysBack ?? 90;
  const trend = dateField?.sample?.trend ?? "flat";

  const rows: SampleRow[] = [];
  for (let i = 0; i < n; i++) {
    // Bias the day so `up`/`down` trends cluster rows toward one end.
    let frac = rng();
    if (trend === "up") frac = 1 - Math.sqrt(1 - frac); // skew recent
    else if (trend === "down") frac = Math.sqrt(frac); // skew old
    const daysAgo = Math.floor(frac * daysBack);
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(9 + Math.floor(rng() * 9), Math.floor(rng() * 60), 0, 0);

    const data: Record<string, unknown> = {};
    for (const field of collection.fields) {
      data[field.key] = genValue(field, rng, i, d);
    }
    rows.push({ data, createdAt: d });
  }
  // Oldest first for tidy inserts.
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return rows;
}
