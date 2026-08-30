/**
 * ビルドが、本番のDBに合ったPrismaクライアントを作るか。
 *
 * 【回帰】`npm run build` が `prisma generate` を **--schema なし**で叩いていた。
 * `prisma/schema.prisma` の provider は `sqlite` のリテラル固定なので、
 * Vercel 上のビルドは**必ず SQLite 用のクライアント**を生成する。
 * 本番の `DATABASE_URL` は `postgresql://…` なので、
 *
 *   ビルドは成功する → デプロイも成功する → 起動もする
 *   → **最初のDBクエリで全部落ちる**
 *
 * 型でもテストでもビルドでも捕まらない。落ちるのは本番の1リクエスト目で、
 * しかも「1人も登録できない」という形で落ちる。公開当日に踏むと丸1日溶ける。
 *
 * `provider` は文字列リテラルしか受け付けず `env()` が使えないため、
 * `scripts/db-provider.mjs` が写しを作る仕組みになっている。
 * **その写しをビルド経路が使っていなかった**のが原因。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

describe("ビルドが本番のDBに合ったクライアントを作る", () => {
  it("build は db-provider.mjs を通してからクライアントを生成する", () => {
    const build = pkg.scripts.build;
    expect(build).toContain("db-provider.mjs");
    expect(build).toContain("--schema prisma/schema.generated.prisma");
  });

  /**
   * 素の `prisma generate`（--schema なし）が残っていたら、それは
   * sqlite 固定のスキーマを読むということ。ビルド経路には置けない。
   */
  it("build に --schema の無い prisma generate が残っていない", () => {
    const build = pkg.scripts.build;
    // "prisma generate" のうしろに --schema が続かない形を探す。
    expect(build).not.toMatch(/prisma generate(?!\s+--schema)/);
  });

  /**
   * 元のスキーマが sqlite 固定であること自体は正しい（手元はSQLiteで動かす）。
   * ここが postgresql に書き換えられていたら、手元の開発が壊れる代わりに
   * 上の仕組みが不要になっている、という別の状態なので気づけるようにする。
   */
  it("元のスキーマは sqlite のまま（手元の開発用）", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const m = /datasource\s+db\s*\{[^}]*?provider\s*=\s*"([^"]+)"/s.exec(schema);
    expect(m?.[1]).toBe("sqlite");
  });

  /**
   * 実際に写しを作らせて、provider が入れ替わることを確かめる。
   * ここが動かなければ、上の2つが通っていても本番は SQLite のままになる。
   */
  it("DATABASE_PROVIDER=postgresql で、写しの provider が postgresql になる", () => {
    const out = execFileSync("node", ["scripts/db-provider.mjs"], {
      env: { ...process.env, DATABASE_PROVIDER: "postgresql" },
      encoding: "utf8",
    }).trim();
    const generated = readFileSync(out, "utf8");
    const m = /datasource\s+db\s*\{[^}]*?provider\s*=\s*"([^"]+)"/s.exec(generated);
    expect(m?.[1]).toBe("postgresql");

    // 生成側だけを書き換えていること（generator の provider は触らない）。
    expect(generated).toContain('provider = "prisma-client-js"');
  });

  it("DATABASE_PROVIDER 未設定なら sqlite（手元の既定を壊さない）", () => {
    const env = { ...process.env };
    delete env.DATABASE_PROVIDER;
    const out = execFileSync("node", ["scripts/db-provider.mjs"], {
      env,
      encoding: "utf8",
    }).trim();
    const generated = readFileSync(out, "utf8");
    const m = /datasource\s+db\s*\{[^}]*?provider\s*=\s*"([^"]+)"/s.exec(generated);
    expect(m?.[1]).toBe("sqlite");
  });
});
