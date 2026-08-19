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
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".env")) {
  process.exit(0);
}

if (!existsSync(".env.example")) {
  console.error("⚠️  .env.example が見つかりません。手動で .env を作成してください。");
  process.exit(0);
}

// base64 は `"` も `$` も含まないので、そのまま二重引用符で囲んで安全
// （`$&` や `$'` として置換文字列に解釈されることもない）。
const secret = randomBytes(48).toString("base64");
const template = readFileSync(".env.example", "utf8");

// 置換は全行に対して行う: dotenv は同じキーが複数あると「最後の行が勝つ」ため、
// 先頭の1行だけ書き換えると、実効値がコミット済みのプレースホルダのままになる。
let contents = template.replace(/^AUTH_SECRET=.*$/gm, `AUTH_SECRET="${secret}"`);
if (contents === template) {
  // AUTH_SECRET 行が無い（.env.example が変わった）場合は追記する。
  contents = `${template.replace(/\n*$/, "\n")}AUTH_SECRET="${secret}"\n`;
}

// 一時ファイルに書いてから rename する。copy → 書き換え の2段階だと、その間に
// 中断された場合にプレースホルダのままの .env が残り、以降の実行は「.env が
// 既にある」と見て何もしないため、弱い鍵が恒久的に居座ってしまう。
const tmp = `.env.tmp-${process.pid}`;
try {
  writeFileSync(tmp, contents, { mode: 0o600 });
  renameSync(tmp, ".env");
} catch (err) {
  rmSync(tmp, { force: true });
  console.error("⚠️  .env の作成に失敗しました:", err?.message ?? err);
  process.exit(1);
}

console.log("✅ .env を作成しました（.env.example からコピー）。");
console.log("   AUTH_SECRET はこの環境専用のランダムな値を生成しました。");
