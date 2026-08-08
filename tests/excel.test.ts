import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  readSheet,
  inferFields,
  buildExportWorkbook,
  parseWorkbook,
  type ExportField,
  type ExportRecord,
} from "@/lib/excel";

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
