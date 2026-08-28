/**
 * 本番デプロイで「黙って壊れる」設定を、起動前に落とすためのガード。
 *
 * AUTH_SECRET / APP_URL のガード（tests/env-secret.test.ts）と同じ趣旨だが、
 * DATABASE_URL の穴はもっとたちが悪かった。既定値が "file:./dev.db" のままでも
 * 例外もログも出ずにアプリが起動し、SQLite がサーバーレスの一時ファイルシステムに
 * 作られる。サインアップも取り込みも成功したように見えて、インスタンスが
 * 破棄された時点で全部消える——お客さまに言われるまで誰も気づけない種類の事故。
 *
 * あわせて、同じ穴の別の入口（初回マイグレーションの不在、本番へのデモseed、
 * .env.example の記載漏れ）も、ここで固定しておく。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isServerDatabaseUrl } from "@/lib/env";

describe("DATABASE_URL server-database rule", () => {
  it("ローカルのSQLiteファイルを拒否する", () => {
    for (const bad of [
      "",
      "   ",
      "file:./dev.db", // 既定値そのもの（設定忘れ）
      "file:./prisma/dev.db",
      "file:/var/data/dashdrop.db",
      "FILE:./dev.db", // 大文字でも同じもの
      "sqlite:./dev.db", // Prisma 以外の流儀で書かれた場合
      "  file:./dev.db  ", // コピペで前後に空白が入った場合
    ]) {
      expect(isServerDatabaseUrl(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("外部のDBサーバを指すURLを受け入れる", () => {
    for (const good of [
      "postgresql://user:password@host:5432/dashdrop?schema=public",
      "postgres://user:password@host:5432/dashdrop",
      "postgresql://user:pw@db.internal:5432/dashdrop?sslmode=require",
      // マネージドDBの接続文字列（Neon / Supabase など）も素通しする。
      "postgresql://user:pw@ep-x-123.ap-southeast-1.aws.neon.tech/dashdrop?sslmode=require",
      // 手元に立てた Postgres。到達性はここでは判定しない（DBが一時的に落ちて
      // いるだけでアプリが起動不能になる方が困る）。
      "postgresql://postgres:postgres@localhost:5432/dashdrop",
    ]) {
      expect(isServerDatabaseUrl(good), good).toBe(true);
    }
  });

  /**
   * 回帰テスト: .env.example をそのまま持っていったデプロイ（＝Vercel に
   * DATABASE_URL を入れ忘れたのと同じ状態）が本番起動できてはいけない。
   */
  it(".env.example の DATABASE_URL は本番向けとして拒否される", () => {
    const line = readFileSync(".env.example", "utf8")
      .split("\n")
      .find((l) => l.startsWith("DATABASE_URL="));
    expect(line).toBeTruthy();
    const value = line!.replace(/^DATABASE_URL=/, "").replace(/^"|"$/g, "");
    expect(isServerDatabaseUrl(value)).toBe(false);
  });
});

/**
 * .env.example は「.env を作るときに見る唯一の場所」（scripts/ensure-env.mjs が
 * そのままコピーする）。ここに無い変数は、docs にしか書いていない＝普通の手順で
 * 確実に漏れる。DATABASE_PROVIDER は provider の切り替えに必須で、これを
 * 忘れると DATABASE_URL だけ Postgres になり、生成される Prisma Client は
 * sqlite のまま——という食い違いが起きる。
 */
describe(".env.example completeness", () => {
  const example = readFileSync(".env.example", "utf8");
  const keys = new Set(
    example
      .split("\n")
      .map((l) => l.match(/^([A-Z0-9_]+)=/)?.[1])
      .filter((k): k is string => Boolean(k)),
  );

  it("コードが読む環境変数が載っている", () => {
    for (const key of [
      "APP_URL",
      "DATABASE_URL",
      "DATABASE_PROVIDER",
      "AUTH_SECRET",
      "CRON_SECRET",
      "ERROR_WEBHOOK_URL",
      "SMTP_HOST",
    ]) {
      expect(keys.has(key), key).toBe(true);
    }
  });
});

/**
 * 初回マイグレーションの不在は、本番で最も静かに壊れる穴だった。
 * `npm run db:deploy` は `prisma migrate deploy` を叩くが、履歴が空だと
 * 「適用するものが無い」と言って **成功して終わる**。テーブルが1つも無いまま
 * アプリが起動し、最初のリクエストで初めて壊れていることが分かる。
 */
