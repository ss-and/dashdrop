import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { readAllSheets, MAX_IMPORT_COLUMNS } from "@/lib/excel";

// XLSX.read の呼び出し回数を数えるためだけのラッパ（挙動は本物のまま）。
// ESM の名前空間は再定義できず vi.spyOn が使えないため、モジュール単位で包む。
vi.mock("xlsx", async () => {
  const actual = await vi.importActual<typeof import("xlsx")>("xlsx");
  return { ...actual, read: vi.fn(actual.read) };
});

function twoSheetBook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  // 受注日は「本物の日付セル」で作る。以前ここは JS の文字列 "2026-01-05" を
  // 渡していたため、日付セルの経路（既定書式 m/d/yy で "1/5/26" に化ける）を
  // 一度も通っておらず、P0 の不具合をテストが隠していた。
  const s1 = XLSX.utils.aoa_to_sheet(
    [
      ["顧客名", "金額", "受注日"],
      ["山田商事", 100000, new Date(2026, 0, 5)],
      ["佐藤工務店", 250000, new Date(2026, 0, 8)],
    ],
    { cellDates: true },
  );
  const s2 = XLSX.utils.aoa_to_sheet([
    ["担当", "件数"],
    ["中島", 3],
    ["小川", 5],
    ["森田", 2],
  ]);
  const empty = XLSX.utils.aoa_to_sheet([[]]);
  XLSX.utils.book_append_sheet(wb, s1, "受注");
  XLSX.utils.book_append_sheet(wb, s2, "担当別");
  XLSX.utils.book_append_sheet(wb, empty, "空タブ");
  const out = XLSX.write(wb, {
    type: "array",
    bookType: "xlsx",
    cellDates: true,
  });
  return out as ArrayBuffer;
}

/** 非表示シートを1枚含むブック。 */
function bookWithHiddenSheet(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["取引先", "金額"], ["山田商事", 1000]]),
    "売上",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["区分", "係数"], ["A", 1.1]]),
    "作業用",
  );
  wb.Workbook = {
    Sheets: [
      { name: "売上", Hidden: 0 },
      { name: "作業用", Hidden: 1 },
    ],
  };
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("readAllSheets — multi-tab import", () => {
  const sheets = readAllSheets(twoSheetBook());

  it("parses every non-empty sheet and flags empty ones", () => {
    const byName = Object.fromEntries(sheets.map((s) => [s.sheetName, s]));
    expect(byName["受注"].empty).toBe(false);
    expect(byName["担当別"].empty).toBe(false);
    // The blank tab is parsed but flagged empty.
    expect(byName["空タブ"]?.empty ?? true).toBe(true);
  });

  it("reports headers and row counts per sheet", () => {
    const uketsu = sheets.find((s) => s.sheetName === "受注")!;
    expect(uketsu.headers).toEqual(["顧客名", "金額", "受注日"]);
    expect(uketsu.rowCount).toBe(2);

    const tanto = sheets.find((s) => s.sheetName === "担当別")!;
    expect(tanto.headers).toEqual(["担当", "件数"]);
    expect(tanto.rowCount).toBe(3);
  });

  it("infers a field schema per sheet (unique keys, sensible types)", () => {
    const uketsu = sheets.find((s) => s.sheetName === "受注")!;
    const byName = Object.fromEntries(uketsu.inferredFields.map((f) => [f.name, f]));
    expect(byName["金額"].type).toBe("number");
    expect(byName["受注日"].type).toBe("date");
    const keys = uketsu.inferredFields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("returns preview rows keyed by header", () => {
    const uketsu = sheets.find((s) => s.sheetName === "受注")!;
    expect(uketsu.previewRows.length).toBe(2);
    expect(uketsu.previewRows[0]["顧客名"]).toBe("山田商事");
  });
});

describe("readAllSheets — 日付セル", () => {
  it("本物の日付セルを YYYY-MM-DD で返し date 型に推論する", () => {
    const uketsu = readAllSheets(twoSheetBook()).find(
      (s) => s.sheetName === "受注",
    )!;
    expect(uketsu.previewRows[0]["受注日"]).toBe("2026-01-05");
    expect(uketsu.previewRows[1]["受注日"]).toBe("2026-01-08");
    const byName = Object.fromEntries(
      uketsu.inferredFields.map((f) => [f.name, f]),
    );
    expect(byName["受注日"].type).toBe("date");
  });
});

describe("readAllSheets — 非表示シート", () => {
  it("非表示シートに hidden を立てる（既定選択から外せるように）", () => {
    const sheets = readAllSheets(bookWithHiddenSheet());
    const byName = Object.fromEntries(sheets.map((s) => [s.sheetName, s]));
    expect(byName["売上"].hidden).toBe(false);
    expect(byName["作業用"].hidden).toBe(true);
    // 返すこと自体はやめない（取り込みたい利用者もいる）。判断は呼び出し側。
    expect(byName["作業用"].empty).toBe(false);
  });
});

describe("readAllSheets — 打ち切りと上限の申告", () => {
  it("シートごとに truncated / 警告文を返す", () => {
    const wb = XLSX.utils.book_new();
    const aoa: unknown[][] = [["金額"]];
    for (let i = 0; i < 20; i++) aoa.push([String(i)]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "台帳");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const [sheet] = readAllSheets(buf, 5);
    expect(sheet.rowCount).toBe(5);
    expect(sheet.truncated).toBe(true);
    expect(sheet.rowLimit).toBe(5);
    expect(sheet.warnings.some((w) => w.includes("台帳"))).toBe(true);
  });

  it("通常のブックは警告なし・列上限も既定値を返す", () => {
    const uketsu = readAllSheets(twoSheetBook()).find(
      (s) => s.sheetName === "受注",
    )!;
    expect(uketsu.truncated).toBe(false);
    expect(uketsu.warnings).toEqual([]);
    expect(uketsu.columnLimit).toBe(MAX_IMPORT_COLUMNS);
    expect(uketsu.headerRowIndex).toBe(0);
  });
});

describe("readAllSheets — 解析回数", () => {
  it("シート数によらずファイルの解析は1回だけ（N+1 パースの回帰防止）", () => {
    // 以前は parseWorkbook + シートごとの readSheet で、20タブのブックが
    // プレビューだけで21回 XLSX.read されていた。
    const buf = twoSheetBook(); // 3タブ
    const read = vi.mocked(XLSX.read);
    read.mockClear();

    const sheets = readAllSheets(buf);
    expect(sheets.length).toBe(3);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
