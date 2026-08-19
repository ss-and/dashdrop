/**
 * 「今すぐ受け取る」 — レポートをその場で1通作る。
 *
 * 配信手段はアプリ内通知だけ。通知から印刷 / PDF ページを開ける。
 * 以前はここで `SMTP_HOST`/`SMTP_USER` が設定されていると `channel: "email"`
 * を返し、画面が「メールで送信しました（宛先 N 件）」と表示していたが、
 * メールを送る経路はこの製品に存在しない（notify.ts にも送信処理は無い）。
 * つまり SMTP を設定した利用者ほど、届いていないものを「送った」と伝えられて
 * いた。届いたと言えるのは実際に作れた通知だけなので、通知の作成に失敗したら
 * 失敗として返す。
 *
 * 定期実行での自動配信は `src/app/api/reports/dispatch/route.ts`。
 */
import { withAuth, ok, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notify";
import { frequencyLabel } from "../../schedule";

export const POST = withAuth(async (_req, { user, params }) => {
  const workspaceId = user.workspace.id;

  const schedule = await db.reportSchedule.findFirst({
    where: { id: params.id, workspaceId },
  });
  if (!schedule) throw new ApiError("レポートが見つかりません", 404);

  const dashboard = await db.dashboard.findFirst({
    where: { id: schedule.dashboardId, workspaceId },
    select: { id: true, name: true },
  });
  if (!dashboard) throw new ApiError("ダッシュボードが見つかりません", 404);

  const created = await createNotification(workspaceId, {
    type: "report",
    title: `レポート: ${dashboard.name}`,
    body: `${frequencyLabel(schedule.frequency)}レポートのスナップショットです。開いて印刷・PDF保存できます。`,
    url: `/reports/print/${schedule.id}`,
    meta: { scheduleId: schedule.id, trigger: "manual" },
  });

  // 通知が作れていないなら、何も届いていない。成功を返してはいけない。
  if (!created) {
    throw new ApiError(
      "通知を作成できませんでした。しばらくして再度お試しください。",
      500,
    );
  }

  await db.reportSchedule.update({
    where: { id: schedule.id },
    data: { lastSentAt: new Date() },
  });

  return ok({ delivered: "inapp" as const });
});
