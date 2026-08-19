/**
 * 定期実行（cron）でアラートを評価するための土台。
 *
 * これが無かったころ、`evaluateWorkspaceAlerts` を呼ぶのは画面の
 *「今すぐ評価する」だけだった。つまり Slack を接続してルールを書いても、
 * 誰かが /alerts を開いてボタンを押さない限り通知は一度も飛ばない。
 * 「アラートやレポートをSlackに通知します」という約束を成立させるのは、
 * このモジュールと `src/app/api/cron/alerts/route.ts` の組み合わせ。
 *
 * 設計の要点:
 *  - DBにもネットワークにも触れない純粋な部分（`authorizeCron` /
 *    `runAlertSweep`）と、実際のDBを触る部分（`dbSweepDeps`）を分ける。
 *    前者だけを差し替え可能な依存越しに書いてあるので、DBを立てずに
 *    認証・隔離・時間予算・順序の全部をテストできる。
 *  - 重い依存（`./db` と `./alerts`）は `dbSweepDeps` の中で動的 import する。
 *    slack.ts と同じ手で、このモジュール自体をリクエスト外からも読み込める
 *    ままにしておくため（`./alerts` は `server-only` を持ち込む）。
 */
import { safeEqual } from "./crypto";
import type { EvaluateResult } from "./alerts";

// ───────────────────────── 認証 ─────────────────────────

/**
 * 認証結果。失敗したときはHTTPステータスと、そのまま返せる日本語を持つ。
 */
export type CronAuth =
  | { ok: true }
  | { ok: false; status: 401 | 503; message: string };

/** 秘密鍵が未設定のときの応答。実行させない理由をそのまま運用者に見せる。 */
export const CRON_SECRET_MISSING =
  "CRON_SECRET が設定されていないため、定期実行は無効です。環境変数を設定してから再度お試しください。";

const CRON_UNAUTHORIZED = "認証に失敗しました。";

/**
 * `Authorization: Bearer <token>` からトークンだけを取り出す。
 * スキーム名の大文字小文字は仕様上どちらでもよいので揃えて比較する。
 */
function bearerToken(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const m = /^\s*Bearer\s+(.+)\s*$/i.exec(header);
  if (!m) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * 外部スケジューラからの呼び出しを検証する。ログイン中の利用者ではないので
 * `withAuth`（セッションCookie）は使えない。共有シークレットで守る。
 *
 * 未設定のときは「認証なしで実行する」ではなく **必ず断る**。ここを開けて
 * しまうと、URLを知っているだけの誰でも全テナントのアラート評価（＝Slackへの
 * 送信とDBへの書き込み）を好きなだけ起動できてしまう。
 *
 * 比較は `safeEqual`（定数時間）で行う。`===` だと一致した文字数の分だけ
 * 処理時間が延びるため、何度も叩ける相手には1文字ずつ総当たりされうる。
 *
 * DBにもネットワークにも触れない純粋関数なので、単体でテストできる。
 */
export function authorizeCron(
  header: string | null | undefined,
  secret: string | undefined,
): CronAuth {
  const expected = (secret ?? "").trim();
  if (!expected) {
    return { ok: false, status: 503, message: CRON_SECRET_MISSING };
  }

  const token = bearerToken(header);
  // ヘッダ欠落も不一致も同じ 401 にする（どちらだったかを攻撃者に教えない）。
  if (!token) return { ok: false, status: 401, message: CRON_UNAUTHORIZED };

  return safeEqual(token, expected)
    ? { ok: true }
    : { ok: false, status: 401, message: CRON_UNAUTHORIZED };
}

/**
 * 共有シークレットの現在値。
 *
 * `@/lib/env` を経由しないのは、cron 用の変数がまだあのスキーマに無いため
 * （env.ts は別の担当が持っている）。追加できるようになったら
 * `CRON_SECRET: z.string().optional().default("")` を足してここを差し替える。
 * 毎回読むのは、実行時に差し替えた値がそのまま効くようにするため。
 */
export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET;
}

