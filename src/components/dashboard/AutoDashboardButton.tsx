"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NavIcon } from "@/components/app/icons";

/**
 * "おすすめ構成で自動作成" — one click builds a starter dashboard from a file
 * (workbook) or a single sheet, then navigates to it. Errors surface inline.
 */
export function AutoDashboardButton({
  workbookId,
  collectionId,
  label = "おすすめ構成で自動作成",
  className,
}: {
  workbookId?: string;
  collectionId?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboards/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          workbookId ? { workbookId } : { collectionId },
        ),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "自動作成に失敗しました");
        return;
      }
      router.push("/d/" + body.data.dashboardId);
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={
          className ??
          "inline-flex h-9 items-center gap-2 rounded border border-khaki-300 bg-khaki-50 px-3 text-sm font-medium text-khaki-800 transition-colors hover:bg-khaki-100 disabled:opacity-60"
        }
      >
        <NavIcon name="sparkles" className="h-4 w-4 text-khaki-600" />
        {busy ? "作成中…" : label}
      </button>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
