import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  readSheet,
  inferFields,
  buildExportWorkbook,
  parseWorkbook,
  sheetWarnings,
  MAX_IMPORT_COLUMNS,
  type ExportField,
  type ExportRecord,
} from "@/lib/excel";
import { coerceValue } from "@/lib/field-types";

/** Helper: build an .xlsx buffer from an array-of-arrays. */
function bufferFromAoa(aoa: unknown[][], sheetName = "Data"): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("readSheet", () => {
  const aoa = [
    ["Name", "Age", "Active", "Price", "Note"],
    ["Alice", 30, true, 1000, "hello"],
    ["Bob", 25, false, 2500, "world"],
  ];
  const buf = bufferFromAoa(aoa, "People");

  it("extracts the header row", () => {
    const res = readSheet(buf);
    expect(res.sheetName).toBe("People");
    expect(res.headers).toEqual(["Name", "Age", "Active", "Price", "Note"]);
  });

  it("maps each data row to an object keyed by header", () => {
    const res = readSheet(buf);
    expect(res.rows).toHaveLength(2);
    // raw:false stringifies every cell on read.
    expect(res.rows[0]).toMatchObject({
      Name: "Alice",
      Age: "30",
      Active: "TRUE",
      Price: "1000",
      Note: "hello",
    });
    expect(res.rows[1].Name).toBe("Bob");
  });

  it("collects per-header non-empty samples", () => {
    const res = readSheet(buf);
    expect(res.sampleByHeader.Name).toEqual(["Alice", "Bob"]);
    expect(res.sampleByHeader.Age).toEqual(["30", "25"]);
  });

  it("skips blank leading rows and finds the real header", () => {
    const withBlanks = [[null, null], [], ["Col A", "Col B"], ["1", "2"]];
    const res = readSheet(bufferFromAoa(withBlanks));
    expect(res.headers).toEqual(["Col A", "Col B"]);
    expect(res.rows).toHaveLength(1);
  });

  it("blank-fills and de-duplicates header names", () => {
    const dup = [["Name", "Name", ""], ["a", "b", "c"]];
    const res = readSheet(bufferFromAoa(dup));
    // second "Name" gets suffixed; blank header becomes 列3
    expect(res.headers[0]).toBe("Name");
    expect(res.headers[1]).toBe("Name-2");
    expect(res.headers[2]).toBe("列3");
  });
});

describe("readSheet — CSV encoding", () => {
  it("decodes a raw UTF-8 CSV (Japanese) without mojibake", () => {
    // Bytes as an exported .csv would arrive over the wire — no BOM.
    const csv = "日付,取引先,金額\n2026-01-05,アオイ,120000\n2026-02-11,ミドリ,80000\n";
    const buf = Buffer.from(csv, "utf-8");
    const res = readSheet(buf);
    expect(res.headers).toEqual(["日付", "取引先", "金額"]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ 取引先: "アオイ", 金額: "120000" });
  });

  it("strips a UTF-8 BOM from the first header", () => {
    const csv = "﻿名前,メモ\n一,フォロー\n";
    const res = readSheet(Buffer.from(csv, "utf-8"));
    expect(res.headers[0]).toBe("名前");
  });

  it("handles an ArrayBuffer CSV the same as a Buffer", () => {
    const csv = "商品,数量\nりんご,3\n";
    const u8 = new TextEncoder().encode(csv);
    const res = readSheet(u8.buffer);
    expect(res.headers).toEqual(["商品", "数量"]);
    expect(res.rows[0]).toMatchObject({ 商品: "りんご", 数量: "3" });
  });
});

describe("inferFields", () => {
  it("returns {name,key,type} with sensible inferred types", () => {
    const aoa = [
      ["Full Name", "Email", "Amount"],
      ["Alice", "alice@x.com", 1000],
      ["Bob", "bob@y.com", 2000],
    ];
    const { headers, sampleByHeader } = readSheet(bufferFromAoa(aoa));
    const fields = inferFields(headers, sampleByHeader);

    expect(fields.map((f) => f.name)).toEqual(["Full Name", "Email", "Amount"]);
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName["Email"].type).toBe("email");
    expect(byName["Amount"].type).toBe("number");
    expect(byName["Full Name"].key).toBe("full_name");
  });

  it("keeps keys unique when labels collapse to the same key", () => {
    const fields = inferFields(
      ["Name", "name", "NAME"],
      { Name: [], name: [], NAME: [] },
    );
    const keys = fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("name");
    expect(keys[1]).toBe("name-2");
    expect(keys[2]).toBe("name-3");
  });
});