describe("initial migration", () => {
  const dir = "prisma/migrations";
  const initDir = existsSync(dir)
    ? readdirSync(dir).find((d) => d.endsWith("_init"))
    : undefined;

  it("ベースラインのマイグレーションが存在する", () => {
    expect(initDir, "prisma/migrations/<timestamp>_init が無い").toBeTruthy();
  });

  it("15モデル全部の CREATE TABLE と、インデックス・外部キーを含む", () => {
    const sql = readFileSync(`${dir}/${initDir}/migration.sql`, "utf8");
    const models = readFileSync("prisma/schema.prisma", "utf8")
      .split("\n")
      .map((l) => l.match(/^model\s+(\w+)\s*\{/)?.[1])
      .filter((m): m is string => Boolean(m));
    expect(models.length).toBe(15);
    for (const m of models) {
      expect(sql, m).toContain(`CREATE TABLE "${m}"`);
    }
    expect(sql).toContain("CREATE INDEX");
    expect(sql).toContain("CREATE UNIQUE INDEX");
    expect(sql).toContain("FOREIGN KEY");
  });

  /**
   * 手元の schema.prisma は provider="sqlite" のままなので、うっかり
   * DATABASE_PROVIDER を付けずに migrate すると sqlite 方言の SQL がここに入る。
   * それに気づけるのは本番の migrate deploy が落ちたときで、いちばん遅い。
   */
  it("PostgreSQL 方言である", () => {
    const sql = readFileSync(`${dir}/${initDir}/migration.sql`, "utf8");
    // Postgres でしか出ない書き方。
    expect(sql).toMatch(/TIMESTAMP\(3\)/);
    expect(sql).toMatch(/\bJSONB\b/);
    expect(sql).toMatch(/ALTER TABLE .* ADD CONSTRAINT .* FOREIGN KEY/);
    // SQLite でしか出ない書き方。
    expect(sql).not.toMatch(/AUTOINCREMENT|PRAGMA|\bDATETIME\b/i);
    expect(readFileSync(`${dir}/migration_lock.toml`, "utf8")).toContain(
      'provider = "postgresql"',
    );
  });
});

/**
 * prisma/seed.ts のデモアカウントはパスワードごとリポジトリに書いてある。
 * 本番で1度でも流れると、リポジトリを読める全員がオーナー権限で入れてしまい、
 * しかも upsert なので消しても次の実行で戻ってくる。
 *
 * 実際にシードを起動して確かめる（DBには触れずに止まることも同時に確認できる）。
 */
describe("db:seed production guard", () => {
  function runSeed(env: Record<string, string>) {
    try {
      execFileSync("node_modules/.bin/tsx", ["prisma/seed.ts"], {
        env: { ...process.env, ...env },
        encoding: "utf8",
        stdio: "pipe",
      });
      return { status: 0, stderr: "" };
    } catch (e) {
      const err = e as { status?: number; stderr?: string };
      return { status: err.status ?? -1, stderr: err.stderr ?? "" };
    }
  }

  it("NODE_ENV=production では理由を出して exit 1 する", () => {
    // DATABASE_URL も差し替えておく。ガードが壊れた（＝このテストが落ちる）とき、
    // シードが手元の dev.db を作り直してしまうのを防ぐため。
    const r = runSeed({
      NODE_ENV: "production",
      DATABASE_URL: "file:/nonexistent-dir-for-test/dashdrop.db",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("db:seed を実行しません");
    expect(r.stderr).toContain("ALLOW_PRODUCTION_SEED=1");
  }, 60_000);

  it("明示的なフラグがあれば拒否しない", () => {
    // フラグを立てると、ガードを抜けて実際にDBへ書きに行く。ここでDBを触りたく
    // ないので、接続できないURLを渡して「ガードで止まったのではない」ことだけを
    // 確かめる（止まる理由がPrismaの接続エラーに変わっていれば通過している）。
    const r = runSeed({
      NODE_ENV: "production",
      ALLOW_PRODUCTION_SEED: "1",
      DATABASE_URL: "file:/nonexistent-dir-for-test/dashdrop.db",
    });
    expect(r.stderr).not.toContain("db:seed を実行しません");
  }, 60_000);
});
