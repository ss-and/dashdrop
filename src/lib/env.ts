/**
 * Centralised, validated environment access.
 *
 * Fail fast in production if required secrets are missing; be lenient in dev.
 * Import `env` anywhere on the server — never read process.env directly.
 */
import { z } from "zod";

const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1).default("file:./dev.db"),
  AUTH_SECRET: z.string().min(1).default("dev-insecure-secret-change-me"),
  SESSION_MAX_AGE: z.coerce.number().int().positive().default(604800),

  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  STRIPE_PRICE_PRO: z.string().optional().default(""),
  STRIPE_PRICE_BUSINESS: z.string().optional().default(""),

  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().optional().default("claude-opus-5"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().optional().default("gpt-4o-mini"),
  GOOGLE_SHEETS_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_SHEETS_CLIENT_SECRET: z.string().optional().default(""),

  SLACK_WEBHOOK_URL: z.string().optional().default(""),
  /**
   * SLACK_WEBHOOK_URL を使うことの明示的な同意。「ワークスペースが1つだけ」を
   * 自己ホストの証拠として扱うと、ホスティング版でも最初の1社が登録した直後や、
   * 整理して1社になった瞬間に、そのお客さまの通知が運営のチャンネルへ流れる。
   * 意図は自動で推測せず、運用者に宣言してもらう。
   */
  SLACK_WEBHOOK_SINGLE_TENANT: z.string().optional().default(""),
  /**
   * 例外の通知先（任意）。設定すると、拾えなかった例外を1件ずつ POST する。
   * Slack の Incoming Webhook でも、監視SaaS の受け口でも良い。
   */
  ERROR_WEBHOOK_URL: z.string().optional().default(""),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  EMAIL_FROM: z.string().optional().default("DashDrop <no-reply@dashdrop.app>"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid environment configuration:",
    parsed.error.flatten().fieldErrors,
  );
  throw new Error("Invalid environment configuration. See .env.example.");
}

export const env = parsed.data;

/**
 * Placeholder secrets that must never reach production.
 *
 * 長さだけを見ていると `.env.example` の
 * "change-me-to-a-long-random-string-min-32-chars"（46文字）を「強い」と
 * 判定してしまい、公開リポジトリの値のまま本番が起動してしまう。AUTH_SECRET は
 * セッション JWT の署名鍵であると同時に、連携トークンの暗号鍵の導出元
 * （src/lib/crypto.ts）でもあるため、漏れると全テナントが破られる。
 * 値そのものではなく「いかにも仮の値」という特徴で弾く。
 */
const PLACEHOLDER_MARKERS = [
  "change-me",
  "change_me",
  "changeme",
  "your-secret",
  "your_secret",
  "replace-me",
  "placeholder",
  "example",
  "insecure",
  "dev-only-secret",
  "min-32-chars",
];

/**
 * 文字列の最小周期。`s[i] === s[i + p]` がすべての i で成り立つ最小の p。
 * 途中で切れた繰り返し（"password1password1password1passw"）も拾える。
 * 周期が見つからなければ長さそのものを返す。
 */
function shortestPeriod(s: string): number {
  for (let p = 1; p * 3 <= s.length; p++) {
    let ok = true;
    for (let i = 0; i + p < s.length; i++) {
      if (s[i] !== s[i + p]) {
        ok = false;
        break;
      }
    }
    if (ok) return p;
  }
  return s.length;
}

/**
 * Whether `secret` is strong enough to serve production traffic with.
 * Pure — exported so the rule can be tested without booting the app.
 */
export function isStrongSecret(secret: string): boolean {
  if (secret.length < 32) return false;
  const lower = secret.toLowerCase();
  if (PLACEHOLDER_MARKERS.some((m) => lower.includes(m))) return false;
  // 同じ文字の繰り返し（"aaaa…"）のような、長さだけ足りている値も弾く。
  //
  // 固定の「12種類以上」だと、`openssl rand -hex 16`（32文字・16種類の英数字）
  // という真っ当な128ビットの値が 1.7% の確率で拒否され、本番が起動しなく
  // なっていた。使える文字種はエンコード方式で決まるので、文字種の数ではなく
  // 「特定の1文字に偏っていないか」で判定する。
  const counts = new Map<string, number>();
  for (const ch of secret) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  if (counts.size < 5) return false;
  const most = Math.max(...counts.values());
  if (most * 2 > secret.length) return false; // 1文字が過半数 → 反復的
  // 短い文字列の繰り返し（"password1password1…"）を弾く。
  //
  // 「使われている文字の種類」で測ると、16進のような文字種の少ない
  // エンコードを巻き添えにする（openssl rand -hex 16 は32文字で16種類しか
  // 使わない）。弱い人力の値の実体は「文字種が少ない」ことではなく
  // 「短い塊の繰り返し」なので、周期そのものを見る。
  if (shortestPeriod(secret) * 3 <= secret.length) return false;
  return true;
}

