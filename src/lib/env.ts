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
  /*
   * 既定を最高単価のモデルにしない。ここが使われるのは取り込みの列名判定と、
   * 入力に近いテンプレート選びの2つだけで、どちらも短いJSONを返す仕事——
   * opus（$5/$25）を既定にすると1回 ¥19〜75 が既定値として全員に掛かる。
   * 精度を上げたい運用者は ANTHROPIC_MODEL で上書きできる。
   */
  ANTHROPIC_MODEL: z.string().optional().default("claude-haiku-4-5"),
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
  /**
   * 定期実行（cron）の共有シークレット。
   *
   * ここに書いていなかったので、**設定を忘れても何も起きなかった**。
   * `/api/cron/alerts` と `/api/reports/dispatch` は未設定なら 503 を返して
   * 静かに何もしないだけなので、アラートもレポートも一度も飛ばないまま
   * 「15分ごとに確認します」という約束だけが画面に残る。
   *
   * 起動を止めはしない（cron を使わない自己ホストは正当な運用なので）。
   * ただし **弱い値なら止める** — 下の isWeakCronSecret を参照。
   */
  CRON_SECRET: z.string().optional().default(""),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  /*
   * 既定値に実在するドメインを書かない。
   * 以前は "no-reply@dashdrop.app" だったが、**dashdrop.app は別会社が運用中の
   * 別サービス**（デジタル商品の販売プラットフォーム）で、こちらの持ち物ではない。
   * 設定を忘れたまま送ると、他社ドメインを差出人に詐称したメールになり、
   * SPF/DKIM が通らず迷惑メール送信元として扱われる。
   * `.invalid` は RFC 2606 で「決して登録されない」と決められた予約TLDなので、
   * 誰かの持ち物と衝突しない。
   */
  EMAIL_FROM: z.string().optional().default("DashDrop <no-reply@example.invalid>"),
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

/**
 * Whether `url` points at a database server that outlives the process.
 * Pure — exported so the rule can be tested without booting the app.
 *
 * SQLite は「接続先」ではなくファイルパスで、Prisma では "file:" スキームで表す
 * （"sqlite:" と書く流儀もあるので両方見る）。それ以外（postgresql:// など）は
 * どこかのサーバを指しているとみなして通す。ここで接続できるかまでは確かめない
 * ——起動時に落とすべきなのは「明らかに永続しない指定」だけで、到達性の問題は
 * 最初のクエリで分かるし、DBが一時的に落ちているだけでアプリが起動不能になる方が困る。
 */
export function isServerDatabaseUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (!u) return false;
  if (u.startsWith("file:")) return false;
  if (u.startsWith("sqlite:")) return false;
  return true;
}

/** True when DATABASE_URL points at a real DB server (not a local SQLite file). */
export const isServerDatabaseConfigured = isServerDatabaseUrl(env.DATABASE_URL);

/*
 * DATABASE_URL だけが既定値 "file:./dev.db" を持っていて、AUTH_SECRET と APP_URL
 * と違って本番でも素通りしていた。これが一番たちが悪い：Vercel で環境変数を
 * 入れ忘れても **アプリは正常に起動する**。SQLite ファイルがサーバーレスの
 * 一時ファイルシステム上に作られ、サインアップも取り込みも成功したように見えて、
 * インスタンスが再利用されなくなった瞬間に全部消える。エラーもログも出ないので、
 * お客さまから「登録したデータが無い」と言われるまで誰も気づけない。
 *
 * AUTH_SECRET / APP_URL と同じ形で、実際に本番トラフィックを捌くときだけ強制し、
 * `next build`（NEXT_PHASE=phase-production-build）は素通しする。
 */
if (env.NODE_ENV === "production" && !isBuildPhase && !isServerDatabaseConfigured) {
  throw new Error(
    `DATABASE_URL must point at a database server in production (got "${env.DATABASE_URL}"). ` +
      `SQLite（file:）はサーバーレスの一時ファイルシステムに置かれるため、書き込みは成功したように見えて、` +
      `インスタンスが破棄された時点で黙って消えます。 ` +
      `Set it in the environment, e.g. DATABASE_URL="postgresql://user:password@host:5432/dashdrop?schema=public" ` +
      `(and DATABASE_PROVIDER=postgresql — see docs/OPERATIONS.md).`,
  );
}

