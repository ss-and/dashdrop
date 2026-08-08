/**
 * Ensure a local `.env` exists before Prisma / Next run.
 *
 * `.env` is gitignored, so a fresh clone won't have one — and Prisma then fails
 * with "Environment variable not found: DATABASE_URL". This copies
 * `.env.example` → `.env` on first run (cross-platform, no shell `cp`/`copy`
 * differences). Runs automatically via the `presetup` / `predev` npm hooks.
 */
import { existsSync, copyFileSync } from "node:fs";

if (existsSync(".env")) {
  process.exit(0);
}

if (!existsSync(".env.example")) {
  console.error("⚠️  .env.example が見つかりません。手動で .env を作成してください。");
  process.exit(0);
}

copyFileSync(".env.example", ".env");
console.log("✅ .env を作成しました（.env.example からコピー）。");
console.log("   本番公開時は AUTH_SECRET を強い値に変更してください: openssl rand -base64 48");
