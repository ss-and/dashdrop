/**
 * Slack delivery for a workspace's incoming webhook.
 *
 * Two halves that are deliberately kept apart:
 *  - `buildMessage` / `postToSlack` are pure-ish transport. They never touch the
 *    database, so this module stays importable outside a request (and in tests)
 *    without `server-only`.
 *  - `notifyWorkspaceSlack` resolves the *per-workspace* credential. A single
 *    deployment-wide webhook would post every tenant's alerts into one channel,
 *    so the credential always comes from the workspace's Integration row.
 *
 * Nothing here throws: a notification channel failing must never take down the
 * action that triggered it (an alert evaluation, a report send, a settings page).
 */

const USER_AGENT = "DashDrop/1.0 (+https://dashdrop.app)";

/** Slack rejects a section whose text exceeds 3000 chars; stay well under. */
const MAX_SECTION_TEXT = 2800;
const MAX_FALLBACK_TEXT = 2000;
/** Block Kit allows 10 elements in a `fields` array. */
const MAX_FIELDS = 10;
/** How much of an unexpected error body we quote back to the user. */
const EXCERPT_LEN = 160;

const TIMEOUT_MS = 8000;

/** 行き先を呼び出し側が指定しなかったときのリンク文言。 */
const DEFAULT_LINK_LABEL = "DashDrop で開く";

export interface SlackBlockMessage {
  text: string;
  blocks?: unknown[];
}

export interface SlackMessageInput {
  title: string;
  body?: string;
  url?: string;
  /**
   * リンクの表示文言。「DashDrop で開く」だけでは、押した先がダッシュボードなのか
   * 対象のシートなのか分からないため、呼び出し側が行き先を名乗れるようにする。
   */
  linkLabel?: string;
  fields?: { label: string; value: string }[];
}

export type SlackResult = { ok: true } | { ok: false; error: string };

/** Slack mrkdwn treats these three characters as markup. */
function escapeMrkdwn(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clamp(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Build a Block Kit message. `text` is always populated: Slack uses it for the
 * push/desktop notification and for screen readers, and a message with blocks
 * but no fallback text shows up blank in those places.
 */
export function buildMessage(input: SlackMessageInput): SlackBlockMessage {
  const title = clamp(String(input.title ?? "").trim(), 300) || "DashDrop";
  const body = clamp(String(input.body ?? "").trim(), MAX_SECTION_TEXT);
  // Slack's link syntax breaks past ~3000 chars; a URL that long is malformed
  // anyway, so cap it rather than emit a block Slack will reject.
  const url = clamp(String(input.url ?? "").trim(), 900);
  const linkLabel =
    clamp(String(input.linkLabel ?? "").trim(), 120) || DEFAULT_LINK_LABEL;
  const fields = (Array.isArray(input.fields) ? input.fields : [])
    .filter((f) => f && (f.label || f.value))
    .slice(0, MAX_FIELDS);

  const blocks: unknown[] = [];

  const headline = body
    ? `*${escapeMrkdwn(title)}*\n${escapeMrkdwn(body)}`
    : `*${escapeMrkdwn(title)}*`;
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: clamp(headline, MAX_SECTION_TEXT) },
  });

  // Two-column layout: Slack lays a `fields` array out in two columns itself.
  if (fields.length > 0) {
    blocks.push({
      type: "section",
      fields: fields.map((f) => ({
        type: "mrkdwn",
        text: clamp(
          `*${escapeMrkdwn(f.label)}*\n${escapeMrkdwn(f.value)}`,
          1900,
        ),
      })),
    });
  }

  if (url) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        // ラベルもURLと同じくエスケープする。行き先の名前（シート名など）は
        // 利用者が入力した文字列なので、<!channel> を通してはいけない。
        // 全体を clamp するのは、`&` だらけのURLがエスケープで膨らんでも
        // section の 3000 文字制限を超えないようにするため。
        text: clamp(
          `<${escapeMrkdwn(url)}|${escapeMrkdwn(linkLabel)}>`,
          MAX_SECTION_TEXT,
        ),
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "DashDrop からの通知" }],
  });

  // フォールバックの text にもブロックと同じエスケープをかける。ここを素通しに
  // すると、シート名やアラート名に <!channel> と書くだけで、通知先チャンネル
  // 全員をメンションできてしまう（ブロック側は既に無害化済み）。
  const fallbackParts = [escapeMrkdwn(title)];
  if (body) fallbackParts.push(escapeMrkdwn(body));
  for (const f of fields)
    fallbackParts.push(`${escapeMrkdwn(f.label)}: ${escapeMrkdwn(f.value)}`);
  if (url) fallbackParts.push(escapeMrkdwn(url));

  return {
    text: clamp(fallbackParts.join(" / ").trim() || "DashDrop", MAX_FALLBACK_TEXT),
    blocks,
  };
}

