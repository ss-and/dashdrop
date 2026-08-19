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
import { isStrongSecret, isPublicAppUrl } from "@/lib/env";

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

  /**
   * 回帰テスト: hex32 を通すために条件を緩めたとき、緩めすぎて
   * "password1password1password1passw" のような値まで通していた。
   * この述語は本番起動を止める最後の砦で、連携トークンの暗号鍵の
   * 導出元でもあるので、通してよい値ではない。
   */
  it("いかにも人が考えた弱い値を拒否する", () => {
    for (const weak of [
      "password1password1password1passw",
      "hunter2hunter2hunter2hunter2hunt",
      "secretsecretsecretsecretsecretse",
      "dashdrop-dashdrop-dashdrop-dashd",
      "abcdeabcdeabcdeabcdeabcdeabcdeab",
    ]) {
      expect(isStrongSecret(weak), weak).toBe(false);
    }
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

/**
 * APP_URL の妥当性判定。
 *
 * APP_URL は通知の「開く」リンクの土台（src/lib/notify.ts の absoluteUrl）で、
 * 未設定でも既定の "http://localhost:3000" で黙って起動してしまうため、
 * 設定を忘れたデプロイは通知のリンクが全部死んだまま誰にも気づかれない。
 * AUTH_SECRET と同じく、本番では起動時に落とすための判定。
 */
describe("APP_URL public-URL rule", () => {
  it("受信者が開けないURLを拒否する", () => {
    for (const bad of [
      "",
      "not-a-url",
      "localhost:3000", // スキーム無しはURLとして解釈できない
      "http://localhost:3000", // 既定値そのもの（設定忘れ）
      "https://localhost",
      "http://api.localhost:3000",
      "http://127.0.0.1:3000",
      "http://127.1.2.3",
      "http://0.0.0.0:3000",
      "http://[::1]:3000",
      "http://[::]:3000",
      "http://[::ffff:127.0.0.1]:3000",
      "ftp://dashdrop.example.com", // 通知から開けない
      "file:///var/www",
    ]) {
      expect(isPublicAppUrl(bad), bad).toBe(false);
    }
  });

  it("公開されたデプロイのURLを受け入れる", () => {
    for (const good of [
      "https://dashdrop.example.com",
      "https://dashdrop.example.com/",
      "https://app.dashdrop.example.com:8443",
      "https://example.co.jp/dashdrop",
      "http://dashdrop.example.com", // http のみの構成も止めない
      // 社内向けの自己ホスト。サーバ自身以外からも開けるので通す。
      "http://192.168.1.10:3000",
      "http://dashdrop.internal:3000",
    ]) {
      expect(isPublicAppUrl(good), good).toBe(true);
    }
  });

  /**
   * 回帰テスト: .env.example をそのままコピーしたデプロイが本番起動できると、
   * 全ての通知リンクが localhost を指したまま出荷される。
   */
  it(".env.example の APP_URL は本番向けとして拒否される", () => {
    const line = readFileSync(".env.example", "utf8")
      .split("\n")
      .find((l) => l.startsWith("APP_URL="));
    expect(line).toBeTruthy();
    const value = line!.replace(/^APP_URL=/, "").replace(/^"|"$/g, "");
    expect(isPublicAppUrl(value)).toBe(false);
  });
});
