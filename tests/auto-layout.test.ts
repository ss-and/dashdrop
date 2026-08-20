/**
 * 自動ダッシュボードの回帰テスト。
 *
 * 実際の営業案件Excel（startup_sales_order_management.xlsx）を入れた利用者の言葉:
 *   「ダッシュボードで3つしかないし、日付別の棒グラフにもなってないな」
 *   「ドリルダウンもできずに、どの案件なのかも全くわからないから使い物にならない」
 *
 * そのとき出ていたのは KPI 2枚・`案件ID` 別のドーナツ（10案件が10等分＝情報量ゼロ）・
 * 明細1枚だけだった。ここで固定したい契約は4つ。
 *
 * 1. 一意の列（ID・氏名）を構成比の軸にしない。
 * 2. 値が一度も入っていない列（キャッシュの無い数式列）を指標にしない。
 * 3. 日付列があるなら、必ず日付別のグラフを出す。
 * 4. 明細表は「どの行なのか」が分かる列を先頭に出す。
 */
import { describe, it, expect } from "vitest";
import {
  profileFields,
  categoryFields,
  rankableFields,
  measureFields,
  detailColumns,
} from "@/lib/data-profile";
import { autoLayoutFromProfiles } from "@/lib/auto-layout";

/** 実ファイルと同じ形をした営業案件データ。 */
const FIELDS = [
  { key: "案件id", name: "案件ID", type: "text" },
  { key: "顧客名", name: "顧客名", type: "text" },
  { key: "案件名", name: "案件名", type: "text" },
  { key: "営業担当", name: "営業担当", type: "text" },
  { key: "チャネル", name: "チャネル", type: "text" },
  { key: "フェーズ", name: "フェーズ", type: "text" },
  { key: "提案金額", name: "提案金額", type: "number" },
  { key: "見込額", name: "見込額", type: "text" }, // 数式列（値はキャッシュされていない）
  { key: "完了予定日", name: "完了予定日", type: "date" },
];

const REPS = ["佐藤", "鈴木", "高橋", "田中"];
const CHANNELS = ["Web問合せ", "既存追加", "セミナー", "紹介", "アウトバウンド"];
const PHASES = ["A: 契約完了", "B: 内諾あり", "C: 提案/交渉", "D: 初回ヒアリング", "失注"];

const RECORDS = Array.from({ length: 10 }, (_, i) => ({
  案件id: `PRJ-2026-${String(i + 1).padStart(3, "0")}`,
  顧客名: `顧客${i + 1}株式会社`,
  案件名: `案件${i + 1}の構築`,
  営業担当: REPS[i % REPS.length],
  チャネル: CHANNELS[i % CHANNELS.length],
  フェーズ: PHASES[i % PHASES.length],
  提案金額: (i + 1) * 1_000_000,
  見込額: null, // 全行 null
  完了予定日: `2026-${String((i % 5) + 8).padStart(2, "0")}-15`,
}));

const profiled = () => profileFields(RECORDS, FIELDS);
const sheet = () => ({
  slug: "営業案件管理",
  name: "営業案件管理",
  rowCount: RECORDS.length,
  fields: profiled(),
});

describe("列の役割の判定", () => {
  it("全行が違う列は、構成比の軸にしない", () => {
    const names = categoryFields(profiled()).map((f) => f.name);
    expect(names).not.toContain("案件ID");
    expect(names).not.toContain("顧客名");
    expect(names).not.toContain("案件名");
  });

  it("業務的に意味のある区分を先頭に置く", () => {
    // 種類の少なさだけで選ぶと 営業担当(4) が フェーズ(5) に勝ってしまう。
    expect(categoryFields(profiled())[0]?.name).toBe("フェーズ");
  });

  it("一意でも、ランキングの軸としては使える（ID列は除く）", () => {
    const names = rankableFields(profiled()).map((f) => f.name);
    expect(names).toContain("顧客名");
    expect(names).not.toContain("案件ID");
  });

  it("一度も値が入っていない列は指標にしない", () => {
    expect(measureFields(profiled()).map((f) => f.name)).toEqual(["提案金額"]);
  });

  it("明細表は、どの行かが分かる列を先に出す", () => {
    const cols = detailColumns(profiled(), 6).map((f) => f.name);
    expect(cols[0]).toMatch(/名/);
    expect(cols).not.toContain("見込額"); // 空の列は出さない
  });
});

describe("自動レイアウト", () => {
  const layout = () => autoLayoutFromProfiles([sheet()]);

  it("3枚では終わらない", () => {
    expect(layout().length).toBeGreaterThanOrEqual(8);
  });

  it("日付列があるなら、日付別のグラフを必ず出す", () => {
    const series = layout().find((w) => w.type === "bar");
    expect(series).toBeDefined();
    expect(series && "dateField" in series && series.dateField).toBe("完了予定日");
    expect(series && "bucket" in series && series.bucket).toBe("month");
  });

  it("構成比の軸に一意な列を選ばない", () => {
    for (const w of layout()) {
      if (w.type === "donut" || w.type === "hbar" || w.type === "pivot") {
        const keys =
          w.type === "pivot" ? [w.rowField, w.colField] : [w.groupBy];
        expect(keys).not.toContain("案件id");
      }
    }
  });

  it("値の無い列を合計しない", () => {
    for (const w of layout()) {
      if (w.type === "kpi" && "field" in w.measure) {
        expect(w.measure.field).not.toBe("見込額");
      }
    }
  });

  it("明細表を必ず含み、名前の列が先頭にある", () => {
    const table = layout().find((w) => w.type === "table");
    expect(table).toBeDefined();
    expect(table && "columns" in table && table.columns[0]).toMatch(/名/);
  });

  it("行の無いシートはウィジェットを作らない", () => {
    expect(
      autoLayoutFromProfiles([{ ...sheet(), rowCount: 0 }]),
    ).toEqual([]);
  });
});

describe("未来の日付を持つ表", () => {
  it("完了予定日が全件未来でも、棒グラフに全期間が出る", async () => {
    const { computeDashboard } = await import("@/lib/aggregate");
    const layout = autoLayoutFromProfiles([sheet()]);
    const bar = layout.find((w) => w.type === "bar")!;

    const col = {
      slug: "営業案件管理",
      name: "営業案件管理",
      id: "col-1",
      fields: FIELDS.map((f) => ({ ...f, options: null })),
      records: RECORDS.map((r, i) => ({
        id: `r${i}`,
        data: r as Record<string, unknown>,
        createdAt: new Date("2026-01-01"),
      })),
    };
    // 「今日」を、データより前に置く。以前はここで棒が1本も立たなかった。
    const [computed] = computeDashboard(
      [bar],
      new Map([["営業案件管理", col]]),
      new Date("2026-06-01"),
    );

    expect(computed.data.type).toBe("bar");
    const points = (computed.data as { points: Array<Record<string, unknown>> }).points;
    const nonZero = points.filter((p) => Number(p["提案金額"] ?? 0) > 0);
    // 完了予定日は 2026-08 〜 2026-12 に散らばっている。
    expect(nonZero.length).toBeGreaterThanOrEqual(4);
  });
});
