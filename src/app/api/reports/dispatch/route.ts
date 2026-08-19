/**
 * 定期レポートの配信エンドポイント（外部スケジューラ用）。
 *
 * これが叩かれない限り、レポートは画面の「今すぐ受け取る」を押したときしか
 * 作られない。以前は画面に「日次・週次・月次で受け取れます」と書いてあるのに
 * 配信を起動する仕組みがどこにも無く、`ReportSchedule.frequency` は保存される
 * だけの飾りだった。ここが `src/app/api/cron/alerts/route.ts` と同じ形で
 * その約束を実際に果たす。
 *
 * 配信手段はアプリ内通知（＋通知から開ける印刷 / PDF ページ）だけ。メール送信の
 * 経路はこの製品にまだ無いので、宛先も送信も扱わない。
 *
 * 呼ぶのはログイン中の利用者ではなく外部のスケジューラなので、セッション
 * Cookie を見る `withAuth` ではなく共有シークレットで守る
 * （`Authorization: Bearer $CRON_SECRET`）。設定手順は .env.example を参照。
 */
import { fail, ok } from "@/lib/api";
import { authorizeCron, cronSecret } from "@/lib/cron";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notify";
import { frequencyLabel, selectDueReports } from "../schedule";

// Prisma（Node API）を使うので Edge では動かない。
export const runtime = "nodejs";
// 認証ヘッダを読み、毎回実際に配信するのでキャッシュされては困る。
export const dynamic = "force-dynamic";
/** 1回の実行に許す秒数。どのホスティングでも通る一番狭い上限に合わせる。 */
export const maxDuration = 60;

/** 1回の実行で取り出す最大件数（DB負荷と応答サイズの上限）。 */
const MAX_CANDIDATES = 500;
/** 1回の実行で実際に配信する最大件数。あふれた分は次回の実行で拾う。 */
const MAX_PER_RUN = 200;

async function handle(req: Request) {
  const auth = authorizeCron(req.headers.get("authorization"), cronSecret());
  if (!auth.ok) return fail(auth.message, auth.status);

  const now = new Date();

  // 未配信（lastSentAt が null）を先頭に、配信が古いものから取り出す。
  // SQLite は NULL を最小として並べるので、放置されたレポートが後回しに
  // なることはない。
  const candidates = await db.reportSchedule.findMany({
    where: { enabled: true },
    orderBy: [{ lastSentAt: "asc" }, { createdAt: "asc" }],
    take: MAX_CANDIDATES,
  });

  const due = selectDueReports(candidates, now, MAX_PER_RUN);

  // ダッシュボード名は通知の見出しに使う。1件ずつ引くと N+1 になるので、
  // 対象ぶんをまとめて取り、ワークスペースで絞って別テナントの名前が
  // 混ざらないようにする。
  const dashboards = due.length
    ? await db.dashboard.findMany({
        where: {
          id: { in: [...new Set(due.map((r) => r.dashboardId))] },
          workspaceId: { in: [...new Set(due.map((r) => r.workspaceId))] },
        },
        select: { id: true, name: true, workspaceId: true },
      })
    : [];
  const nameByKey = new Map(
    dashboards.map((d) => [`${d.workspaceId}:${d.id}`, d.name]),
  );

  let delivered = 0;
  let failed = 0;
  let orphaned = 0;

  for (const report of due) {
    const name = nameByKey.get(`${report.workspaceId}:${report.dashboardId}`);
    if (!name) {
      // ダッシュボードが消えている。中身の無いレポートを配っても仕方がないが、
      // 黙って消すのも越権なので、配信せずに数えるだけにする（画面には
      // 「(削除されたダッシュボード)」として並んでいる）。
      orphaned++;
      continue;
    }

    const created = await createNotification(report.workspaceId, {
      type: "report",
      title: `レポート: ${name}`,
      body: `${frequencyLabel(report.frequency)}レポートのスナップショットです。開いて印刷・PDF保存できます。`,
      url: `/reports/print/${report.id}`,
      meta: { scheduleId: report.id, trigger: "schedule" },
    });

    // 通知を作れなかったときに lastSentAt を進めると、届いていない回を
    // 「配信済み」として飛ばしてしまう。届かなかったなら次回もう一度試す。
    if (!created) {
      failed++;
      continue;
    }

    try {
      await db.reportSchedule.update({
        where: { id: report.id },
        data: { lastSentAt: now },
      });
      delivered++;
    } catch (err) {
      // 通知は届いているので利用者への実害は無いが、記録が進まないと
      // 次回また配ってしまう。運用者が気づけるようログには残す。
      console.error(`Failed to stamp report ${report.id} as sent`, err);
      failed++;
    }
  }

  const message =
    due.length === 0
      ? "配信予定のレポートはありませんでした。"
      : `対象 ${due.length} 件のうち ${delivered} 件を配信しました。` +
        (failed > 0 ? `${failed} 件は配信できませんでした。` : "") +
        (orphaned > 0
          ? `${orphaned} 件はダッシュボードが見つからないため見送りました。`
          : "");

  // 通知が来ないと言われたときに追える場所を1つ増やしておく。
  console.info(`[cron] reports: ${message}`);

  return ok({
    candidates: candidates.length,
    due: due.length,
    delivered,
    failed,
    orphaned,
    message,
  });
}

/** Vercel Cron は GET で呼ぶ。 */
export async function GET(req: Request) {
  return handle(req);
}

/** curl や他のスケジューラからは POST でも呼べるようにしておく。 */
export async function POST(req: Request) {
  return handle(req);
}
