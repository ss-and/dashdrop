"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Select, Label } from "@/components/ui/Input";

/**
 * レポート作成フォーム: ダッシュボードと頻度を選ぶだけ。POST /api/reports に
 * 送って一覧を更新する。APIのエラーはその場に出す。
 *
 * 宛先メールの入力欄は置かない。メールを送る経路が製品に無く、預かった
 * アドレスは一度も使われないため（配信はアプリ内通知＋印刷 / PDF）。
 */
export function ReportForm({
  dashboards,
}: {
  dashboards: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [dashboardId, setDashboardId] = useState(dashboards[0]?.id ?? "");
  const [frequency, setFrequency] = useState("weekly");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dashboardId) {
      setError("ダッシュボードを選択してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboardId, frequency }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok)
        throw new Error(json.error ?? "レポートの作成に失敗しました");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "レポートの作成に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  if (dashboards.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        レポートを作成するには、まずダッシュボードを追加してください。
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="rf-dashboard">ダッシュボード</Label>
        <Select
          id="rf-dashboard"
          value={dashboardId}
          onChange={(e) => setDashboardId(e.target.value)}
        >
          {dashboards.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="rf-frequency">頻度</Label>
        <Select
          id="rf-frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
        >
          <option value="daily">日次</option>
          <option value="weekly">週次</option>
          <option value="monthly">月次</option>
        </Select>
      </div>

      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={saving}>
        {saving ? "作成中…" : "レポートを作成"}
      </Button>
    </form>
  );
}
