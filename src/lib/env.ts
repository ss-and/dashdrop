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

  OPENAI_API_KEY: z.string().optional().default(""),
  GOOGLE_SHEETS_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_SHEETS_CLIENT_SECRET: z.string().optional().default(""),

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

/** True when a real AUTH_SECRET has been configured (blocks unsafe prod boot). */
export const isSecureAuthSecret =
  env.AUTH_SECRET.length >= 32 &&
  env.AUTH_SECRET !== "dev-insecure-secret-change-me" &&
  !env.AUTH_SECRET.startsWith("dev-only-secret");

// Enforce a strong secret when actually serving in production — but not during
// `next build` (NEXT_PHASE=phase-production-build), where secrets may be absent.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
if (env.NODE_ENV === "production" && !isBuildPhase && !isSecureAuthSecret) {
  throw new Error(
    "AUTH_SECRET must be a strong 32+ char secret in production. Generate one with `openssl rand -base64 48`.",
  );
}

/** Billing is only active when Stripe keys are present. */
export const billingEnabled = env.STRIPE_SECRET_KEY.length > 0;
