/**
 * 定期レポートの「次はいつ配信するか」を決める純粋なロジック。
 *
 * ルート（route.ts）から切り出してあるのは、DBもネットワークも無しで
 * 期日の判定だけをテストできるようにするため（tests/reports.test.ts）。
 * 画面（/reports）と配信の掃き出し（dispatch/route.ts）が同じ関数を使うので、
 * 「次回 ◯◯ 頃」と実際に配信される時刻がずれない。
 */

/** 対応している頻度。DBには文字列で入っているので、読むときは必ず絞り込む。 */
export const REPORT_FREQUENCIES = ["daily", "weekly", "monthly"] as const;

export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

export const FREQUENCY_LABEL: Record<ReportFrequency, string> = {
  daily: "日次",
  weekly: "週次",
  monthly: "月次",
};

export function isReportFrequency(v: string): v is ReportFrequency {
  return (REPORT_FREQUENCIES as readonly string[]).includes(v);
}

/** 未知の頻度でも画面に出せるラベルにする（DBの生の値をそのまま出さない）。 */
export function frequencyLabel(v: string): string {
  return isReportFrequency(v) ? FREQUENCY_LABEL[v] : v;
}

/**
 * 「1か月後」を求める。31日→翌月末のように、存在しない日付は月末へ丸める。
 *
 * `setMonth` に任せると 1/31 + 1か月 が 3/3 に溢れ、月次レポートが毎回
 * 少しずつ先送りされていく。丸めるのは、利用者が期待する「毎月同じころ」に
 * 近づけるため。
 */
function addOneMonth(from: Date): Date {
  const year = from.getFullYear();
  const month = from.getMonth();
  const day = from.getDate();
  // 翌月0日 = 翌月の末日。
  const lastDayOfNextMonth = new Date(year, month + 2, 0).getDate();
  const next = new Date(from);
  next.setMonth(month + 1, Math.min(day, lastDayOfNextMonth));
  return next;
}

/**
 * 次回の配信予定時刻。`since` は前回の配信時刻（未配信ならレポートの作成時刻）。
 *
 * 「毎朝9時」ではなく「前回から一定時間後」にしているのは、サーバの時計が
 * UTC で、利用者の1日の境目（JST）とずれるため。経過時間で数えるかぎり、
 * どのタイムゾーンで動かしても「日次なら1日に1回」は必ず守られる。
 * 曜日や時刻の指定は保存できる項目が無いので、約束もしない。
 */
export function nextRunAt(frequency: string, since: Date): Date {
  switch (frequency) {
    case "daily": {
      const next = new Date(since);
      next.setDate(next.getDate() + 1);
      return next;
    }
    case "monthly":
      return addOneMonth(since);
    case "weekly":
    default: {
      // 未知の頻度は週次として扱う（DBの既定値と同じ）。黙って配信を止めるより、
      // 一番おだやかな間隔で配り続けるほうが利用者の不利益が小さい。
      const next = new Date(since);
      next.setDate(next.getDate() + 7);
      return next;
    }
  }
}

/** 期日の判定に使う、レポート1件分の最小限の形。 */
export interface SchedulableReport {
  frequency: string;
  enabled: boolean;
  lastSentAt: Date | null;
  createdAt: Date;
}

/**
 * このレポートの次回配信予定。
 *
 * 未配信のものは作成時刻を起点にする（作成した瞬間に1通目が飛ぶと、
 * 作ったつもりのない通知が届いて驚かせるため）。
 */
export function scheduledNextRun(report: SchedulableReport): Date {
  return nextRunAt(report.frequency, report.lastSentAt ?? report.createdAt);
}

/** 今このレポートを配信すべきか。停止中のものは対象外。 */
export function isDue(report: SchedulableReport, now: Date): boolean {
  if (!report.enabled) return false;
  return scheduledNextRun(report).getTime() <= now.getTime();
}

/**
 * 配信すべきものだけを、期日が古い順に最大 `limit` 件返す。
 *
 * 1回の実行で無制限に配ろうとすると、実行時間の上限で途中の1件が切られる。
 * 「古い順に上限まで」なら、あふれた分は次回の実行で必ず拾える。
 */
export function selectDueReports<T extends SchedulableReport>(
  reports: T[],
  now: Date,
  limit: number,
): T[] {
  return reports
    .filter((r) => isDue(r, now))
    .sort(
      (a, b) => scheduledNextRun(a).getTime() - scheduledNextRun(b).getTime(),
    )
    .slice(0, Math.max(limit, 0));
}