const WEBHOOK_DEAD = "Webhookが無効です。Slack側で再作成してください。";

/** Map Slack's plain-text error bodies to something a Japanese user can act on. */
function mapSlackError(status: number, bodyRaw: string): string {
  const body = bodyRaw.trim().toLowerCase();

  if (body.includes("invalid_payload")) {
    return "送信内容の形式が正しくありません。時間をおいて再度お試しください。";
  }
  if (body.includes("channel_not_found")) {
    return "通知先のチャンネルが見つかりません。Slack側でチャンネルを確認してください。";
  }
  if (body.includes("no_service") || body.includes("no_service_id") || status === 404) {
    return WEBHOOK_DEAD;
  }
  if (body.includes("no_team") || body.includes("team_disabled")) {
    return "Slackワークスペースに接続できません。Webhookを再作成してください。";
  }
  if (body.includes("invalid_token") || status === 403) {
    return "Slackに拒否されました。Webhookの権限を確認するか、再作成してください。";
  }
  if (body.includes("action_prohibited") || body.includes("posting_to_general_channel_denied")) {
    return "Slack側の設定でこのチャンネルへの投稿が許可されていません。";
  }
  if (status === 429) {
    return "Slackの送信制限に達しました。しばらくしてから再度お試しください。";
  }

  const excerpt = clamp(bodyRaw.replace(/\s+/g, " ").trim(), EXCERPT_LEN);
  return excerpt
    ? `Slackへの送信に失敗しました（HTTP ${status}: ${excerpt}）`
    : `Slackへの送信に失敗しました（HTTP ${status}）`;
}

/**
 * POST one message to an incoming-webhook URL.
 *
 * Never throws and never hangs: a bad or slow webhook host must not stall an
 * alert run, so the request is bounded by an 8s abort signal.
 */
export async function postToSlack(
  webhookUrl: string,
  msg: SlackBlockMessage,
): Promise<SlackResult> {
  const url = typeof webhookUrl === "string" ? webhookUrl.trim() : "";
  if (!url) {
    return { ok: false, error: "Slackの Webhook URL が設定されていません。" };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return {
        ok: false,
        error: "Slackへの送信がタイムアウトしました。時間をおいて再度お試しください。",
      };
    }
    return {
      ok: false,
      error: "Slackに接続できませんでした。ネットワーク状態を確認してください。",
    };
  }

  // A webhook responds with the plain text "ok"; anything else is an error code.
  let body = "";
  try {
    body = await res.text();
  } catch {
    body = "";
  }
  const trimmed = body.trim();

  // Known error codes win over the status: Slack has been known to return them
  // with a 200 for some payload problems.
  const known =
    /invalid_payload|channel_not_found|no_service|no_team|team_disabled|invalid_token|action_prohibited|posting_to_general_channel_denied/i.test(
      trimmed,
    );
  if (!known && res.ok) return { ok: true };

  return { ok: false, error: mapSlackError(res.status, trimmed) };
}

/**
 * Deliver to the Slack workspace connected in *this* workspace's settings.
 * Returns false (silently) when Slack isn't connected — Slack is an optional
 * extra channel; the in-app notification is the one that always happens.
 */
export async function notifyWorkspaceSlack(
  workspaceId: string,
  input: SlackMessageInput,
): Promise<boolean> {
  try {
    // Imported lazily so this module has no database dependency at import time
    // (keeps it usable from tests and from any non-request context).
    const { getSecret, recordResult } = await import("./integrations");
    const webhookUrl = await getSecret(workspaceId, "slack");
    if (!webhookUrl) return false;

    const res = await postToSlack(webhookUrl, buildMessage(input));
    await recordResult(workspaceId, "slack", res.ok, res.ok ? undefined : res.error);
    return res.ok;
  } catch (err) {
    console.error("Slack notification failed", err);
    return false;
  }
}
