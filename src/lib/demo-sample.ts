/**
 * トップページで「置いてみる」を押した人に見せる見本の売上台帳。
 *
 * ## 決め事
 *
 * **乱数を使わない。** この製品の売り筋は「同じファイルなら毎回同じ答え」で、
 * トップページのデモが開くたびに違う絵を出したら、その主張と食い違う。
 * 線形合同法で値を作り、同じ月なら誰が見ても同じ画面になるようにする。
 *
 * **日付は「今月まで」に寄せる。** 固定の日付を焼き込むと、半年後に開いた人には
 * 半年前の台帳が出る。デモが古いと、製品そのものが放置されて見える。
 *
 * **実在しそうな中身にする。** 「商品A・商品B」のような並びは、見た瞬間に
 * 作り物だと分かる。相手は従業員20〜50人の会社なので、その規模の台帳に
 * 見えることが、そのまま「自分の表でも動く」の説得力になる。
 */
import type { FieldType } from "./field-types";
import type { DemoSheet } from "./demo-pipeline";

const CUSTOMERS = [
  "山田製作所",
  "佐藤商事",
  "鈴木工業",
  "高橋物産",
  "田中電機",
  "伊藤金属",
  "渡辺精機",
];

const ITEMS = [
  "ステンレス板 SUS304",
  "六角ボルト M8",
  "配管継手 20A",
  "溶接棒 φ3.2",
  "アルミ形材",
  "シールテープ",
];

const REPS = ["境野", "中村", "小林", "大西"];

const CHANNELS = ["直販", "代理店", "Web"];

/** 線形合同法。乱数ではなく「毎回同じ、それらしい散らばり」を作るための道具。 */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export const DEMO_FIELDS: DemoSheet["fields"] = [
  { key: "date", name: "受注日", type: "date" as FieldType },
  { key: "customer", name: "得意先", type: "text" as FieldType },
  { key: "item", name: "品名", type: "text" as FieldType },
  { key: "channel", name: "販路", type: "text" as FieldType },
  { key: "qty", name: "数量", type: "number" as FieldType },
  { key: "amount", name: "金額", type: "currency" as FieldType },
  { key: "rep", name: "担当", type: "text" as FieldType },
];

/** 何行の見本を作るか。多すぎると重く、少なすぎると図表が痩せる。 */
export const DEMO_ROWS = 240;

/**
 * 見本のシートを組み立てる。
 *
 * `asOf` を渡せるのはテストのため。既定は「今日」で、直近6か月ぶんを作る。
 */
export function demoSheet(asOf: Date = new Date()): DemoSheet {
  const rnd = seeded(20260901);
  const rows: Array<Record<string, unknown>> = [];

  // 直近6か月。月ごとに件数を変えて、棒グラフが平坦にならないようにする。
  const monthWeights = [0.72, 0.85, 0.78, 1.0, 0.94, 1.12];

  for (let back = 5; back >= 0; back--) {
    const base = new Date(asOf.getFullYear(), asOf.getMonth() - back, 1);
    const daysInMonth = new Date(
      base.getFullYear(),
      base.getMonth() + 1,
      0,
    ).getDate();
    const target = Math.round((DEMO_ROWS / 6) * monthWeights[5 - back]);

    for (let i = 0; i < target; i++) {
      // 今月は「今日まで」。未来の受注が並ぶと台帳として不自然になる。
      const maxDay = back === 0 ? asOf.getDate() : daysInMonth;
      const day = 1 + Math.floor(rnd() * maxDay);
      const customer = CUSTOMERS[Math.floor(rnd() * CUSTOMERS.length)];
      const item = ITEMS[Math.floor(rnd() * ITEMS.length)];
      const rep = REPS[Math.floor(rnd() * REPS.length)];
      const channel = CHANNELS[Math.floor(rnd() * CHANNELS.length)];
      const qty = 1 + Math.floor(rnd() * 24);
      // 単価は品名ごとに固定し、数量で金額が動くようにする。
      const unit = 2400 + ITEMS.indexOf(item) * 3100 + Math.floor(rnd() * 800);

      rows.push({
        受注日: `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        得意先: customer,
        品名: item,
        販路: channel,
        数量: qty,
        金額: unit * qty,
        担当: rep,
      });
    }
  }

  // 日付順。取り込んだ台帳はたいてい並んでいるので、見本もそうする。
  rows.sort((a, b) => String(a.受注日).localeCompare(String(b.受注日)));

  return { name: "売上台帳", fields: DEMO_FIELDS, rows };
}
