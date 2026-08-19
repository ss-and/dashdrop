/**
 * Ensure a local `.env` exists before Prisma / Next run.
 *
 * `.env` is gitignored, so a fresh clone won't have one — and Prisma then fails
 * with "Environment variable not found: DATABASE_URL". This copies
 * `.env.example` → `.env` on first run (cross-platform, no shell `cp`/`copy`
 * differences). Runs automatically via the `presetup` / `predev` npm hooks.
 *
 * AUTH_SECRET は、コピーの時点でランダムな値に置き換える。プレースホルダのまま
 * 公開されると、JWT の署名鍵も、連携トークンの暗号鍵（scrypt(AUTH_SECRET)）も
 * 公開リポジトリから丸わかりになるため。ここで必ず一意の値にしておく。
 */
import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".env")) {
  process.exit(0);
}

if (!existsSync(".env.example")) {
  console.error("⚠️  .env.example が見つかりません。手動で .env を作成してください。");
  process.exit(0);
}

copyFileSync(".env.example", ".env");

// base64 は `"` を含まないので、そのまま二重引用符で囲んで安全。
const secret = randomBytes(48).toString("base64");
const contents = readFileSync(".env", "utf8");
const replaced = contents.replace(
  /^AUTH_SECRET=.*$/m,
  `AUTH_SECRET="${secret}"`,
);

if (replaced === contents) {
  // AUTH_SECRET 行が無い（.env.example が変わった）場合は追記する。
  writeFileSync(
    ".env",
    `${contents.replace(/\n*$/, "\n")}AUTH_SECRET="${secret}"\n`,
  );
} else {
  writeFileSync(".env", replaced);
}

console.log("✅ .env を作成しました（.env.example からコピー）。");
console.log("   AUTH_SECRET はこの環境専用のランダムな値を生成しました。");