/**
 * Whether `url` tells Prisma how many connections it may open.
 * Pure — exported so the rule can be tested without booting the app.
 *
 * ## なぜ起動時に見るのか
 *
 * Vercel のようなサーバーレスでは、リクエストの山ごとに**別々のインスタンス**が
 * 立ち上がり、その1つ1つが自分専用の接続プールを作る。Prisma の既定は
 * 「CPU数×2＋1」なので、1インスタンスあたり 5〜9 本を掴む。
 *
 *   同時に 30 インスタンス立てば 150〜270 本
 *   → Neon の Free/Launch は 100〜数百本で頭打ち
 *   → `too many connections for role …` / `Timed out fetching a new connection`
 *
 * たちが悪いのは**平常時は絶対に起きない**こと。1人で触っている間も、10人でも
 * 起きない。公開初日に人が集中した瞬間だけ、ログインも取り込みも同時に落ちる。
 * しかも原因はアプリのコードではなく接続文字列に書いていない1語なので、
 * 落ちてから探すと最後に辿り着く。
 *
 * 正解は、接続を束ねる口（Neon の `-pooler`、Supabase の `.pooler.`、
 * 自前の PgBouncer）を指したうえで `connection_limit=1` を書くこと。
 * サーバーレスの1インスタンスは同時に1クエリしか流さないので、1で足りる。
 *
 * ここでは到達性までは確かめない。「明示的に指定していない」ことだけを見る。
 */
export function isPooledDatabaseUrl(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  // Prisma Accelerate / Prisma Postgres は接続の束ね自体が向こう側の仕事。
  if (/^prisma(\+postgres)?:/i.test(raw)) return true;

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    // 解析できない形はここでは判定しない（別の検証で落ちる）。
    return true;
  }

  // 本数を運用者が明示している。値の妥当性までは問わない——「考えた形跡」を見る。
  if (u.searchParams.has("connection_limit")) return true;
  // PgBouncer 越しであることの申告（Prisma はこれで prepared statement を切る）。
  if (u.searchParams.get("pgbouncer") === "true") return true;

  // 束ねる口を指している主要ホスティングの書き方。
  const host = u.hostname.toLowerCase();
  if (host.includes("-pooler.")) return true;   // Neon（Vercel Postgres）
  if (host.includes(".pooler.")) return true;   // Supabase
  if (host.includes("pgbouncer")) return true;  // 自前

  return false;
}

/** True when DATABASE_URL bounds how many connections each instance may open. */
export const isPooledDatabaseConfigured = isPooledDatabaseUrl(env.DATABASE_URL);

/*
 * SQLite（file:）はプールの話が無いので、サーバDBを指しているときだけ見る。
 */
if (
  env.NODE_ENV === "production" &&
  !isBuildPhase &&
  isServerDatabaseConfigured &&
  !isPooledDatabaseConfigured
) {
  throw new Error(
    `DATABASE_URL must bound its connection pool in production (got host "${(() => {
      try {
        return new URL(env.DATABASE_URL).hostname;
      } catch {
        return "?";
      }
    })()}"). ` +
      `サーバーレスではインスタンスごとに別のプールが作られるため、指定が無いと ` +
      `同時アクセスが増えた瞬間に接続数の上限を超えて、ログインも取り込みも同時に落ちます。 ` +
      `束ねる口（Neon なら "-pooler" の付いたホスト）を指したうえで ` +
      `"?connection_limit=1&pgbouncer=true" を付けてください ` +
      `（自前で束ねている場合も connection_limit を明示すれば通ります）。`,
  );
}

/** True when the scheduled endpoints will actually accept a call. */
export const cronEnabled = env.CRON_SECRET.trim().length > 0;

/*
 * CRON_SECRET は「未設定なら動かさない」が既定なので、無いこと自体では止めない
 * （cron を使わない自己ホストは正当な運用）。止めるのは**弱い値**のとき。
 *
 * このシークレットを当てられると、URLを知っている誰でも全ワークスペースの
 * アラート評価を好きなだけ起動できる——つまり Slack への送信とDBへの書き込みを
 * 外から回せる。無認証で開けているのと変わらない状態なので、
 * AUTH_SECRET と同じ強度を要求する。
 */
if (
  env.NODE_ENV === "production" &&
  !isBuildPhase &&
  cronEnabled &&
  !isStrongSecret(env.CRON_SECRET)
) {
  throw new Error(
    "CRON_SECRET must be a strong 32+ char secret in production. Generate one with `openssl rand -base64 32`.",
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