// ───────────────────── 時間予算の既定値 ─────────────────────

/**
 * 1回の実行に与える上限（秒）。ルート側の `maxDuration` と一致させること。
 *
 * 60秒はどのホスティングでも通る一番狭い上限。Vercel の Pro などで
 * 伸ばせる場合は、ルートの `maxDuration` とここの両方を上げる。
 */
export const CRON_MAX_DURATION_SECONDS = 60;

/**
 * 実際に使ってよい時間。`maxDuration` より短くするのは、集計と応答の
 * 組み立てを残し、プラットフォームに途中で切られる（＝何が終わって何が
 * 残ったのか誰にも分からない）事態を避けるため。
 */
export const DEFAULT_BUDGET_MS = 50_000;

/**
 * 1ワークスペースに割く上限。
 *
 * Slackへの1投稿は最大8秒待つ（slack.ts の TIMEOUT_MS）。宛先が死んでいる
 * ワークスペースで N 件のルールが同時に発火すると、直列評価なので N×8秒を
 * 1リクエストの中で使い切ってしまう。上限を切って次のワークスペースへ
 * 移らないと、たまたま先頭に並んだ1社が全員分の時間を食う。
 */
export const DEFAULT_PER_WORKSPACE_MS = 15_000;

/**
 * これ未満しか残っていないなら新しいワークスペースに着手しない。
 * 中途半端に始めても、Slackの1投稿すら終わらずに打ち切るだけになる。
 */
export const DEFAULT_MIN_START_MS = 2_000;

/** 1回の実行で取り出す最大件数（応答サイズとDB負荷の上限）。 */
export const DEFAULT_MAX_WORKSPACES = 200;

/** 1ワークスペースあたり、応答に載せる失敗理由の上限。 */
const MAX_RULE_ERRORS_PER_WORKSPACE = 10;

// ───────────────────── 一巡（sweep）の型 ─────────────────────

/** 評価対象のワークスペース1件。 */
export interface SweepWorkspace {
  id: string;
  /**
   * 並び順の根拠にした「最後に評価を試みた時刻」。null は未評価。
   * 応答に載せるのは、順序がおかしいと疑われたときに外から確認できるようにするため。
   */
  lastAttemptedAt: Date | null;
}

/** ワークスペース1件の結果。 */
export interface SweepOutcome {
  workspaceId: string;
  /** ok=最後まで評価した / timeout=上限で打ち切った / failed=例外 */
  status: "ok" | "timeout" | "failed";
  evaluated: number;
  triggered: number;
  /** 評価に失敗したルール数（`EvaluateResult.failed`）。 */
  failedRules: number;
  /**
   * 失敗したルールの理由（件数が多いときは先頭のみ）。件数だけ返すと、
   * 運用者はサーバログを掘るしかない。文言は describeRuleError が
   * 利用者に見せてよい日本語に落としてある。
   */
  ruleErrors?: Array<{ ruleId: string; ruleName: string; message: string }>;
  durationMs: number;
  /** 失敗・打ち切りの理由（日本語）。成功時は undefined。 */
  message?: string;
}

/** 一巡の結果。運用者がそのまま読める形にしてある。 */
export interface SweepResult {
  /** 対象として取り出したワークスペース数。 */
  queued: number;
  /** 実際に着手した数。 */
  processed: number;
  /** 時間切れで手つかずのまま次回に回した数。 */
  skipped: number;
  /** 手つかずだったワークスペースのID（何が漏れたかを黙らせないため）。 */
  skippedWorkspaceIds: string[];
  /** 予算を使い切って打ち切ったか。 */
  budgetExhausted: boolean;
  evaluated: number;
  triggered: number;
  /** 失敗したルールの延べ数。 */
  failedRules: number;
  /** 例外で丸ごと失敗したワークスペース数。 */
  failedWorkspaces: number;
  /** 上限時間で打ち切ったワークスペース数。 */
  timedOut: number;
  durationMs: number;
  /** 人が読むための1行サマリ（日本語）。 */
  message: string;
  outcomes: SweepOutcome[];
}

