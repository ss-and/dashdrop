/**
 * CSV の文字コード判定テスト。
 *
 * 【回帰防止】以前 `toWorkbook` は CSV を無条件に UTF-8 としてデコードしていた。
 * 日本語 Windows の Excel が「CSV (カンマ区切り)」で書き出すのは CP932 なので、
 * 日本の中小企業が最も普通に渡してくるファイルの列名が「��t」のように
 * 文字化けし、そのまま 200 で取り込まれてフィールドキーまで壊れていた。
 *
 * ここでは文字列ではなく「実バイト列」を食わせ、デコード後の日本語そのものを
 * 検証する（例外が出ないことの確認では、この不具合は素通りする）。
 */
import { describe, it, expect } from "vitest";
import { readSheet, decodeDelimitedText } from "@/lib/excel";
import { ApiError } from "@/lib/errors";

/**
 * 日本語 Windows の Excel が書き出す CP932 の CSV そのもの。
 *   日付,取引先,金額
 *   2026/04/01,山田商事,120000
 *   2026/04/02,佐藤工務店,80000
 * 改行は CRLF。
 */
const CP932_CSV = Buffer.from([
  0x93, 0xfa, 0x95, 0x74, 0x2c, 0x8e, 0xe6, 0x88, 0xf8, 0x90, 0xe6, 0x2c,
  0x8b, 0xe0, 0x8a, 0x7a, 0x0d, 0x0a, 0x32, 0x30, 0x32, 0x36, 0x2f, 0x30,
  0x34, 0x2f, 0x30, 0x31, 0x2c, 0x8e, 0x52, 0x93, 0x63, 0x8f, 0xa4, 0x8e,
  0x96, 0x2c, 0x31, 0x32, 0x30, 0x30, 0x30, 0x30, 0x0d, 0x0a, 0x32, 0x30,
  0x32, 0x36, 0x2f, 0x30, 0x34, 0x2f, 0x30, 0x32, 0x2c, 0x8d, 0xb2, 0x93,
  0xa1, 0x8d, 0x48, 0x96, 0xb1, 0x93, 0x58, 0x2c, 0x38, 0x30, 0x30, 0x30,
  0x30, 0x0d, 0x0a,
]);

/** 課題文にあった見出しだけのバイト列（日付,取引先,金額 + CRLF）。 */
const CP932_HEADER_ONLY = Buffer.from([
  0x93, 0xfa, 0x95, 0x74, 0x2c, 0x8e, 0xe6, 0x88, 0xf8, 0x90, 0xe6, 0x2c,
  0x8b, 0xe0, 0x8a, 0x7a, 0x0d, 0x0a,
]);

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

describe("実行環境の前提", () => {
  it("Node の TextDecoder が shift_jis(CP932) を扱える", () => {
    // 使えない環境では excel.ts は黙って UTF-8 にフォールバックせず、
    // 日本語のエラーで止める設計。ここはその前提の明示。
    const decoder = new TextDecoder("shift_jis", { fatal: true });
    expect(decoder.encoding).toBe("shift_jis");
    expect(decoder.decode(Uint8Array.from([0x93, 0xfa]))).toBe("日");
  });
});