describe("buildExportWorkbook", () => {
  const fields: ExportField[] = [
    { key: "title", name: "Title", type: "text" },
    { key: "qty", name: "Quantity", type: "number" },
    { key: "paid", name: "Paid", type: "checkbox" },
    { key: "tags", name: "Tags", type: "multiselect" },
  ];
  const records: ExportRecord[] = [
    { data: { title: "Widget", qty: 42, paid: true, tags: ["a", "b"] } },
    { data: { title: "Gadget", qty: 7, paid: false, tags: ["c"] } },
  ];

  it("returns a Buffer readSheet can round-trip (headers + values survive)", () => {
    const buf = buildExportWorkbook("My Collection", fields, records);
    expect(Buffer.isBuffer(buf)).toBe(true);

    const res = readSheet(buf);
    expect(res.headers).toEqual(["Title", "Quantity", "Paid", "Tags"]);
    expect(res.rows).toHaveLength(2);
    // stringified on read
    expect(res.rows[0]).toMatchObject({
      Title: "Widget",
      Quantity: "42",
      Paid: "TRUE",
      Tags: "a, b",
    });
  });

  it("keeps numbers numeric, checkbox boolean, multiselect joined (raw cell types)", () => {
    const buf = buildExportWorkbook("C", fields, records);
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
    const [, first] = rows;
    expect(first[1]).toBe(42); // number stays numeric
    expect(typeof first[1]).toBe("number");
    expect(first[2]).toBe(true); // checkbox -> boolean
    expect(first[3]).toBe("a, b"); // multiselect -> joined string
  });

  it("sanitises and truncates the sheet name to <=31 chars", () => {
    const buf = buildExportWorkbook("A/B:C*long".padEnd(50, "x"), fields, records);
    const wb = XLSX.read(buf, { type: "array" });
    expect(wb.SheetNames[0].length).toBeLessThanOrEqual(31);
    expect(wb.SheetNames[0]).not.toMatch(/[\\/?*[\]:]/);
  });

  it("handles empty fields / records without throwing", () => {
    const buf = buildExportWorkbook("Empty", [], []);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(() => readSheet(buf)).not.toThrow();
  });
});

describe("parseWorkbook", () => {
  it("lists the sheet names", () => {
    const buf = bufferFromAoa([["A"], ["1"]], "Alpha");
    expect(parseWorkbook(buf).sheets).toEqual(["Alpha"]);
  });

  it("handles a malformed / random buffer gracefully (no throw)", () => {
    const junk = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x10, 0x42]);
    expect(() => parseWorkbook(junk)).not.toThrow();
    expect(Array.isArray(parseWorkbook(junk).sheets)).toBe(true);
  });

  it("handles an empty buffer gracefully (no throw)", () => {
    expect(() => parseWorkbook(Buffer.from([]))).not.toThrow();
    expect(Array.isArray(parseWorkbook(Buffer.from([])).sheets)).toBe(true);
  });
});

/** Helper: .xlsx buffer with real typed cells (Date セルを本物にするため). */
function bufferFromTypedAoa(aoa: unknown[][], sheetName = "Data"): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
    cellDates: true,
  }) as Buffer;
}