/** 一巡に必要な外部作用。テストではここを差し替える。 */
export interface SweepDeps {
  /** 評価すべき順に、最大 limit 件のワークスペースを返す。 */
  listWorkspaces(limit: number): Promise<SweepWorkspace[]>;
  /** 着手を記録する（次回以降このワークスペースが後ろに回る）。 */
  claim(workspaceId: string): Promise<void>;
  /** 実際の評価。`evaluateWorkspaceAlerts` をそのまま呼ぶ。 */
  evaluate(workspaceId: string): Promise<EvaluateResult>;
  /** 現在時刻（ms）。テストで仮想時計に差し替える。 */
  now(): number;
}

export interface SweepOptions {
  budgetMs?: number;
  perWorkspaceMs?: number;
  minStartMs?: number;
  maxWorkspaces?: number;
}

const WORKSPACE_FAILED =
  "評価に失敗しました。ワークスペースの設定とデータベースの状態をご確認ください。";

/**
 * ワークスペース単位の失敗理由を日本語にする。
 *
 * alerts.ts の `describeRuleError` と同じ方針（例外の本文は載せない）だが、
 * あちらを import すると `server-only` と Prisma がこのモジュールに付いてきて
 * 「DBなしでテストできる」という前提が壊れるので、意図的に別実装にしてある。
 * 原因の特定はサーバログ（console.error）で行う。
 */
function describeWorkspaceError(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code: unknown }).code
      : null;
  if (typeof code === "string" && /^P1\d{3}$/.test(code)) {
    return "データベースに接続できませんでした。しばらくして再度お試しください。";
  }
  return WORKSPACE_FAILED;
}

/** `withDeadline` が時間切れを表すために使う目印。値では区別できないため Symbol。 */
const TIMED_OUT = Symbol("timed-out");

/**
 * `promise` を最大 ms ミリ秒だけ待つ。超えたら `TIMED_OUT` を返す。
 *
 * 中の処理そのものは止められない（`evaluateWorkspaceAlerts` は
 * AbortSignal を受け取らないし、alerts.ts はこの変更の担当外）。あくまで
 *「待つのをやめて次へ進み、打ち切ったことを報告する」ための仕組み。
 * 置き去りにした Promise の失敗は Promise.race が拾うので、未処理の
 * rejection にはならない。
 */
async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    // 消し忘れると、実行環境によっては応答後もプロセスが起きたままになる。
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 全ワークスペースのアラートを、時間予算の範囲で古い順に評価する。
 *
 * 1件の失敗が残りを巻き添えにしないよう、alerts.ts の `runEachIsolated` と
 * 同じく1件ずつ try/catch で隔離する（あちらはルール単位・こちらは
 * ワークスペース単位で、`AlertRuleFailure` を返す形も違うため、import では
 * なく同じ考え方の別実装にしてある）。並列にしないのも同じ理由 —
 * Slackのレート制限とDB負荷を避ける。
 *
 * DBにもネットワークにも触れない（すべて `deps` 越し）ので、単体でテストできる。
 */
