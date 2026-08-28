/**
 * 「この環境で定期実行は本当に動くのか」を、画面が**同じ答えで**語るための場所。
 *
 * `/api/cron/alerts` も `/api/reports/dispatch` も、入口で `authorizeCron`
 * （src/lib/cron.ts）を通る。`CRON_SECRET` が未設定なら必ず 503 を返すので、
 * 秘密鍵の無い環境では自動評価も自動配信も**一度も走らない**。
 *
 * かつてはレポート画面だけがこれを警告し、アラート画面は「しきい値を超えたら
 * 通知します」とだけ書いていた。仕組みは同じなのに片方だけが黙る——利用者から
 * 見れば「アラートは鳴らないのに誰も教えてくれない」状態で、この製品が一番
 * 避けたい形（できないことを黙って約束する）そのものだった。判定も文言も
 * ここに集めて、画面が増えたときに片方だけ黙るのを構造的に防ぐ。
 *
 * 実行する側（cron.ts）ではなくここに置いたのは、これが「画面に何を書いて
 * よいか」を決める判断だから。cron.ts は認証と一巡の実行に集中させる。
 */
import { cronSecret } from "./cron";

/**
 * 定期実行の受け口が有効か（＝自動で動く見込みがあるか）。
 *
 * 判定は `authorizeCron` の 503 条件と同じ「秘密鍵が空でないこと」。
 * ここを緩めると、画面だけが「自動で動きます」と言い続けることになる。
 * 毎回 `cronSecret()` を読むのは、実行時に差し替えた値がそのまま効くようにするため。
 */
export function scheduledRunPossible(): boolean {
  return (cronSecret() ?? "").trim().length > 0;
}

/** 画面ごとに違うのは、この3語だけ。文体は共通に保つ。 */
export interface ScheduledRunCopy {
  /** 定期実行がやること。例: 「自動配信」「自動評価」 */
  action: string;
  /** 定期実行が叩く受け口。例: "/api/reports/dispatch" */
  endpoint: string;
  /** 代わりに手で押せるボタンの名前。例: 「今すぐ受け取る」 */
  manualLabel: string;
}

/**
 * 画面に出す注記。**動く場合の説明と、動かない場合の警告を必ず対にする**。
 *
 * 「動かないときだけ何も書かない」を許すと、黙っているのが既定になって
 * また同じ非対称（レポートは警告し、アラートは黙る）が生まれる。
 * 手動の逃げ道を必ず添えるのは、断りっぱなしにしないため。
 *
 * 引数で現在値を渡せるようにしてあるのは、テストから環境変数に依存せず
 * 両方の文面を確かめられるようにするため。
 */
export function scheduledRunNote(
  copy: ScheduledRunCopy,
  possible: boolean = scheduledRunPossible(),
): string {
  if (possible) {
    return `${copy.action}は、定期実行（cron）が ${copy.endpoint} を呼び出したときに動きます。呼び出しが設定されていない環境では「${copy.manualLabel}」だけが動きます。`;
  }
  return `この環境では${copy.action}は動きません（CRON_SECRET が未設定のため、定期実行の受け口が無効です）。「${copy.manualLabel}」はいつでも使えます。`;
}

/** レポートの自動配信（`/api/reports/dispatch`）。 */
export const REPORT_DISPATCH_COPY: ScheduledRunCopy = {
  action: "自動配信",
  endpoint: "/api/reports/dispatch",
  manualLabel: "今すぐ受け取る",
};

/** アラートの自動評価（`/api/cron/alerts`）。 */
export const ALERT_SWEEP_COPY: ScheduledRunCopy = {
  action: "自動評価",
  endpoint: "/api/cron/alerts",
  manualLabel: "今すぐ評価する",
};
