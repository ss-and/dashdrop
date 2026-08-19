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

  /**
   * 回帰テスト: 「12種類以上の文字」を要求していたため、
   * `openssl rand -hex 16`（32文字・16進なので使える文字は16種類）が
   * 約1.7%の確率で拒否され、真っ当な128ビットの鍵で本番が起動しなくなっていた。
   * 運用者から見ると「チェックが壊れている」としか見えない。
   */
  it("openssl rand -hex 16 相当の値を1つも拒否しない", () => {
    const HEX = "0123456789abcdef";
    let rejected = 0;
    // 決定的な擬似乱数（テストを揺らさないため）。
    let seed = 12345;
    // 下位ビットは周期が短く偏るので、上位ビットだけを使う。
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor(seed / 65536);
    };
    for (let i = 0; i < 20000; i++) {
      let secret = "";
      for (let j = 0; j < 32; j++) secret += HEX[next() % 16];
      if (!isStrongSecret(secret)) rejected++;
    }
    expect(rejected).toBe(0);
  });

  it("反復的な値は長さが足りていても拒否する", () => {
    expect(isStrongSecret("abababababababababababababababab")).toBe(false);
    expect(isStrongSecret("abcd".repeat(8))).toBe(false);
    // 1文字が過半数を占める。
    expect(
      isStrongSecret("a".repeat(40) + "bcdefghijklmnopqrstuvwxyz"),
    ).toBe(false);
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
