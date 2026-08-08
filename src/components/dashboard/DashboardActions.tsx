"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { NavIcon } from "@/components/app/icons";

/**
 * Action row for a rendered dashboard: clear seeded sample data, jump to the
 * underlying table, or delete the dashboard. Destructive actions confirm first.
 */
export function DashboardActions({
  dashboardId,
  firstCollectionId,
  hasSampleData,
}: {
  dashboardId: string;
  firstCollectionId?: string;
  hasSampleData: boolean;
}) {
  const router = useRouter();
  const [clearing, setClearing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clearSamples() {
    if (
      !confirm(
        "サンプルデータをすべて削除します。実際に入力したデータは残ります。よろしいですか？",
      )
    )
      return;
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/clear-samples`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "削除に失敗しました");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setClearing(false);
    }
  }

  async function deleteDashboard() {
    if (
      !confirm(
        "このダッシュボードを削除します。テーブルとデータは残ります。よろしいですか？",
      )
    )
      return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "削除に失敗しました");
      router.push("/dashboards");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {hasSampleData && (
          <Button
            size="sm"
            variant="secondary"
            onClick={clearSamples}
            disabled={clearing}
          >
            {clearing ? "削除中…" : "サンプルデータを削除"}
          </Button>
        )}
        {firstCollectionId && (
          <Link
            href={`/c/${firstCollectionId}`}
            className="inline-flex h-8 items-center gap-2 rounded border border-ink-line bg-paper-raised px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-sunken"
          >
            <NavIcon name="table" className="h-4 w-4" />
            テーブルを開く
          </Link>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={deleteDashboard}
          disabled={deleting}
          className="text-danger hover:bg-danger-soft"
        >
          {deleting ? "削除中…" : "削除"}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
