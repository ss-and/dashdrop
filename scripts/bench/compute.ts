/**
 * ダッシュボード1枚を描くのに、サーバーのCPUを何ミリ秒使うか。
 *
 * ここが分かると、1,000人が同時に開いたときの計算量が見積もれる。
 * DBには一切触らない（純関数だけを測る）ので、開発中のデータを壊さない。
 */
import { computeDashboard, type AggCollection } from "../../src/lib/aggregate";
import { autoLayout } from "../../src/lib/widget-builder";
import { detectRecurring, type Charge } from "../../src/lib/recurring";
import { tidyReport } from "../../src/lib/tidy";

const FIELDS = [
  { key: "hizuke", name: "日付", type: "date" },
  { key: "torihikisaki", name: "取引先", type: "text" },
  { key: "tantou", name: "担当", type: "select" },
  { key: "phase", name: "フェーズ", type: "select" },
  { key: "kingaku", name: "金額", type: "currency" },
  { key: "suryo", name: "数量", type: "number" },
  { key: "ken", name: "都道府県", type: "text" },
];

const SAKI = ["山田商事", "鈴木工業", "佐藤工務店", "田中フーズ", "高橋物流", "小林電機"];
const TANTOU = ["佐藤", "鈴木", "高橋", "田中"];
const PHASE = ["提案", "見積", "受注", "失注"];
const KEN = ["東京都", "大阪府", "愛知県", "福岡県", "北海道"];

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    createdAt: new Date(2026, 0, 1),
    data: {
      hizuke: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      torihikisaki: SAKI[i % SAKI.length],
      tantou: TANTOU[i % TANTOU.length],
      phase: PHASE[i % PHASE.length],
      kingaku: 10000 + (i % 900) * 137,
      suryo: (i % 40) + 1,
      ken: KEN[i % KEN.length],
    },
  }));
}

function ms(fn: () => void): number {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
}

function bench(label: string, n: number, fn: () => void) {
  fn(); // ウォームアップ（JITを踏ませる。初回だけ遅いのは実運用でも同じだが、傾向を見たい）
  const runs = [ms(fn), ms(fn), ms(fn)];
  const med = runs.sort((a, b) => a - b)[1];
  console.log(`${label.padEnd(34)} ${String(n).padStart(7)}行  ${med.toFixed(1).padStart(8)} ms`);
  return med;
}

console.log("=== ダッシュボード1枚の計算時間（サーバーCPU） ===");
for (const n of [500, 5_000, 50_000]) {
  const recs = rows(n);
  const col: AggCollection = { slug: "s", name: "受注", fields: FIELDS, records: recs };
  const layout = autoLayout([{ slug: "s", name: "受注", fields: FIELDS }]);
  bench(`computeDashboard (${layout.length}枚)`, n, () => {
    computeDashboard(layout, new Map([["s", col]]));
  });
}

console.log("\n=== 定期支払いの検出 ===");
for (const n of [1_000, 10_000, 50_000]) {
  const charges: Charge[] = Array.from({ length: n }, (_, i) => ({
    date: new Date(2026, i % 12, (i % 28) + 1),
    label: SAKI[i % SAKI.length],
    amount: 1000 + (i % 50),
  }));
  bench("detectRecurring", n, () => detectRecurring(charges, new Date(2026, 8, 1)));
}

console.log("\n=== データ整備（表記ゆれ・重複） ===");
for (const n of [1_000, 10_000, 50_000]) {
  const recs = rows(n);
  bench("tidyReport", n, () => tidyReport(FIELDS, recs));
}
