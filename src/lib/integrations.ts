/**
 * Per-workspace third-party connections (Slack, Notion).
 *
 * Credentials belong to a workspace, never to the deployment: a single global
 * webhook would post every tenant's notifications into one channel, and a
 * single API token would read every tenant's Notion. Secrets are sealed with
 * AES-256-GCM (see ./crypto) before storage and are never returned to the
 * client — callers get a mask like "xoxb-…4f2a".
 */
import { db, toJson } from "./db";
import { ApiError } from "./errors";
import { encryptSecret, decryptSecret, maskSecret } from "./crypto";

export const PROVIDERS = ["slack", "notion"] as const;
export type Provider = (typeof PROVIDERS)[number];

export function isProvider(v: unknown): v is Provider {
  return typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  slack: "Slack",
  notion: "Notion",
};

/** What a settings screen may safely see. Never includes the secret. */
export interface IntegrationSummary {
  provider: Provider;
  connected: boolean;
  enabled: boolean;
  /** Masked credential, e.g. "http…be12". Null when not connected. */
  masked: string | null;
  config: Record<string, unknown>;
  lastOkAt: string | null;
  lastError: string | null;
}

/** Shape-check a credential before we bother storing it. */
export function validateSecret(provider: Provider, secret: string): string {
  const s = secret.trim();
  if (!s) throw new ApiError("接続情報を入力してください。", 422);

  if (provider === "slack") {
    // Incoming webhooks are always this host; anything else is either a typo or
    // an attempt to make the server POST somewhere it shouldn't (SSRF).
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      throw new ApiError(
        "Slackの Webhook URL の形式が正しくありません。",
        422,
      );
    }
    if (url.protocol !== "https:" || url.hostname !== "hooks.slack.com") {
      throw new ApiError(
        "Slackの Webhook URL は https://hooks.slack.com/... である必要があります。",
        422,
      );
    }
    return s;
  }

  // Notion internal integration tokens.
  if (!/^(secret_|ntn_)/.test(s)) {
    throw new ApiError(
      "Notionのインテグレーション トークン（secret_ または ntn_ で始まる文字列）を貼り付けてください。",
      422,
    );
  }
  if (s.length < 20) {
    throw new ApiError("Notionのトークンが短すぎます。", 422);
  }
  return s;
}

/** Store (or replace) a workspace's credential for one provider. */
export async function saveIntegration(
  workspaceId: string,
  provider: Provider,
  secret: string,
  config?: Record<string, unknown>,
): Promise<IntegrationSummary> {
  const clean = validateSecret(provider, secret);
  const row = await db.integration.upsert({
    where: { workspaceId_provider: { workspaceId, provider } },
    create: {
      workspaceId,
      provider,
      secret: encryptSecret(clean),
      config: config ? toJson(config) : undefined,
      enabled: true,
    },
    update: {
      secret: encryptSecret(clean),
      ...(config ? { config: toJson(config) } : {}),
      enabled: true,
      lastError: null,
    },
  });
  return summarise(row, clean);
}

/** Remove a connection entirely. Idempotent. */
export async function deleteIntegration(
  workspaceId: string,
  provider: Provider,
): Promise<void> {
  await db.integration
    .delete({ where: { workspaceId_provider: { workspaceId, provider } } })
    .catch(() => {});
}

/**
 * The decrypted credential, or null when not connected / disabled / unreadable.
 * Server-side only — never hand the result to a client component.
 */
export async function getSecret(
  workspaceId: string,
  provider: Provider,
): Promise<string | null> {
  const row = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider } },
  });
  if (!row || !row.enabled) return null;
  return decryptSecret(row.secret);
}

export async function getIntegration(
  workspaceId: string,
  provider: Provider,
): Promise<IntegrationSummary | null> {
  const row = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider } },
  });
  if (!row) return null;
  return summarise(row, decryptSecret(row.secret));
}

/** Every provider, connected or not — what the settings page renders. */
export async function listIntegrations(
  workspaceId: string,
): Promise<IntegrationSummary[]> {
  const rows = await db.integration.findMany({ where: { workspaceId } });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return PROVIDERS.map((p) => {
    const row = byProvider.get(p);
    if (!row) {
      return {
        provider: p,
        connected: false,
        enabled: false,
        masked: null,
        config: {},
        lastOkAt: null,
        lastError: null,
      };
    }
    return summarise(row, decryptSecret(row.secret));
  });
}

/** Record the outcome of a delivery so the settings page can show it. */
export async function recordResult(
  workspaceId: string,
  provider: Provider,
  ok: boolean,
  error?: string,
): Promise<void> {
  await db.integration
    .update({
      where: { workspaceId_provider: { workspaceId, provider } },
      data: ok
        ? { lastOkAt: new Date(), lastError: null }
        : { lastError: (error ?? "不明なエラー").slice(0, 500) },
    })
    .catch(() => {});
}

type Row = {
  provider: string;
  enabled: boolean;
  config: unknown;
  lastOkAt: Date | null;
  lastError: string | null;
};

function summarise(row: Row, plain: string | null): IntegrationSummary {
  return {
    provider: row.provider as Provider,
    // A row whose secret no longer decrypts (AUTH_SECRET rotated, or the value
    // was tampered with) is reported as not connected — it cannot be used.
    connected: plain !== null,
    enabled: row.enabled,
    masked: plain ? maskSecret(plain) : null,
    config: (row.config as Record<string, unknown>) ?? {},
    lastOkAt: row.lastOkAt ? row.lastOkAt.toISOString() : null,
    lastError: row.lastError,
  };
}
