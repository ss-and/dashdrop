/**
 * 日本語の日付が、列の型推論と値の変換の両方で通ることを固定する。
 *
 * 元の不具合: `parseJapaneseNumber` を足したときとまったく同じことが日付でも
 * 起きていた——列の型を「日付」に直すと `2026年4月1日` が全部弾かれて空欄になり、
 * 推論も Date.parse が NaN を返すため text にしかならなかった。日本の帳票の
 * 日付列がまるごと使えず、時系列のグラフが作れない状態だった。
 */
import { describe, it, expect } from "vitest";
import { coerceValue, inferFieldType } from "@/lib/field-types";

describe("coerceValue('date') — 日本語の日付", () => {
  it("「2026年4月1日」を受ける", () => {
    expect(coerceValue("date", "2026年4月1日")).toEqual({
      ok: true,
      value: "2026-04-01",
    });
  });

  it("和暦を受ける", () => {
    expect(coerceValue("date", "令和6年4月1日").value).toBe("2024-04-01");
    expect(coerceValue("date", "平成31年4月30日").value).toBe("2019-04-30");
    expect(coerceValue("date", "令和元年5月1日").value).toBe("2019-05-01");
    expect(coerceValue("date", "R6.4.1").value).toBe("2024-04-01");
  });

  it("明示的に日付型を選んだ場合は、年だけ・年度も受ける", () => {
    expect(coerceValue("date", "2026年").value).toBe("2026-01-01");
    expect(coerceValue("date", "2026年度").value).toBe("2026-04-01");
    expect(coerceValue("date", "令和6年度").value).toBe("2024-04-01");
  });

  it("従来のISO形式は今までどおり", () => {
    expect(coerceValue("date", "2026-04-01").value).toBe("2026-04-01");
    expect(coerceValue("date", "2026-04-01 09:00:00").value).toBe("2026-04-01");
  });

  it("読めないものは今までどおり弾く", () => {
    expect(coerceValue("date", "営業部").ok).toBe(false);
    expect(coerceValue("date", "2026年2月30日").ok).toBe(false);
  });
});

describe("inferFieldType — 日本語の日付列", () => {
  it("「2026年4月1日」の列を日付と推定する", () => {
    expect(inferFieldType(["2026年4月1日", "2026年4月2日", "2026年4月3日"])).toBe(
      "date",
    );
  });

  it("和暦の列を日付と推定する", () => {
    expect(inferFieldType(["令和6年4月1日", "令和6年5月1日", "令和6年6月1日"])).toBe(
      "date",
    );
    expect(inferFieldType(["R6.4.1", "R6.5.1", "R6.6.1"])).toBe("date");
  });

  it("月までの粒度でも日付と推定する", () => {
    expect(inferFieldType(["2026年4月", "2026年5月", "2026年6月"])).toBe("date");
  });

  /**
   * 「2024年 / 2025年 / 2026年」は、日付ではなく年という数量のこともある。
   * 勝手に 2024-01-01 に寄せると意味が変わるので、％を推定では数値にしないのと
   * 同じ判断で、明示的に日付型を選んだときだけ受ける。
   */
  it("年だけ・年度だけの列は推定では日付にしない", () => {
    expect(inferFieldType(["2024年", "2025年", "2026年"])).not.toBe("date");
    expect(inferFieldType(["2024年度", "2025年度", "2026年度"])).not.toBe("date");
  });

  it("従来の推定を壊していない", () => {
    expect(inferFieldType(["2026-04-01", "2026-04-02"])).toBe("date");
    expect(inferFieldType(["営業部", "開発部", "総務部"])).not.toBe("date");
    expect(inferFieldType(["1,234", "5,678"])).toBe("number");
    expect(inferFieldType(["￥1,234", "▲500"])).toBe("currency");
  });

  /**
   * 回帰防止: 「1件でも確実に日付と分かる形があること」という条件が外れると、
   * Date.parse が通してしまう文字列だけの列まで日付になる。
   */
  it("Date.parse が偶然通すだけの列を日付にしない", () => {
    expect(inferFieldType(["May", "June", "July"])).not.toBe("date");
  });
});
