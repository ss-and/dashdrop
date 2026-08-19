/**
 * 定期実行のエンドポイント。全ワークスペースのアラートを評価する。
 *
 * これが叩かれない限り、アラートは画面の「今すぐ評価する」を押したときしか
 * 動かない。呼ぶのはログイン中の利用者ではなく外部のスケジューラなので、
 * セッションCookieを見る `withAuth` ではなく共有シークレットで守る
 * （`Authorization: Bearer $CRON_SECRET`）。設定手順は .env.example を参照。
 */
import { fail, ok } from "@/lib/api";
import {
  authorizeCron,
  cronSecret,
  dbSweepDeps,
  runAlertSweep,
} from "@/lib/cron";

// 評価はPrisma（Node API）とWebhookのPOSTを行うのでEdgeでは動かない。
export const runtime = "nodejs";
// 認証ヘッダを読み、毎回実際に評価するので、キャッシュされては困る。
export const dynamic = "force-dynamic";
/**
 * 1回の実行に許す秒数。`CRON_MAX_DURATION_SECONDS` と同じ値にすること
 * （Next.js はこの宣言を静的に読むため、定数の import では書けない）。
 * 実際に使う時間は `DEFAULT_BUDGET_MS`（50秒）で、残りは集計と応答に充てる。
 */
export const maxDuration = 60;

async function handle(req: Request) {
  const auth = authorizeCron(req.headers.get("authorization"), cronSecret());
  if (!auth.ok) return fail(auth.message, auth.status);

  const result = await runAlertSweep(dbSweepDeps());

  // 実行の記録はプラットフォームのログにも残す。応答はスケジューラしか
  // 見ないので、通知が来ないと言われたときに追える場所を1つ増やしておく。
  console.info(`[cron] alerts: ${result.message}`);

  return ok(result);
}

/** Vercel Cron は GET で呼ぶ。 */
export async function GET(req: Request) {
  return handle(req);
}

/** curl や他のスケジューラからは POST でも呼べるようにしておく。 */
export async function POST(req: Request) {
  return handle(req);
}
