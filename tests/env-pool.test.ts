/**
 * 公開初日にだけ起きる壊れ方を、起動前に落とす。
 *
 * ここで守るのは2つ。どちらも**平常時は絶対に再現しない**種類で、人が
 * 集中した瞬間にだけ表に出る。
 *
 *  ① 接続プールの上限を書いていない DATABASE_URL
 *     サーバーレスはリクエストの山ごとに別インスタンスを立て、その1つ1つが
 *     自分のプールを作る。Prisma の既定は CPU数×2＋1 なので 1インスタンス
 *     5〜9本。30インスタンス並べば 150〜270本になり、Neon の上限を超える。
 *     → ログインも取り込みも同時に落ちる。原因は接続文字列の1語なので、
 *       落ちてから探すと最後に辿り着く。
 *
 *  ② 弱い CRON_SECRET
 *     当てられると、URLを知っている誰でも全ワークスペースのアラート評価を
 *     外から回せる（＝Slack送信とDB書き込み）。無認証で開けているのと同じ。
 *     未設定は「動かさない」で正しいので止めない。止めるのは弱いときだけ。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isPooledDatabaseUrl, isStrongSecret } from "@/lib/env";

const NEON = "ep-cool-name-a1b2c3d4";

describe("① DATABASE_URL の接続プール上限", () => {
  it("本数の指定が無いサーバDBを拒否する", () => {
    for (const bad of [
      // Neon の「束ねない」ほうのホスト。ここを踏むのが一番ありがちで、
      // Vercel の画面からコピーすると既定でこちらが出ることがある。
      `postgresql://u:p@${NEON}.ap-southeast-1.aws.neon.tech/dashdrop?sslmode=require`,
      // 自前の Postgres。
      "postgresql://u:p@db.internal:5432/dashdrop?schema=public",
      "postgres://u:p@10.0.0.5:5432/dashdrop",
      // MySQL でも事情は同じ。
      "mysql://u:p@db.internal:3306/dashdrop",
      // pgbouncer=false は「考えたうえで束ねていない」。通してはいけない。
      "postgresql://u:p@db.internal:5432/dashdrop?pgbouncer=false",
      "",
      "   ",
    ]) {
      expect(isPooledDatabaseUrl(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("束ねる口を指しているか、本数を明示しているものを通す", () => {
    for (const good of [
      // Neon（Vercel Postgres）の pooler。
      `postgresql://u:p@${NEON}-pooler.ap-southeast-1.aws.neon.tech/dashdrop?sslmode=require&connection_limit=1&pgbouncer=true`,
      // ホスト名だけでも pooler なら通す。
      `postgresql://u:p@${NEON}-pooler.ap-southeast-1.aws.neon.tech/dashdrop`,
      // Supabase。
      "postgresql://u:p@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
      // 自前の PgBouncer。ホスト名で名乗っている場合。
      "postgresql://u:p@pgbouncer.internal:6432/dashdrop",
      // ホスト名は普通でも、本数を明示していれば運用者が考えている。
      "postgresql://u:p@db.internal:5432/dashdrop?connection_limit=1",
      "postgresql://u:p@db.internal:5432/dashdrop?schema=public&connection_limit=5",
      "postgresql://u:p@db.internal:5432/dashdrop?pgbouncer=true",
      // Prisma Accelerate / Prisma Postgres は束ねるのが向こうの仕事。
      "prisma://accelerate.prisma-data.net/?api_key=xxx",
      "prisma+postgres://accelerate.prisma-data.net/?api_key=xxx",
    ]) {
      expect(isPooledDatabaseUrl(good), JSON.stringify(good)).toBe(true);
    }
  });

  /**
   * SQLite にはプールの話が無い。ここが false を返しても、呼び出し側は
   * `isServerDatabaseConfigured` で先に弾いているので本番では届かない。
   * 手元の開発を巻き込まないことだけ確かめる。
   */
  it("解析できない文字列では止めない（別の検証の仕事）", () => {
    expect(isPooledDatabaseUrl("これはURLではない")).toBe(true);
  });

  /** 起動時のガードが実際に置かれていること。純関数だけあっても効かない。 */
  it("本番でだけ落とすガードが env.ts にある", () => {
    const src = readFileSync("src/lib/env.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    /*
     * 条件そのものを取り出して見る。ブロック全体を toContain で見ていたら、
     * `!isPooledDatabaseConfigured` を `false` に潰す変異（＝ガードが
     * 永久に発動しない）を**素通しした**。周りの文字列は全部残るため。
     */
    const start = src.indexOf("if (\n  env.NODE_ENV === \"production\" &&\n  !isBuildPhase &&\n  isServerDatabaseConfigured");
    expect(start, "接続プールのガードが見つからない").toBeGreaterThan(-1);
    const condition = src.slice(start, src.indexOf(") {", start));
    expect(condition).toContain("!isPooledDatabaseConfigured");
    // ビルド時は素通しする（Vercel のビルドに秘密は無い）。
    expect(condition).toContain("!isBuildPhase");
    // SQLite を巻き込まない。
    expect(condition).toContain("isServerDatabaseConfigured");
    expect(src.slice(start)).toContain("throw new Error");
  });
});

describe("② CRON_SECRET の強度", () => {
  it("未設定では止めない（cron を使わない運用は正当）", () => {
    const src = readFileSync("src/lib/env.ts", "utf8");
    // 未設定なら cronEnabled が false になり、ガードの条件が成立しない。
    expect(src).toContain("cronEnabled");
    expect(src).toMatch(/cronEnabled\s*&&\s*\n?\s*!isStrongSecret\(env\.CRON_SECRET\)/);
  });

  it("弱い値を弾く", () => {
    for (const weak of ["cron", "secret", "change-me-please-1234567890123456", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]) {
      expect(isStrongSecret(weak), weak).toBe(false);
    }
  });

  it("openssl rand -base64 32 の形は通す", () => {
    expect(isStrongSecret("UCp7A231FJYTacaq+QZzOsC1dgcXQAcQcC7qLAZNGkI=")).toBe(true);
  });

  it("CRON_SECRET が env のスキーマにある（process.env の直読みで散らばらない）", () => {
    const src = readFileSync("src/lib/env.ts", "utf8");
    expect(src).toContain("CRON_SECRET: z.string()");
  });
});

describe("③ 差出人に他社のドメインを既定値で置かない", () => {
  /**
   * 【回帰】既定値が "no-reply@dashdrop.app" だった。dashdrop.app は
   * **別会社が運用している別サービス**（デジタル商品の販売）で、こちらの
   * 持ち物ではない。設定を忘れたまま送ると他社ドメインの詐称になる。
   */
  it("env.ts と .env.example の既定値が dashdrop.app を指していない", () => {
    for (const p of ["src/lib/env.ts", ".env.example"]) {
      const returned = readFileSync(p, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*#.*$/gm, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(returned, p).not.toContain("@dashdrop.app");
    }
  });
});