describe("readSheet — 日付セル", () => {
  /**
   * 【回帰防止】以前は `sheet_to_json(..., { raw: false })` の整形済みテキストを
   * そのまま採用していた。SheetJS の既定書式は `m/d/yy` なので、受注日
   * 2026/04/01 が文字列 "4/1/26" として DB に入っていた（年が2桁に切れ、
   * 月日が米国順、ソートも集計もできない）。書式に依らず YYYY-MM-DD で届くこと、
   * かつ日付として型付けできることを検証する。
   */
  it("本物の Date セルを YYYY-MM-DD で返す（m/d/yy にしない）", () => {
    const buf = bufferFromTypedAoa([
      ["受注日", "金額"],
      [new Date(2026, 3, 1), 1000],
    ]);
    const res = readSheet(buf);
    expect(res.rows[0]["受注日"]).toBe("2026-04-01");
    expect(res.rows[0]["受注日"]).not.toBe("4/1/26");
  });

  it("表示書式が yyyy/mm/dd でも同じ正規形になる", () => {
    const ws = XLSX.utils.aoa_to_sheet(
      [["受注日"], [new Date(2026, 3, 1)]],
      { cellDates: true },
    );
    ws["A2"].z = "yyyy/mm/dd";
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "D");
    const buf = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx",
      cellDates: true,
    }) as Buffer;
    expect(readSheet(buf).rows[0]["受注日"]).toBe("2026-04-01");
  });

  it("時刻を持つセルは YYYY-MM-DD HH:mm:ss（情報を落とさない）", () => {
    const buf = bufferFromTypedAoa([
      ["登録日時"],
      [new Date(2026, 3, 1, 13, 45, 30)],
    ]);
    expect(readSheet(buf).rows[0]["登録日時"]).toBe("2026-04-01 13:45:30");
  });

  it("ローカル暦日でそろえる（UTC 変換で前日にずらさない）", () => {
    const d = new Date(2026, 3, 1);
    const expected = `${d.getFullYear()}-04-01`;
    const buf = bufferFromTypedAoa([["日付"], [d]]);
    expect(readSheet(buf).rows[0]["日付"]).toBe(expected);
  });

  it("CSV テキストの 2026/04/01 も YYYY-MM-DD になる", () => {
    const csv = "受注日,金額\n2026/04/01,1000\n2026/04/02,2000\n";
    const res = readSheet(Buffer.from(csv, "utf-8"));
    expect(res.rows.map((r) => r["受注日"])).toEqual(["2026-04-01", "2026-04-02"]);
  });

  it("日付列が date 型として推論される", () => {
    const buf = bufferFromTypedAoa([
      ["受注日", "取引先"],
      [new Date(2026, 3, 1), "山田商事"],
      [new Date(2026, 3, 2), "佐藤工務店"],
    ]);
    const { headers, sampleByHeader } = readSheet(buf);
    const byName = Object.fromEntries(
      inferFields(headers, sampleByHeader).map((f) => [f.name, f]),
    );
    expect(byName["受注日"].type).toBe("date");
  });

  it("date として coerce しても日付がずれない", () => {
    const buf = bufferFromTypedAoa([["受注日"], [new Date(2026, 3, 1)]]);
    const raw = readSheet(buf).rows[0]["受注日"];
    expect(coerceValue("date", raw).value).toBe("2026-04-01");
  });
});

