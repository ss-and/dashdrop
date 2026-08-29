/**
 * 定期支払いウィジェットの結線。
 *
 * 判定そのものは tests/recurring.test.ts で固めてあるので、ここで見るのは
 * **画面まで届くか**と、**当たらないシートに置かれないか**の2つだけ。
 *
 * 後者が大事。カード明細の形をしていないシート（大多数）に空の枠が置かれると、
 * どのダッシュボードにも「定期支払い：0件」という無意味な箱が並ぶ。無いより悪い。
 */
import { describe, it, expect } from "vitest";
import { computeWidget, type AggCollection } from "@/lib/aggregate";
import { autoLayoutFromProfiles } from "@/lib/auto-layout";
import { profileFields } from "@/lib/data-profile";
import type { WidgetSpec } from "@/lib/widgets";
import { DEFAULT_INTENT } from "@/lib/dashboard-intent";

const STATEMENT_FIELDS = [
  { key: "riyoubi", name: "ご利用日", type: "date" },
  { key: "tenmei", name: "ご利用先", type: "text" },
  { key: "kingaku", name: "ご利用金額", type: "currency" },
];

/** 明細1行。 */
function row(id: string, date: string, label: string, amount: number) {
  return {
    id,
    createdAt: new Date("2026-01-01"),
    data: { riyoubi: date, tenmei: label, kingaku: amount },
  };
}

/** 毎月10日に同額で n 回。 */
function monthly(label: string, amount: number, startMonth: number, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const m = String(startMonth + i).padStart(2, "0");
    return row(`${label}-${i}`, `2026-${m}-10`, label, amount);
  });
}

function statementCollection(records: AggCollection["records"]): AggCollection {
  return {
    slug: "meisai",
    name: "カード明細",
    fields: STATEMENT_FIELDS,
    records,
  };
}

function mapOf(col: AggCollection) {
  return new Map([[col.slug, col]]);
}

const SPEC: WidgetSpec = {
  id: "r1",
  type: "recurring",
  title: "定期支払い",
  collection: "meisai",
  span: 2,
} as WidgetSpec;

const NOW = new Date(2026, 7, 30); // 2026-08-30

/* ========================================================================== */
describe("computeRecurring — 明細から画面まで", () => {
  it("明細シートから定期支払いを出す", () => {
    const col = statementCollection([
      ...monthly("NETFLIX", 1490, 6, 3),
      ...monthly("SPOTIFY", 980, 6, 3),
      row("x1", "2026-07-03", "コンビニ", 620),
    ]);
    const d = computeWidget(SPEC, mapOf(col), NOW);
    if (d.type !== "recurring") throw new Error("recurring を期待");

    expect(d.notApplicable).toBe(false);
    expect(d.items.map((i) => i.label)).toEqual(["NETFLIX", "SPOTIFY"]);
    expect(d.monthlyTotal).toBe(1490 + 980);
    expect(d.yearlyTotal).toBe((1490 + 980) * 12);
    // 単発の買い物は入らない。
    expect(d.items).toHaveLength(2);
  });

  /**
   * 「見た結果0件」と「そもそも見ていない」は別の状態。同じ顔で出すと、
   * 利用者は「定期支払いが無い」ことを確認できない。
   */
  it("明細の形でないシートは notApplicable で返す（0件とは別）", () => {
    const col: AggCollection = {
      slug: "meisai",
      name: "案件一覧",
      fields: [
        { key: "name", name: "案件名", type: "text" },
        { key: "note", name: "備考", type: "text" },
      ],
      records: [
        { id: "1", createdAt: new Date(), data: { name: "A", note: "x" } },
      ],
    };
    const d = computeWidget(SPEC, mapOf(col), NOW);
    if (d.type !== "recurring") throw new Error("recurring を期待");
    expect(d.notApplicable).toBe(true);
    expect(d.items).toHaveLength(0);
  });

  it("明細はあるが定期支払いが無いときは、0件だが notApplicable ではない", () => {
    const col = statementCollection([
      row("a", "2026-06-01", "コンビニ", 500),
      row("b", "2026-07-14", "書店", 2200),
      row("c", "2026-08-03", "飲食店", 3800),
    ]);
    const d = computeWidget(SPEC, mapOf(col), NOW);
    if (d.type !== "recurring") throw new Error("recurring を期待");
    expect(d.notApplicable).toBe(false);
    expect(d.items).toHaveLength(0);
  });

  it("列を明示すれば、自動判定に頼らずそれを使う", () => {
    const col: AggCollection = {
      slug: "meisai",
      name: "明細",
      fields: [
        { key: "d1", name: "第1の日付", type: "date" },
        { key: "d2", name: "第2の日付", type: "date" },
        { key: "t", name: "なにか", type: "text" },
        { key: "m1", name: "第1の数", type: "currency" },
        { key: "m2", name: "第2の数", type: "currency" },
      ],
      records: monthly("SPOTIFY", 980, 6, 3).map((r) => ({
        ...r,
        data: {
          d1: r.data.riyoubi,
          d2: "2020-01-01",
          t: r.data.tenmei,
          m1: r.data.kingaku,
          m2: 1,
        },
      })),
    };
    // 自動判定では日付も金額も2本ずつあって決められない。
    const auto = computeWidget(SPEC, mapOf(col), NOW);
    if (auto.type !== "recurring") throw new Error("recurring を期待");
    expect(auto.notApplicable).toBe(true);

    const explicit = computeWidget(
      { ...SPEC, dateField: "d1", labelField: "t", amountField: "m1" } as WidgetSpec,
      mapOf(col),
      NOW,
    );
    if (explicit.type !== "recurring") throw new Error("recurring を期待");
    expect(explicit.items).toHaveLength(1);
  });

  it("シートが見つからないときも壊れず notApplicable で返す", () => {
    const d = computeWidget(SPEC, new Map(), NOW);
    if (d.type !== "recurring") throw new Error("recurring を期待");
    expect(d.notApplicable).toBe(true);
    expect(d.monthlyTotal).toBe(0);
  });

  /** 止まったものは一覧に残すが、合計には入れない。 */
  it("止まった支払いは残しつつ、合計から外す", () => {
    const col = statementCollection([
      ...monthly("いま契約中", 1490, 6, 3),
      ...monthly("去年やめた", 5000, 1, 3),
    ]);
    const d = computeWidget(SPEC, mapOf(col), NOW);
    if (d.type !== "recurring") throw new Error("recurring を期待");
    expect(d.items).toHaveLength(2);
    expect(d.endedCount).toBe(1);
    expect(d.monthlyTotal).toBe(1490);
    expect(d.items.find((i) => i.label === "去年やめた")?.active).toBe(false);
  });
});

