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

/**
 * なぜ配信できないのかを一言で表す。「未接続」と「鍵の入れ替えで読めない」を
 * 画面が区別できないと、利用者には「勝手にSlack通知が止まった」としか見えない。
 */
export type IntegrationStatus =
  /** 復号でき、有効。実際に配信できる唯一の状態。 */
  | "connected"
  /** 行はあるが復号できない（AUTH_SECRET の入れ替え、値の破損）。 */
  | "unreadable"
  /** 行はあるが無効化されている。getSecret が null を返すので配信されない。 */
  | "disabled"
  /** そもそも接続されていない。 */
  | "disconnected";

/** What a settings screen may safely see. Never includes the secret. */
export interface IntegrationSummary {
  provider: Provider;
  /**
   * 実際に配信できるときだけ true。判定は getSecret と同じ条件
   * （enabled かつ復号できる）にそろえてある。ここがずれると、カードは
   * 「接続済み」と出しているのにアラートは黙って送られない、という
   * いちばん気づけない壊れ方をする。
   */
  connected: boolean;
  enabled: boolean;
  /** Masked credential, e.g. "http…be12". Null when not connected. */
  masked: string | null;
  config: Record<string, unknown>;
  lastOkAt: string | null;
  lastError: string | null;
  /**
   * 任意なのは、この型のリテラルを組み立てている既存のルート（Notion 側の
   * DISCONNECTED など）を壊さないため。summarise は常に埋める。
   */
  status?: IntegrationStatus;
}

/** 通知先チャンネル名の控え（config.channelHint）の上限。 */
export const CHANNEL_HINT_MAX = 60;

/**
 * 利用者が入力したチャンネル名の控えを、保存できる形に整える。
 * これは表示用のメモであって宛先ではない（宛先は Webhook URL 自体が持つ）ので、
 * 記号の付け方は矯正せず、前後の空白と長さだけを揃える。
 */
export function normaliseChannelHint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().replace(/\s+/g, " ");
  if (!s) return null;
  return s.slice(0, CHANNEL_HINT_MAX);
}

/** 保存済み config から通知先チャンネルの控えを読む。壊れていれば null。 */
export function readChannelHint(
  config: Record<string, unknown> | null | undefined,
): string | null {
  if (!config) return null;
  return normaliseChannelHint(config.channelHint);
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
      // config を渡されたときは丸ごと置き換える。空オブジェクトを渡せば控えを
      // 消せる、という「入力欄を空にしたら消える」挙動と一致させるため。
      ...(config ? { config: toJson(config) } : {}),
      enabled: true,
      // 認証情報を入れ替えたら履歴も一緒にリセットする。lastOkAt を残すと、
      // 別のチャンネルのWebhookに差し替えたのに前のWebhookの成功時刻が
      // 「最終送信」として残り、新しい宛先に届いた証拠に見えてしまう。
      lastOkAt: null,
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
        status: "disconnected",
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
  // 「配信できる」の定義は getSecret ただ一つ。無効化された行も、鍵の入れ替えで
  // 復号できなくなった行も、getSecret は null を返す＝送られない。画面の
  // 「接続済み」も同じ条件で出す。
  const status: IntegrationStatus = !row.enabled
    ? "disabled"
    : plain === null
      ? "unreadable"
      : "connected";

  return {
    provider: row.provider as Provider,
    connected: status === "connected",
    enabled: row.enabled,
    masked: status === "connected" && plain ? maskSecret(plain) : null,
    config: (row.config as Record<string, unknown>) ?? {},
    lastOkAt: row.lastOkAt ? row.lastOkAt.toISOString() : null,
    lastError: row.lastError,
    status,
  };
}