describe("decodeDelimitedText — 文字コードの判定", () => {
  it("CP932 を shift_jis と判定して正しく読む", () => {
    const { text, encoding } = decodeDelimitedText(CP932_CSV);
    expect(encoding).toBe("shift_jis");
    expect(text.startsWith("日付,取引先,金額")).toBe(true);
    expect(text).toContain("佐藤工務店");
  });

  it("BOM 付き UTF-8 を UTF-8 と判定し BOM を落とす", () => {
    const data = Buffer.concat([UTF8_BOM, Buffer.from("名前,メモ\n一,フォロー\n", "utf-8")]);
    const { text, encoding } = decodeDelimitedText(data);
    expect(encoding).toBe("utf-8");
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text.startsWith("名前,メモ")).toBe(true);
  });

  it("BOM 無し UTF-8 を UTF-8 と判定する", () => {
    const { text, encoding } = decodeDelimitedText(
      Buffer.from("商品,数量\nりんご,3\n", "utf-8"),
    );
    expect(encoding).toBe("utf-8");
    expect(text.startsWith("商品,数量")).toBe(true);
  });

  it("BOM 付き UTF-16LE（Excel の Unicode テキスト）を読む", () => {
    const data = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("日付,金額\r\n2026/04/01,120000\r\n", "utf16le"),
    ]);
    const { text, encoding } = decodeDelimitedText(data);
    expect(encoding).toBe("utf-16le");
    expect(text.startsWith("日付,金額")).toBe(true);
  });

  it("BOM 付き UTF-16BE を読む", () => {
    const le = Buffer.from("日付,金額\r\n", "utf16le");
    const be = Buffer.alloc(le.length);
    for (let i = 0; i < le.length; i += 2) {
      be[i] = le[i + 1];
      be[i + 1] = le[i];
    }
    const data = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
    const { text, encoding } = decodeDelimitedText(data);
    expect(encoding).toBe("utf-16be");
    expect(text.startsWith("日付,金額")).toBe(true);
  });

  it("BOM 無しの UTF-16LE も NUL バイトの偏りから読む", () => {
    const data = Buffer.from("date,amount\r\n2026/04/01,120000\r\n", "utf16le");
    const { text, encoding } = decodeDelimitedText(data);
    expect(encoding).toBe("utf-16le");
    expect(text.startsWith("date,amount")).toBe(true);
  });

  it("UTF-8 を CP932 より先に判定する（UTF-8 が CP932 として化けない）", () => {
    // CP932 デコーダは UTF-8 のバイト列も「読めてしまう」ため、判定順が逆だと
    // UTF-8 の日本語が黙って文字化けする。順序そのものを固定するテスト。
    const utf8 = Buffer.from("日付,取引先,金額\n", "utf-8");
    expect(decodeDelimitedText(utf8).encoding).toBe("utf-8");
    expect(decodeDelimitedText(utf8).text.startsWith("日付,取引先,金額")).toBe(true);
  });

  it("空バッファは空文字（例外にしない）", () => {
    expect(decodeDelimitedText(Buffer.from([]))).toEqual({ text: "", encoding: "utf-8" });
  });

  it("どの文字コードでも読めないバイト列は日本語のエラーで止める", () => {
    // 0xFF は UTF-8 でも CP932 でも不正。文字化けを通さず ApiError にする。
    const broken = Buffer.from([0x41, 0xff, 0x42]);
    expect(() => decodeDelimitedText(broken)).toThrow(ApiError);
    try {
      decodeDelimitedText(broken);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.status).toBe(422);
      expect(e.message).toContain("文字コード");
      expect(e.message).toContain("UTF-8");
    }
  });
});

describe("readSheet — CP932 の CSV", () => {
  it("課題のバイト列の見出しを 日付/取引先/金額 として読む", () => {
    const res = readSheet(CP932_HEADER_ONLY);
    expect(res.headers).toEqual(["日付", "取引先", "金額"]);
  });

  it("データ行の日本語も化けない", () => {
    const res = readSheet(CP932_CSV);
    expect(res.headers).toEqual(["日付", "取引先", "金額"]);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ 取引先: "山田商事", 金額: "120000" });
    expect(res.rows[1]).toMatchObject({ 取引先: "佐藤工務店", 金額: "80000" });
    // 置換文字（U+FFFD）が1つでも混ざっていたら文字化けしている。
    expect(JSON.stringify(res)).not.toContain("�");
  });

  it("CP932 の日付も正規化された YYYY-MM-DD になる", () => {
    const res = readSheet(CP932_CSV);
    expect(res.rows[0]["日付"]).toBe("2026-04-01");
    expect(res.rows[1]["日付"]).toBe("2026-04-02");
  });

  it("BOM 付き UTF-8 CSV の先頭見出しに BOM が残らない", () => {
    const data = Buffer.concat([
      UTF8_BOM,
      Buffer.from("日付,取引先,金額\r\n2026/04/01,山田商事,120000\r\n", "utf-8"),
    ]);
    const res = readSheet(data);
    expect(res.headers).toEqual(["日付", "取引先", "金額"]);
    expect(res.rows[0]).toMatchObject({ 取引先: "山田商事" });
  });

  it("UTF-16LE CSV も同じ結果になる", () => {
    const data = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("日付,取引先,金額\r\n2026/04/01,山田商事,120000\r\n", "utf16le"),
    ]);
    const res = readSheet(data);
    expect(res.headers).toEqual(["日付", "取引先", "金額"]);
    expect(res.rows[0]).toMatchObject({ 取引先: "山田商事", 日付: "2026-04-01" });
  });

  it("ArrayBuffer で渡しても CP932 判定は同じ", () => {
    const ab = CP932_CSV.buffer.slice(
      CP932_CSV.byteOffset,
      CP932_CSV.byteOffset + CP932_CSV.byteLength,
    );
    const res = readSheet(ab);
    expect(res.headers).toEqual(["日付", "取引先", "金額"]);
  });
});