describe("readSheet — 列数の上限", () => {
  /**
   * 【回帰防止】列全体に罫線・書式を当てたブックは `!ref` が A1:ZZ100 のように
   * 膨らむ。以前はその範囲をそのまま列数にしていたので、2列のシートから
   * 702 個（A1:XFD200 なら 16,384 個）の見出しとフィールドが作られていた。
   */
  it("水増しされた !ref を無視して実データの列だけ返す", () => {
    const ws = XLSX.utils.aoa_to_sheet([["取引先", "金額"], ["山田商事", "1000"]]);
    ws["!ref"] = "A1:ZZ100";
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Wide");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const res = readSheet(buf);
    expect(res.headers).toEqual(["取引先", "金額"]);
    expect(res.columnsTruncated).toBe(false);
    expect(res.totalColumns).toBe(2);
    expect(res.rows).toHaveLength(1);
  });

  it("Excel の最大列（XFD）まで膨らんだ !ref でも列は増えず、遅くもならない", () => {
    // 行数を抑えているのは fixture 生成（XLSX.write）のコストを下げるため。
    // 列側は Excel の上限 16,384 列そのもの。
    const ws = XLSX.utils.aoa_to_sheet([["A", "B"], ["1", "2"]]);
    ws["!ref"] = "A1:XFD30";
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Huge");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const started = Date.now();
    const res = readSheet(buf);
    // 以前はここで 16,384 個の見出しが作られ、1シートに1.8秒かかっていた。
    expect(res.headers).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("本当に列が多いシートは上限で打ち切り、それを申告する", () => {
    const width = MAX_IMPORT_COLUMNS + 40;
    const header = Array.from({ length: width }, (_, i) => `列見出し${i + 1}`);
    const row = Array.from({ length: width }, (_, i) => String(i));
    const buf = bufferFromAoa([header, row], "Many");

    const res = readSheet(buf);
    expect(res.headers).toHaveLength(MAX_IMPORT_COLUMNS);
    expect(res.columnsTruncated).toBe(true);
    expect(res.totalColumns).toBe(width);
    const warnings = sheetWarnings(res);
    expect(warnings.some((w) => w.includes("列数が上限"))).toBe(true);
  });
});

describe("readSheet — 行数の打ち切り", () => {
  /**
   * 【回帰防止】MAX_IMPORT_ROWS を超える行は黙って捨てられ、呼び出し側は
   * 「成功」としか伝えられなかった（20万行の売上台帳が5万行になっても無警告）。
   */
  function ledger(dataRows: number): Buffer {
    const aoa: unknown[][] = [["取引先", "金額"]];
    for (let i = 0; i < dataRows; i++) aoa.push([`取引先${i}`, String(i)]);
    return bufferFromAoa(aoa, "台帳");
  }

  it("上限を超えたら truncated を立てる（.xlsx）", () => {
    const res = readSheet(ledger(60), undefined, 10);
    expect(res.rows).toHaveLength(10);
    expect(res.truncated).toBe(true);
    expect(res.rowLimit).toBe(10);
  });

  it("ちょうど上限に収まる場合は truncated を立てない", () => {
    const res = readSheet(ledger(10), undefined, 10);
    expect(res.rows).toHaveLength(10);
    expect(res.truncated).toBe(false);
  });

  it("CSV でも打ち切りを検知する", () => {
    const csv = ["金額", "1", "2", "3", "4", "5"].join("\n") + "\n";
    const res = readSheet(Buffer.from(csv, "utf-8"), undefined, 3);
    expect(res.rows).toHaveLength(3);
    expect(res.truncated).toBe(true);
  });

  it("CSV がちょうど収まる場合は truncated を立てない", () => {
    const csv = ["金額", "1", "2", "3"].join("\n") + "\n";
    const res = readSheet(Buffer.from(csv, "utf-8"), undefined, 3);
    expect(res.rows).toHaveLength(3);
    expect(res.truncated).toBe(false);
  });

  it("打ち切りを日本語の警告文にできる", () => {
    const res = readSheet(ledger(60), undefined, 10);
    const warnings = sheetWarnings({ ...res, sheetName: res.sheetName });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("台帳");
    expect(warnings[0]).toContain("上限");
    expect(warnings[0]).toContain("残りの行は取り込まれていません");
  });

  it("打ち切りが無ければ警告は空", () => {
    expect(sheetWarnings(readSheet(ledger(3), undefined, 10))).toEqual([]);
  });
});

describe("readSheet — 見出し行の推定", () => {
  it("タイトル行の下にある本物の見出し行を選ぶ", () => {
    const buf = bufferFromAoa(
      [
        ["2026年度 売上表"],
        [],
        ["取引先", "金額", "担当"],
        ["山田商事", "120000", "中島"],
        ["佐藤工務店", "80000", "小川"],
      ],
      "売上",
    );
    const res = readSheet(buf);
    expect(res.headers).toEqual(["取引先", "金額", "担当"]);
    // 採用した行を外に出す（UI が「3行目を見出しとして認識」と出せる）。
    expect(res.headerRowIndex).toBe(2);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ 取引先: "山田商事", 担当: "中島" });
  });

  it("見出しが1行目にある普通のシートは1行目のまま", () => {
    const res = readSheet(bufferFromAoa([["A", "B"], ["1", "2"]]));
    expect(res.headerRowIndex).toBe(0);
    expect(res.headers).toEqual(["A", "B"]);
  });

  it("一部が空欄の見出し行でも先に来た方を優先する", () => {
    const res = readSheet(
      bufferFromAoa([["取引先", "金額", ""], ["山田商事", "1000", "備考"]]),
    );
    expect(res.headerRowIndex).toBe(0);
    expect(res.headers).toEqual(["取引先", "金額", "列3"]);
    expect(res.rows).toHaveLength(1);
  });
});
