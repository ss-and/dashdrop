/**
 * 入力エラーの日本語化。
 *
 * 実際にあった不具合の回帰テスト: 全画面が日本語なのに、入力エラーだけ
 * 「name: String must contain at least 1 character(s)」のような英語が
 * そのまま利用者に出ていた。Zod の既定文言と、見出しに使う内部キーの
 * 両方が英語だった。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { z } from "zod";
import { installJapaneseZodMessages, fieldLabelForPath } from "@/lib/zod-ja";

beforeAll(() => {
  installJapaneseZodMessages();
});

/** 最初の issue の文言。 */
function messageOf(schema: z.ZodTypeAny, value: unknown): string {
  const res = schema.safeParse(value);
  expect(res.success).toBe(false);
  if (res.success) throw new Error("unreachable");
  return res.error.issues[0].message;
}

const ASCII_ONLY = /^[\x20-\x7e]*$/;

describe("Zod の既定メッセージ", () => {
  it("英語の既定文言が利用者に出ない", () => {
    const cases: Array<[z.ZodTypeAny, unknown]> = [
      [z.string().min(1), ""],
      [z.string().max(80), "あ".repeat(81)],
      [z.string(), 123],
      [z.string(), undefined],
      [z.number(), "abc"],
      [z.number().min(1), 0],
      [z.number().max(10), 11],
      [z.number().finite(), Infinity],
      [z.boolean(), "yes"],
      [z.enum(["a", "b"]), "c"],
      [z.string().email(), "not-an-email"],
      [z.string().url(), "not a url"],
      [z.array(z.string()).min(1), []],
      [z.array(z.string()).max(2), ["a", "b", "c"]],
      [z.object({ a: z.string() }), {}],
    ];
    for (const [schema, value] of cases) {
      const msg = messageOf(schema, value);
      expect(msg, JSON.stringify(value)).not.toMatch(ASCII_ONLY);
      expect(msg).not.toContain("String must");
      expect(msg).not.toContain("Expected");
      expect(msg).not.toContain("Required");
      expect(msg).not.toContain("Invalid");
    }
  });

  it("よくある文言がそのまま読める", () => {
    expect(messageOf(z.string().min(1), "")).toBe("入力してください");
    expect(messageOf(z.string().max(80), "あ".repeat(81))).toBe(
      "80文字以内で入力してください",
    );
    expect(messageOf(z.string(), 42)).toBe("文字列で入力してください");
    expect(messageOf(z.string().email(), "x")).toBe(
      "メールアドレスの形式で入力してください",
    );
    expect(messageOf(z.array(z.string()).max(2), ["a", "b", "c"])).toBe(
      "2件以内で入力してください",
    );
  });

  it("スキーマ側で書いた日本語が優先される", () => {
    const schema = z.string().min(1, "スプレッドシートを選択してください");
    expect(messageOf(schema, "")).toBe("スプレッドシートを選択してください");
  });
});

describe("見出しの日本語化", () => {
  it("知っているキーは日本語になる", () => {
    expect(fieldLabelForPath(["name"])).toBe("名前");
    expect(fieldLabelForPath(["operator"])).toBe("条件");
    expect(fieldLabelForPath(["data", "webhookUrl"])).toBe("Webhook URL");
    expect(fieldLabelForPath(["metric", "measure"])).toBe("集計方法");
  });

  it("訳が無いキーは見出しを付けない（英語を見せない）", () => {
    expect(fieldLabelForPath(["someInternalKey"])).toBeNull();
    expect(fieldLabelForPath([])).toBeNull();
    expect(fieldLabelForPath(["data"])).toBeNull();
    expect(fieldLabelForPath([0])).toBeNull();
  });
});