/* ========================================================================== */
describe("自動作成 — 当たるシートにだけ置く", () => {
  function profiled(
    fields: { key: string; name: string; type: string }[],
    records: Array<Record<string, unknown>>,
  ) {
    return [
      {
        slug: "s",
        name: "明細",
        rowCount: records.length,
        fields: profileFields(records, fields),
      },
    ];
  }

  const STATEMENT_ROWS = Array.from({ length: 12 }, (_, i) => ({
    riyoubi: `2026-${String((i % 8) + 1).padStart(2, "0")}-10`,
    tenmei: i % 2 === 0 ? "NETFLIX" : "コンビニ",
    kingaku: i % 2 === 0 ? 1490 : 600 + i,
  }));

  it("明細の形のシートには定期支払いを置く", () => {
    const layout = autoLayoutFromProfiles(
      profiled(STATEMENT_FIELDS, STATEMENT_ROWS),
      DEFAULT_INTENT,
    );
    expect(layout.map((w) => w.type)).toContain("recurring");
  });

  /**
   * ここが一番大事。当たらないシートに空の枠が置かれると、どのダッシュボードにも
   * 中身の無い箱が並ぶ。列が揃わないシートでは1枚も置かない。
   */
  it("明細の形でないシートには置かない", () => {
    const fields = [
      { key: "案件名", name: "案件名", type: "text" },
      { key: "担当", name: "担当", type: "text" },
      { key: "金額", name: "金額", type: "number" },
      { key: "確度", name: "確度", type: "number" },
    ];
    const rows = Array.from({ length: 12 }, (_, i) => ({
      案件名: `案件${i}`,
      担当: ["佐藤", "鈴木"][i % 2],
      金額: 100000 + i * 1000,
      確度: (i % 5) * 20,
    }));
    const layout = autoLayoutFromProfiles(profiled(fields, rows), DEFAULT_INTENT);
    expect(layout.map((w) => w.type)).not.toContain("recurring");
  });

  /**
   * 【回帰】定期支払いを枚数を絞ったあと（`capped`）に押し込んでいたため、
   * 「上に見せる」の上限を1枚ぶん超えていた。押し込むぶんは誰も数えていない。
   * 明細表と同じ扱い（`aud.detail`）に揃えて直した。
   */
  it("明細を載せない読み手（上に見せる）には置かず、上限も超えない", () => {
    const layout = autoLayoutFromProfiles(profiled(STATEMENT_FIELDS, STATEMENT_ROWS), {
      ...DEFAULT_INTENT,
      audience: "exec",
    });
    expect(layout.map((w) => w.type)).not.toContain("recurring");
    expect(layout.map((w) => w.type)).not.toContain("table");
  });
});
