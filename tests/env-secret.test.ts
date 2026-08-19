/**
 * AUTH_SECRET の強度判定。
 *
 * 実際にあった不具合の回帰テスト: `.env.example` のプレースホルダ
 * "change-me-to-a-long-random-string-min-32-chars" は 46 文字あるため、
 * 「32文字以上」しか見ていなかった旧判定を通過し、公開リポジトリの値のまま
 * 本番が起動できてしまっていた。AUTH_SECRET は JWT 署名鍵であり、連携トークンの
 * 暗号鍵の導出元でもあるので、これは全テナントの侵害に直結する。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isStrongSecret } from "@/lib/env";

describe("AUTH_SECRET strength", () => {
  it("弱い値を拒否する", () => {
    for (const weak of [
      "",
      "short",
      "change-me-to-a-long-random-string-min-32-chars",
      "CHANGE-ME-TO-A-LONG-RANDOM-STRING-MIN-32-CHARS",
      "dev-insecure-secret-change-me",
      "dev-only-secret-aaaaaaaaaaaaaaaaaaaaaaaa",
      "your-secret-here-your-secret-here-your-secret",
      "placeholder-placeholder-placeholder-xxxx",
      "a".repeat(64),
      "abababababababababababababababababab",
    ]) {
      expect(isStrongSecret(weak), weak).toBe(false);
    }
  });

  it("本物のランダム値を受け入れる", () => {
    for (const strong of [
      "hVQ2f8mZ0pKx9dLr3TnYaW7uCbE5sJgM1oPq4RiXvNzD6kHt",
      "9f4c1b7e2a8d0356cf91be47a2d8503617fc9e4b0d2a8f61",
    ]) {
      expect(isStrongSecret(strong), strong).toBe(true);
    }
  });

  it(".env.example の値はプレースホルダとして拒否される", () => {
    const line = readFileSync(".env.example", "utf8")
      .split("\n")
      .find((l) => l.startsWith("AUTH_SECRET="));
    expect(line).toBeTruthy();
    const value = line!.replace(/^AUTH_SECRET=/, "").replace(/^"|"$/g, "");
    expect(isStrongSecret(value)).toBe(false);
  });
});
