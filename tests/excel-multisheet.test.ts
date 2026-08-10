import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readAllSheets } from "@/lib/excel";

function twoSheetBook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.aoa_to_sheet([
    ["顧客名", "金額", "受注日"],
    ["山田商事", 100000, "2026-01-05"],
    ["佐藤工務店", 250000, "2026-01-08"],
  ]);
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
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out as ArrayBuffer;
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