/** True when a real AUTH_SECRET has been configured (blocks unsafe prod boot). */
export const isSecureAuthSecret = isStrongSecret(env.AUTH_SECRET);

// Enforce a strong secret when actually serving in production — but not during
// `next build` (NEXT_PHASE=phase-production-build), where secrets may be absent.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
if (env.NODE_ENV === "production" && !isBuildPhase && !isSecureAuthSecret) {
  throw new Error(
    "AUTH_SECRET must be a strong 32+ char secret in production. Generate one with `openssl rand -base64 48`.",
  );
}

/** Hosts that only ever resolve back to the machine running the server. */
function isLoopbackHost(host: string): boolean {
  // URL.hostname は IPv6 を "[::1]" の形で返すため、角括弧を外してから比べる。
  const h = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!h) return true;
  // "localhost" とそのサブドメイン（"api.localhost" 等）。
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // 127.0.0.0/8 は全体がループバック（127.0.0.1 だけではない）。
  if (/^127\./.test(h)) return true;
  // 未指定アドレス（0.0.0.0 / ::）と IPv6 ループバック。
  if (h === "0.0.0.0" || h === "::" || h === "::1") return true;
  // IPv4射影のループバック。URL の正規化で "::ffff:127.0.0.1" は
  // "::ffff:7f00:1" という16進表記になるため、両方の書き方を見る。
  if (h.startsWith("::ffff:127.")) return true;
  if (/^::ffff:7f[0-9a-f]{0,2}:/.test(h)) return true;
  return false;
}

/**
 * Whether `url` can serve as the public base URL of a production deployment.
 * Pure — exported so the rule can be tested without booting the app.
 *
 * 社内向けの自己ホスト（http://192.168.1.10:3000 など）は正当な運用なので通す。
 * 弾くのは「サーバ自身からしか開けないと確実に分かるURL」だけ。
 */
export function isPublicAppUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // 通知やSlackから開けるのは http(s) のみ。
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return !isLoopbackHost(parsed.hostname);
}

/** True when APP_URL points somewhere a recipient can actually open. */
export const isPublicAppUrlConfigured = isPublicAppUrl(env.APP_URL);

/*
 * APP_URL は通知の「開く」リンクや Slack へ送る絶対URLの土台になる
 * （src/lib/notify.ts の absoluteUrl）。設定を忘れると既定値の
 * "http://localhost:3000" が黙って使われ、本番では受信者全員にとって死んだ
 * リンクになる。例外も警告も出ないため、通知が届いた人から「リンクが開けない」
 * と言われるまで誰も気づけない。AUTH_SECRET と同じく起動時に落として、
 * デプロイの時点で気づけるようにする。
 *
 * 同じくAUTH_SECRETと同じ扱いで、実際に本番トラフィックを捌くときだけ強制し、
 * `next build`（NEXT_PHASE=phase-production-build）は素通しする。
 */
if (env.NODE_ENV === "production" && !isBuildPhase && !isPublicAppUrlConfigured) {
  throw new Error(
    `APP_URL must be the public URL of this deployment in production (got "${env.APP_URL}"). ` +
      `Notification and Slack links are built from it, so a wrong value ships dead links. ` +
      `Set it in the environment, e.g. APP_URL="https://dashdrop.example.com".`,
  );
}

/** Billing is only active when Stripe keys are present. */
export const billingEnabled = env.STRIPE_SECRET_KEY.length > 0;

/** Which AI provider (if any) is configured for dashboard generation. */
export const aiProvider: "anthropic" | "openai" | null =
  env.ANTHROPIC_API_KEY.length > 0
    ? "anthropic"
    : env.OPENAI_API_KEY.length > 0
      ? "openai"
      : null;
