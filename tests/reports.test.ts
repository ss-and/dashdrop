/**
 * 定期レポートの回帰テスト。
 *
 * 直そうとしている不具合:
 *  - 画面には「日次・週次・月次で受け取れます」と書いてあり、一覧には「有効」の
 *    バッジまで出ていたのに、`ReportSchedule.frequency` を読む場所がどこにも
 *    無かった。つまり配信は「今すぐ送信」を人が押したときにしか起きない。
 *  - `frequency` を実際に使うようになった以上、期日の数え方（特に月次の
 *    月末まわり）が狂うと、毎月少しずつ遅れる／二重に配る、が起きる。
 *
 * ここでテストするのは期日の判定だけ。DBもネットワークも要らないよう、
 * `src/app/api/reports/schedule.ts` は純粋関数だけで書いてある。
 */
import { describe, it, expect } from "vitest";
import {
  frequencyLabel,
  isDue,
  isReportFrequency,
  nextRunAt,
  scheduledNextRun,
  selectDueReports,
  type SchedulableReport,
} from "@/app/api/reports/schedule";

function report(over: Partial<SchedulableReport> = {}): SchedulableReport {
  return {
    frequency: "daily",
    enabled: true,
    lastSentAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

describe("nextRunAt（次回の配信時刻）", () => {
  it("日次は1日後、週次は7日後", () => {
    const from = new Date("2026-01-01T09:00:00Z");
    expect(nextRunAt("daily", from).toISOString()).toBe(
      "2026-01-02T09:00:00.000Z",
    );
    expect(nextRunAt("weekly", from).toISOString()).toBe(
      "2026-01-08T09:00:00.000Z",
    );
  });

  it("月次は暦の1か月後", () => {
    const from = new Date(2026, 0, 15, 9, 0, 0); // 1/15 ローカル時刻
    const next = nextRunAt("monthly", from);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(1); // 2月
    expect(next.getDate()).toBe(15);
  });

  it("月末は溢れさせずに翌月末へ丸める（1/31 → 2/28）", () => {
    const from = new Date(2026, 0, 31, 9, 0, 0);
    const next = nextRunAt("monthly", from);
    expect(next.getMonth()).toBe(1); // 2月であること（3月へ溢れない）
    expect(next.getDate()).toBe(28);
  });

  it("未知の頻度は週次として扱う（黙って止めない）", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(nextRunAt("yearly", from).toISOString()).toBe(
      "2026-01-08T00:00:00.000Z",
    );
  });
});

describe("isDue（配信すべきか）", () => {
  it("未配信でも、作成直後には配らない", () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const r = report({ createdAt: created, lastSentAt: null });
    expect(isDue(r, new Date("2026-01-01T00:00:01Z"))).toBe(false);
    expect(isDue(r, new Date("2026-01-02T00:00:00Z"))).toBe(true);
  });

  it("前回の配信からの経過で数える", () => {
    const r = report({
      frequency: "weekly",
      lastSentAt: new Date("2026-03-01T00:00:00Z"),
    });
    expect(isDue(r, new Date("2026-03-07T23:59:59Z"))).toBe(false);
    expect(isDue(r, new Date("2026-03-08T00:00:00Z"))).toBe(true);
  });

  it("停止中のレポートは、どれだけ経っても対象にならない", () => {
    const r = report({
      enabled: false,
      lastSentAt: new Date("2020-01-01T00:00:00Z"),
    });
    expect(isDue(r, new Date("2026-01-01T00:00:00Z"))).toBe(false);
  });

  it("画面に出す「次回」と、実際に配る判定は同じ関数を使う", () => {
    const r = report({
      frequency: "weekly",
      lastSentAt: new Date("2026-03-01T00:00:00Z"),
    });
    const next = scheduledNextRun(r);
    expect(isDue(r, new Date(next.getTime() - 1))).toBe(false);
    expect(isDue(r, next)).toBe(true);
  });
});

describe("selectDueReports（1回の実行で配る分）", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("期日の古いものから、上限まで返す", () => {
    const reports = [
      { ...report({ lastSentAt: new Date("2026-05-30T00:00:00Z") }), id: "新" },
      { ...report({ lastSentAt: new Date("2026-01-01T00:00:00Z") }), id: "古" },
      { ...report({ lastSentAt: new Date("2026-03-01T00:00:00Z") }), id: "中" },
    ];
    expect(selectDueReports(reports, now, 2).map((r) => r.id)).toEqual([
      "古",
      "中",
    ]);
  });

  it("まだ期日でないもの・停止中のものは混ぜない", () => {
    const reports = [
      { ...report({ lastSentAt: new Date("2026-05-31T23:00:00Z") }), id: "まだ" },
      {
        ...report({ enabled: false, lastSentAt: new Date("2020-01-01T00:00:00Z") }),
        id: "停止",
      },
      { ...report({ lastSentAt: new Date("2026-01-01T00:00:00Z") }), id: "対象" },
    ];
    expect(selectDueReports(reports, now, 10).map((r) => r.id)).toEqual([
      "対象",
    ]);
  });

  it("上限が0以下でも落ちない", () => {
    const reports = [{ ...report({ lastSentAt: null }), id: "x" }];
    expect(selectDueReports(reports, now, 0)).toEqual([]);
    expect(selectDueReports(reports, now, -5)).toEqual([]);
  });
});

describe("頻度のラベル", () => {
  it("既知の頻度は日本語になる", () => {
    expect(frequencyLabel("daily")).toBe("日次");
    expect(frequencyLabel("weekly")).toBe("週次");
    expect(frequencyLabel("monthly")).toBe("月次");
  });

  it("未知の値はそのまま返す（何が保存されているか隠さない）", () => {
    expect(frequencyLabel("hourly")).toBe("hourly");
    expect(isReportFrequency("hourly")).toBe(false);
    expect(isReportFrequency("daily")).toBe(true);
  });
});
