/**
 * CSV の「実際にあるいろいろな形」を通す。
 *
 * CSV は .xlsx とは別の入口（文字コードの判定と、日付・数値の読み直し）を通る。
 * ここで過去に壊れたのは、どれも例外を出さずに**静かに間違った値になる**類だった。
 *
 *   - CP932 の列名が「��t」に化けたまま 200 で取り込まれる
 *   - 「2026/04/01」が JST で1日ずれる／「4/1/24」に化ける
 *   - 引用符の中のカンマで列がずれる
 *
 * いちばん強い不変条件は「**同じ内容なら、文字コードや改行が違っても同じに
 * 読める**」。これを種を変えて何度も確かめる。
 */
import { describe, it, expect } from "vitest";
import { readSheet, decodeDelimitedText } from "@/lib/excel";
import { coerceValue } from "@/lib/field-types";
import { inferFields } from "@/lib/excel";
import { encodeCp932, unencodableIn932 } from "./helpers/cp932";

/* ------------------------------ 乱数 ------------------------------------ */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------ 生成 ------------------------------------ */

const HEADERS = [
  ["日付", "取引先", "金額", "備考"],
  ["受注日", "顧客名", "フェーズ", "提案金額", "担当"],
  ["登録日", "氏名", "部署", "単価", "数量", "メモ"],
];

const PARTNERS = ["山田商事", "佐藤工務店", "高橋物流", "株式会社ガイド", "パーセント商会"];
const PHASES = ["受注", "商談中", "見積提出", "失注"];

/** CSV の1セルを、必要なら引用符でくるむ。 */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

interface CsvPlan {
  headers: string[];
  rows: string[][];
  /** 各行の日付（YYYY-MM-DD）。ずれの検出に使う。 */
  isoDates: string[];
  eol: "\n" | "\r\n";
  trailingNewline: boolean;
}

function planCsv(seed: number): CsvPlan {
  const r = rng(seed);
  const int = (min: number, max: number) => min + Math.floor(r() * (max - min + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const chance = (p: number) => r() < p;

  const headers = [...pick(HEADERS)];
  const rowCount = int(1, 25);
  // 日付の書き方。Excel が書き出す形をひととおり。
  const dateStyle = pick(["iso", "slash", "slashPadded", "dot"] as const);
  const numberStyle = pick(["raw", "comma", "yen"] as const);

  const rows: string[][] = [];
  const isoDates: string[] = [];

  for (let i = 0; i < rowCount; i++) {
    // 2026-01-05 から11日おき。月またぎ・年またぎを必ず含む。
    const d = new Date(Date.UTC(2026, 0, 5) + i * 11 * 86400000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    isoDates.push(iso);

    const dateText =
      dateStyle === "iso"
        ? iso
        : dateStyle === "slash"
          ? `${y}/${m}/${day}`
          : dateStyle === "slashPadded"
            ? `${y}/${String(m).padStart(2, "0")}/${String(day).padStart(2, "0")}`
            : `${y}.${m}.${day}`;

    const amount = (i + 1) * 12345;
    const amountText =
      numberStyle === "comma"
        ? amount.toLocaleString("en-US")
        : numberStyle === "yen"
          ? // 全角の￥。日本語 Excel が CP932 で書き出すのはこちら
            // （半角の ¥ は CP932 の対応表に無い）。
            `￥${amount.toLocaleString("en-US")}`
          : String(amount);

    const row: string[] = [];
    for (const h of headers) {
      if (/日$/.test(h) || h === "日付") row.push(dateText);
      else if (/金額|単価/.test(h)) row.push(amountText);
      else if (h === "数量") row.push(String((i % 7) + 1));
      else if (h === "フェーズ") row.push(PHASES[i % PHASES.length]);
      else if (/取引先|顧客名|氏名/.test(h)) row.push(PARTNERS[i % PARTNERS.length]);
      else if (/備考|メモ/.test(h)) {
        // 引用符・カンマ・改行を含むセル。列がずれる典型。
        row.push(
          chance(0.3)
            ? '値に "引用符" と, カンマ'
            : chance(0.3)
              ? "1行目\n2行目"
              : `メモ${i}`,
        );
      } else row.push(`${h}${i % 5}`);
    }
    rows.push(row);
  }

  return {
    headers,
    rows,
    isoDates,
    eol: chance(0.5) ? "\r\n" : "\n",
    trailingNewline: chance(0.7),
  };
}

function serialise(plan: CsvPlan): string {
  const lines = [
    plan.headers.map(csvCell).join(","),
    ...plan.rows.map((r) => r.map(csvCell).join(",")),
  ];
  return lines.join(plan.eol) + (plan.trailingNewline ? plan.eol : "");
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

type Encoding = "utf-8" | "utf-8-bom" | "utf-16le" | "cp932";

function encode(text: string, enc: Encoding): Buffer {
  switch (enc) {
    case "utf-8-bom":
      return Buffer.concat([UTF8_BOM, Buffer.from(text, "utf-8")]);
    case "utf-16le":
      return Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(text, "utf16le"),
      ]);
    case "cp932":
      return encodeCp932(text);
    default:
      return Buffer.from(text, "utf-8");
  }
}

/** 読み取り結果を、比較しやすい素の形にする。 */
function readAsRecords(buffer: Buffer) {
  const parsed = readSheet(buffer);
  const fields = inferFields(parsed.headers, parsed.sampleByHeader);
  const records = parsed.rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const res = coerceValue(f.type, row[f.name] ?? null);
      out[f.key] = res.ok ? res.value : null;
    }
    return out;
  });
  return { headers: parsed.headers, fields, records };
}

