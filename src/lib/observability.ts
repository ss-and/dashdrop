/**
 * 本番で起きたことに気づくための最小限。
 *
 * これまで例外は `console.error` で終わっていた。手元では十分だが、公開すると
 * 誰もそのログを見ない——「たまに失敗する」が誰にも気づかれないまま残る。
 *
 * 外部サービス（Sentry 等）を前提にしない。依存を1つ増やすより、
 *   1. 機械が読める形（1行JSON）で必ず吐く
 *   2. ERROR_WEBHOOK_URL があればそこへ投げる
 * の2つで足りる。ログ収集は運用側の選択に任せられるし、Webhook さえあれば
 * Slack にも監視SaaSにも繋がる。
 */
import { env } from "./env";

export interface ErrorContext {
  /** どこで起きたか（"api:/api/import" など）。 */
  where: string;
  /** ワークスペースID。個人を特定しない範囲での切り分けに使う。 */
  workspaceId?: string;
  /** 付帯情報。**個人情報や取り込んだ中身は入れないこと。** */
  extra?: Record<string, unknown>;
}

/** 送信の待ち時間。監視のために本体の応答を遅らせない。 */
const WEBHOOK_TIMEOUT_MS = 3000;

function serialise(err: unknown): { message: string; stack?: string; name?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

/**
 * 例外を記録する。**決して例外を投げない**（監視のせいで本体が倒れる方が損害が
 * 大きい）。Webhook への送信は待たない。
 */
export function reportError(err: unknown, ctx: ErrorContext): void {
  const detail = serialise(err);
  const record = {
    level: "error",
    at: new Date().toISOString(),
    where: ctx.where,
    workspaceId: ctx.workspaceId,
    ...detail,
    ...(ctx.extra ?? {}),
  };

  // 1行JSON。ログ収集側で必ず構造化して拾える形にする。
  try {
    console.error(JSON.stringify(record));
  } catch {
    console.error("reportError:", ctx.where, detail.message);
  }

  const url = env.ERROR_WEBHOOK_URL;
  if (!url) return;
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // スタックはそのまま投げると長すぎることがあるので頭だけ。
    body: JSON.stringify({
      ...record,
      stack: detail.stack?.split("\n").slice(0, 12).join("\n"),
    }),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  }).catch(() => {
    /* 監視が届かないことで本体を止めない */
  });
}
