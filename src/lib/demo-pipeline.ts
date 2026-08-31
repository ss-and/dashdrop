/**
 * 見本のデータから、本物のダッシュボードを組み立てる。
 *
 * ## なぜ独立した層にしたのか
 *
 * トップページの「置いてみる」は、**製品と同じ経路**を通らないと意味が無い。
 * それらしい絵を並べるだけなら、既にそうしていた（手描きの偽スクリーンショット）。
 * 置いたファイルから本当に図表が出ることの証明にはならないし、
 * 中身が変わっても絵は変わらないので、いずれ実物と食い違う。
 *
 * 幸い、組み立ての中核（`profileFields` → `autoLayoutFromProfiles` →
 * `computeDashboard`）は**DBにもネットワークにも触れない純粋関数**なので、
 * そのままブラウザで動く。つまりトップページで動かしているものは、
 * 登録後に動くものと1行も違わない。
 *
 * ついでに、この製品の差別化そのものも成立する——**ファイルはどこにも
 * 送られない**。「ChatGPTにCSVを貼る」との違いは、実際に外へ出ないことなので、
 * それを言葉ではなく仕組みで見せられる。
 *
 * ここに置くのは「行と列 → 図表」の部分だけ。ファイルの読み取り（xlsx）は
 * 重いので呼び出し側で動的に読み込む。見本を見るだけの人に 900KB を
 * 配りたくない。
 */
import { coerceValue, type FieldType } from "./field-types";
import { profileFields } from "./data-profile";
import { autoLayoutFromProfiles } from "./auto-layout";
import { computeDashboard } from "./aggregate";
import type { AggCollection } from "./aggregate";
import type { WidgetSpec, WidgetData } from "./widgets";
import { DEFAULT_INTENT, type DashboardIntent } from "./dashboard-intent";

/** 1枚のシート。取り込み経路の `readSheet` + `inferFields` と同じ形。 */
export interface DemoSheet {
  name: string;
  fields: Array<{ key: string; name: string; type: FieldType }>;
  /** 見出し（列名）をキーにした行。Excel から読んだ生の形。 */
  rows: Array<Record<string, unknown>>;
}

export interface DemoResult {
  computed: Array<{ widget: WidgetSpec; data: WidgetData }>;
  rowCount: number;
  fieldCount: number;
  /** 図表が1つも組めなかったときの理由。組めたときは null。 */
  reason: string | null;
}

const SLUG = "demo";

/**
 * トップページで使う組み立ての意図。
 *
 * 既定（`team`）だと図表が15枚まで出る。**製品としては正しいが、
 * トップページには長すぎた**——実際に組んでみたら、ページ全体 4,700px の
 * うち大半がダッシュボードになり、その先の説明まで誰も辿り着かない形だった。
 *
 * `exec`（上に見せる）は 7枚・明細表なし。1画面に収まる大きさで、
 * 「置いたら出る」を見せるには十分。**製品の別の設定を使っているだけ**なので、
 * ここで見えるものが実物と違うわけではない。登録すれば厚いほうも選べる。
 */
export const DEMO_INTENT: DashboardIntent = { ...DEFAULT_INTENT, audience: "exec" };

/**
 * 行を「列名キー」から「フィールドキー」へ移し替える。
 *
 * 取り込み経路（src/app/api/import/route.ts）が保存前にやっているのと同じこと。
 * ここを飛ばして生の行をそのまま渡すと、集計側が値を1つも見つけられず、
 * **図表は出るのに全部ゼロ**という、一番たちの悪い見え方になる。
 */
export function toRecords(sheet: DemoSheet): AggCollection["records"] {
  const now = new Date();
  return sheet.rows.map((row, i) => {
    const data: Record<string, unknown> = {};
    for (const f of sheet.fields) {
      // 読むのは元の列名だけ。キーでの代替探索はしない（別列の値が紛れ込む）。
      const res = coerceValue(f.type, row[f.name] ?? null);
      data[f.key] = res.ok ? res.value : null;
    }
    return { id: `demo-${i}`, createdAt: now, data };
  });
}

/**
 * シート1枚から、描画できる状態のダッシュボードを作る。
 *
 * 返す `computed` は `DashboardGrid` がそのまま受け取れる形なので、
 * 描画も製品と同じ部品を使える。
 */
export function buildDemoDashboard(
  sheet: DemoSheet,
  intent: DashboardIntent = DEMO_INTENT,
  now: Date = new Date(),
): DemoResult {
  const records = toRecords(sheet);
  const base = {
    rowCount: records.length,
    fieldCount: sheet.fields.length,
  };

  if (records.length === 0) {
    return { ...base, computed: [], reason: "データの行が見つかりませんでした。" };
  }
  if (sheet.fields.length === 0) {
    return { ...base, computed: [], reason: "見出しの行が見つかりませんでした。" };
  }

  const layout = autoLayoutFromProfiles(
    [
      {
        slug: SLUG,
        name: sheet.name,
        rowCount: records.length,
        fields: profileFields(
          records.map((r) => r.data),
          sheet.fields,
        ),
      },
    ],
    intent,
  );

  if (layout.length === 0) {
    return {
      ...base,
      computed: [],
      /*
       * 「作れませんでした」で終わらせない。この画面は製品の第一印象なので、
       * 何が足りなかったのかまで書く。日付も数量も無い表（住所録など）は
       * 実際に組めないが、それは利用者の落ち度ではない。
       */
      reason:
        "この表からは図表を組めませんでした。日付や金額・数量にあたる列が1つでもあると作れます。",
    };
  }

  const collections: Map<string, AggCollection> = new Map([
    [SLUG, { slug: SLUG, name: sheet.name, fields: sheet.fields, records }],
  ]);

  return { ...base, computed: computeDashboard(layout, collections, now), reason: null };
}
