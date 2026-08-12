"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NavIcon } from "@/components/app/icons";

/**
 * Adds every sample sheet in a category at once — the fastest way to fill an
 * empty workspace with something that looks like a real company's files.
 */
export function AddCategoryButton({
  sampleKeys,
  label = "まとめて追加",
}: {
  sampleKeys: string[];
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addAll() {
    if (sampleKeys.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sample-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: sampleKeys }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "追加に失敗しました");
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
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={addAll}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded border border-ink-line bg-paper-raised px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-khaki-300 hover:text-khaki-800 disabled:opacity-60"
      >
        <NavIcon name="plus" className="h-3.5 w-3.5" />
        {busy ? "追加中…" : `${label}（${sampleKeys.length}件）`}
      </button>
      {error && (
        <p className="text-2xs leading-relaxed text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