export async function runAlertSweep(
  deps: SweepDeps,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const perWorkspaceMs = options.perWorkspaceMs ?? DEFAULT_PER_WORKSPACE_MS;
  const minStartMs = options.minStartMs ?? DEFAULT_MIN_START_MS;
  const maxWorkspaces = options.maxWorkspaces ?? DEFAULT_MAX_WORKSPACES;

  const startedAt = deps.now();
  const deadline = startedAt + budgetMs;

  const queue = await deps.listWorkspaces(maxWorkspaces);

  const outcomes: SweepOutcome[] = [];
  const skippedWorkspaceIds: string[] = [];
  let budgetExhausted = false;

  for (let i = 0; i < queue.length; i++) {
    const ws = queue[i];
    const remaining = deadline - deps.now();

    // 残り時間が足りないなら、着手せずに残り全部を「次回へ」と記録する。
    // 黙って半分だけ処理して成功を返すと、運用者は通知が来ない理由に
    // 気づけない。
    if (remaining < minStartMs) {
      budgetExhausted = true;
      for (let j = i; j < queue.length; j++) skippedWorkspaceIds.push(queue[j].id);
      break;
    }

    // 評価の *前* に着手を記録する。後だと、時間切れや例外で評価が
    // 完走しなかったワークスペースが毎回先頭に居座り、後続が永久に
    // 評価されない（順序の根拠は claim が進める。dbSweepDeps を参照）。
    try {
      await deps.claim(ws.id);
    } catch (err) {
      // 記録に失敗しても評価自体はやる価値がある。次回また先頭に来るだけ。
      console.error(`Failed to claim workspace ${ws.id} for the alert sweep`, err);
    }

    const cap = Math.min(perWorkspaceMs, deadline - deps.now());
    const startedWorkspaceAt = deps.now();

    try {
      const result = await withDeadline(deps.evaluate(ws.id), Math.max(cap, 0));
      if (result === TIMED_OUT) {
        outcomes.push({
          workspaceId: ws.id,
          status: "timeout",
          evaluated: 0,
          triggered: 0,
          failedRules: 0,
          durationMs: deps.now() - startedWorkspaceAt,
          message: `評価が上限時間（${Math.round(cap / 1000)}秒）に達したため中断しました。未評価のルールは次回に持ち越します。`,
        });
      } else {
        outcomes.push({
          workspaceId: ws.id,
          status: "ok",
          evaluated: result.evaluated,
          triggered: result.triggered,
          failedRules: result.failed,
          // 理由まで返す。件数だけだと、運用者はサーバログを掘るしかない。
          // describeRuleError が利用者に見せてよい日本語に落としてある。
          ruleErrors: result.errors.slice(0, MAX_RULE_ERRORS_PER_WORKSPACE),
          durationMs: deps.now() - startedWorkspaceAt,
        });
      }
    } catch (err) {
      console.error(`Alert sweep failed for workspace ${ws.id}`, err);
      outcomes.push({
        workspaceId: ws.id,
        status: "failed",
        evaluated: 0,
        triggered: 0,
        failedRules: 0,
        durationMs: deps.now() - startedWorkspaceAt,
        message: describeWorkspaceError(err),
      });
    }
  }

  const processed = outcomes.length;
  const evaluated = outcomes.reduce((n, o) => n + o.evaluated, 0);
  const triggered = outcomes.reduce((n, o) => n + o.triggered, 0);
  const failedRules = outcomes.reduce((n, o) => n + o.failedRules, 0);
  const failedWorkspaces = outcomes.filter((o) => o.status === "failed").length;
  const timedOut = outcomes.filter((o) => o.status === "timeout").length;

  return {
    queued: queue.length,
    processed,
    skipped: skippedWorkspaceIds.length,
    skippedWorkspaceIds,
    budgetExhausted,
    evaluated,
    triggered,
    failedRules,
    failedWorkspaces,
    timedOut,
    durationMs: deps.now() - startedAt,
    message: summarise({
      queued: queue.length,
      processed,
      skipped: skippedWorkspaceIds.length,
      triggered,
      failedWorkspaces,
      timedOut,
    }),
    outcomes,
  };
}

/** 一巡の結果を1行の日本語にする。ログにも応答にも同じ文を使う。 */
function summarise(s: {
  queued: number;
  processed: number;
  skipped: number;
  triggered: number;
  failedWorkspaces: number;
  timedOut: number;
}): string {
  if (s.queued === 0) return "評価対象のアラートルールがありませんでした。";

  const parts = [
    `対象 ${s.queued} ワークスペース中 ${s.processed} 件を評価し、${s.triggered} 件のアラートが発火しました。`,
  ];
  if (s.failedWorkspaces > 0) {
    parts.push(`${s.failedWorkspaces} 件は評価に失敗しました。`);
  }
  if (s.timedOut > 0) {
    parts.push(`${s.timedOut} 件は上限時間で中断しました。`);
  }
  if (s.skipped > 0) {
    parts.push(
      `${s.skipped} 件は実行時間の上限に達したため未着手です（次回の実行で先頭から評価されます）。`,
    );
  }
  return parts.join("");
}

