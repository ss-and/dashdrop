#!/usr/bin/env node
/**
 * Prisma の datasource provider を、環境に合わせて切り替える。
 *
 * Prisma の `provider` は文字列リテラルしか受け付けず、`env()` が使えない。
 * 一方、手元は SQLite（インストール不要ですぐ動く）、本番は PostgreSQL
 * （同時書き込み・バックアップ・複数インスタンス）でなければ成り立たない。
 *
 * そこで schema.prisma を直接書き換えるのではなく、**生成した写し**を作って
 * そちらを Prisma に渡す。元のファイルは触らないので、本番向けのビルドを
 * 走らせても git の作業ツリーが汚れない。
 *
 *   DATABASE_PROVIDER=postgresql node scripts/db-provider.mjs
 *   → prisma/schema.generated.prisma を作り、そのパスを標準出力に出す
 *
 * 使い方（package.json のスクリプト参照）:
 *   npm run db:generate          … 手元（sqlite）
 *   DATABASE_PROVIDER=postgresql npm run db:deploy   … 本番
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "prisma", "schema.prisma");
const TARGET = join(ROOT, "prisma", "schema.generated.prisma");

const SUPPORTED = ["sqlite", "postgresql"];
const provider = process.env.DATABASE_PROVIDER ?? "sqlite";

if (!SUPPORTED.includes(provider)) {
  console.error(
    `DATABASE_PROVIDER は ${SUPPORTED.join(" / ")} のいずれかにしてください（受け取った値: ${provider}）`,
  );
  process.exit(1);
}

const source = readFileSync(SOURCE, "utf8");

/*
 * 置き換えるのは datasource ブロックの provider 1行だけ。generator 側にも
 * `provider = "prisma-client-js"` があるので、素朴な全置換をしてはいけない。
 */
const datasource = /(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"[^"]+"/s;
if (!datasource.test(source)) {
  console.error("datasource ブロックの provider を見つけられませんでした。");
  process.exit(1);
}

const header = [
  "// このファイルは scripts/db-provider.mjs が生成します。直接編集しないでください。",
  "// 元は prisma/schema.prisma です。",
  `// provider: ${provider}`,
  "",
].join("\n");

writeFileSync(TARGET, header + source.replace(datasource, `$1"${provider}"`), "utf8");
process.stdout.write(TARGET + "\n");
