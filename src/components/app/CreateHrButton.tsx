"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NavIcon } from "./icons";

/**
 * Creates the HR database (社員 / 部署 / 勤怠 / 休暇申請 / 評価) straight from the
 * sidebar, mirroring CreateCrmButton so both master databases are set up the
 * same way.
 */
export function CreateHrButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/hr/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withSampleData: true }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "作成に失敗しました");
        return;
      }
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="flex w-full items-center justify-center gap-1.5 rounded border border-khaki-300 bg-khaki-50 px-2 py-1.5 text-xs font-medium text-khaki-800 transition-colors hover:bg-khaki-100 disabled:opacity-60"
      >
        <NavIcon name="plus" className="h-3.5 w-3.5" />
        {busy ? "作成中…" : "人事データベースを作成"}
      </button>
      {error && (
        <p className="px-1 text-2xs leading-relaxed text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