// ───────────────────── 実際のDBに繋ぐ側 ─────────────────────

/**
 * 本番用の依存。ここだけがDBと alerts.ts に触れる。
 *
 * ■ 並び順と、実行をまたいだ前進について
 *
 * ワークスペースの件数が1回の予算に収まらないとき、毎回同じ先頭N件を
 * 評価していては末尾のテナントに通知が永久に届かない。そこで
 * 「最後に評価を試みたのが古い順」に並べる。
 *
 * Workspace にも AlertRule にも `lastEvaluatedAt` のような列は無く、
 * スキーマの変更は今回の担当外なので、既にある `AlertRule.updatedAt`
 * （Prisma の `@updatedAt`）を順序の根拠として使う。alerts.ts の評価は
 * ルールごとに `lastValue` を書き戻すので、この列は元々「最後に評価した
 * 時刻」として動いている。
 *
 * ただしそれだけでは足りない。対象シートが消えたルールは評価しても
 * 書き込みが起きず（`computeMetricValue` が null を返して素通りする）、
 * updatedAt が動かないまま毎回先頭に居座って後続を飢えさせる。そこで
 * `claim` が評価の前に、同じ値（`enabled: true`）をそのまま書き戻して
 * `@updatedAt` だけを進める。値としては何も変えないが「着手した」と
 * いう事実がスキーマを増やさずに残り、成否によらず順番が回る。
 *
 * 限界（承知のうえ）:
 *  - 列が「利用者がルールを編集した時刻」でもあるため、その意味は失われる
 *    （評価が書き戻す時点で既にそうなっていた）。
 *  - 新規作成直後のルールは updatedAt が現在時刻なので、初回の評価は
 *    最も後ろに回る。専用の列（例: `Workspace.alertsEvaluatedAt`）を
 *    足せるようになったら、そちらへ移すのが素直。
 */
export function dbSweepDeps(): SweepDeps {
  return {
    async listWorkspaces(limit: number): Promise<SweepWorkspace[]> {
      const { db } = await import("./db");
      // 有効なルールを1件も持たないワークスペースは、評価しても何も起きない
      // ので最初から対象にしない（予算をそこに使わない）。
      const groups = await db.alertRule.groupBy({
        by: ["workspaceId"],
        where: { enabled: true },
        _max: { updatedAt: true },
      });

      return groups
        .map((g) => ({
          id: g.workspaceId,
          lastAttemptedAt: g._max.updatedAt ?? null,
        }))
        // 並べ替えはアプリ側で行う。集約列の orderBy はDBによって扱いが
        // 違い、SQLite（開発）とPostgres（本番）で順序が変わるのを避ける。
        // 対象数は高々ワークスペース数なので、この程度の整列は誤差。
        .sort(
          (a, b) =>
            (a.lastAttemptedAt?.getTime() ?? 0) -
            (b.lastAttemptedAt?.getTime() ?? 0),
        )
        .slice(0, limit);
    },

    async claim(workspaceId: string): Promise<void> {
      const { db } = await import("./db");
      // 値は変えず `@updatedAt` だけを進める（上のコメント参照）。
      await db.alertRule.updateMany({
        where: { workspaceId, enabled: true },
        data: { enabled: true },
      });
    },

    async evaluate(workspaceId: string): Promise<EvaluateResult> {
      const { evaluateWorkspaceAlerts } = await import("./alerts");
      return evaluateWorkspaceAlerts(workspaceId);
    },

    now: () => Date.now(),
  };
}