/* ------------------------------ 実行 ------------------------------------ */

const BASE_SEED = Number(process.env.FUZZ_SEED ?? 1);
const CASES = Number(process.env.FUZZ_CASES ?? 150);

describe(`CSVのいろいろな形（seed ${BASE_SEED}〜${BASE_SEED + CASES - 1}）`, () => {
  const seeds = Array.from({ length: CASES }, (_, i) => BASE_SEED + i);

  it.each(seeds)("seed %i — 文字コードが違っても同じに読める", (seed) => {
    const plan = planCsv(seed);
    const text = serialise(plan);

    // CP932 で表せない文字を混ぜてしまうと、比較の前提が崩れる。
    expect(unencodableIn932(text), `seed=${seed}: CP932外の文字`).toBeNull();

    const encodings: Encoding[] = ["utf-8", "utf-8-bom", "utf-16le", "cp932"];
    const results = encodings.map((enc) => ({
      enc,
      ...readAsRecords(encode(text, enc)),
    }));

    const base = results[0];

    // 列名がそのまま読めていること（化けていれば必ずここで落ちる）。
    expect(base.headers, `seed=${seed}: 列名が変わった`).toEqual(plan.headers);
    expect(base.records.length, `seed=${seed}: 行数が合わない`).toBe(plan.rows.length);

    for (const other of results.slice(1)) {
      expect(other.headers, `seed=${seed}: ${other.enc} で列名が違う`).toEqual(
        base.headers,
      );
      expect(other.records, `seed=${seed}: ${other.enc} で中身が違う`).toEqual(
        base.records,
      );
    }

    // 日付が1日もずれていないこと。
    const dateField = base.fields.find((f) => f.type === "date");
    if (dateField) {
      base.records.forEach((rec, i) => {
        const v = rec[dateField.key];
        if (v === null) return;
        expect(String(v), `seed=${seed}: ${i}行目の日付がずれた`).toBe(plan.isoDates[i]);
      });
    }

    // 引用符の中のカンマ・改行で列がずれていないこと。
    const noteHeader = plan.headers.find((h) => /備考|メモ/.test(h));
    if (noteHeader) {
      const key = base.fields.find((f) => f.name === noteHeader)!.key;
      base.records.forEach((rec, i) => {
        expect(String(rec[key] ?? ""), `seed=${seed}: ${i}行目の備考がずれた`).toBe(
          plan.rows[i][plan.headers.indexOf(noteHeader)],
        );
      });
    }

    // 金額が数値として読めていること（「¥1,234」でも）。
    const amountHeader = plan.headers.find((h) => /金額|単価/.test(h));
    if (amountHeader) {
      const f = base.fields.find((x) => x.name === amountHeader)!;
      base.records.forEach((rec, i) => {
        const v = rec[f.key];
        if (f.type === "number" || f.type === "currency") {
          expect(v, `seed=${seed}: ${i}行目の金額が数値でない`).toBe((i + 1) * 12345);
        }
      });
    }
  });
});

describe("文字コードの判定そのもの", () => {
  it("同じ日本語を4通りの符号化で書いても、同じ文字列に戻る", () => {
    const text = "日付,取引先,金額\r\n2026/04/01,株式会社ガイド,120000\r\n";
    for (const enc of ["utf-8", "utf-8-bom", "utf-16le", "cp932"] as const) {
      const { text: back } = decodeDelimitedText(encode(text, enc));
      expect(back, `${enc} で読み違えた`).toBe(text);
    }
  });
});
