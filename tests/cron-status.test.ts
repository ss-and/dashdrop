/**
 * 「定期実行が動くか」を画面が同じ答えで語ることを確かめる。
 *
 * `/api/cron/alerts` も `/api/reports/dispatch` も、CRON_SECRET が未設定なら
 * 必ず 503 を返す。それでもアラート画面だけは「しきい値を超えたら通知します」と
 * 書くだけで、鳴らないことを黙っていた（レポート画面には警告があった）。
 * 判定と文面を1か所に集めた以上、**動かない場合の文が必ず出ること**を
 * テストで固定しておく。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  scheduledRunPossible,
  scheduledRunNote,
  ALERT_SWEEP_COPY,
  REPORT_DISPATCH_COPY,
} from "@/lib/cron-status";

const original = process.env.CRON_SECRET;

afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

describe("scheduledRunPossible", () => {
  it("秘密鍵が無い・空白だけなら「動かない」", () => {
    delete process.env.CRON_SECRET;
    expect(scheduledRunPossible()).toBe(false);

    // authorizeCron も trim して空なら 503 を返す。判定をそこに揃える。
    process.env.CRON_SECRET = "   ";
    expect(scheduledRunPossible()).toBe(false);
  });

  it("秘密鍵があれば「動く見込みあり」", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(scheduledRunPossible()).toBe(true);
  });
});

describe("scheduledRunNote", () => {
  it("動かない環境では、動かないと言い切って手動の逃げ道を示す", () => {
    const alerts = scheduledRunNote(ALERT_SWEEP_COPY, false);
    expect(alerts).toContain("この環境では自動評価は動きません");
    expect(alerts).toContain("CRON_SECRET が未設定");
    expect(alerts).toContain("今すぐ評価する");

    const reports = scheduledRunNote(REPORT_DISPATCH_COPY, false);
    expect(reports).toContain("この環境では自動配信は動きません");
    expect(reports).toContain("今すぐ受け取る");
  });

  it("動く環境では、どこが呼ばれたときに動くのかを書く", () => {
    expect(scheduledRunNote(ALERT_SWEEP_COPY, true)).toContain(
      "/api/cron/alerts",
    );
    expect(scheduledRunNote(REPORT_DISPATCH_COPY, true)).toContain(
      "/api/reports/dispatch",
    );
  });

  it("アラートとレポートで文体が揃っている（片方だけ黙らない）", () => {
    // 語（自動評価 / 自動配信、ボタン名、受け口）を除けば同じ形であること。
    const normalise = (s: string) =>
      s
        .replace(/自動評価|自動配信/g, "＜処理＞")
        .replace(/今すぐ評価する|今すぐ受け取る/g, "＜ボタン＞")
        .replace(/\/api\/[\w/-]+/g, "＜受け口＞");

    for (const possible of [true, false]) {
      expect(normalise(scheduledRunNote(ALERT_SWEEP_COPY, possible))).toBe(
        normalise(scheduledRunNote(REPORT_DISPATCH_COPY, possible)),
      );
    }
  });
});
