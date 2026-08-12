"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NavIcon } from "@/components/app/icons";

/**
 * Adds one 参考スプレッドシート to the workspace and jumps straight into it, so
 * the user sees real rows rather than an empty table.
 */
export function AddSampleButton({
  sampleKey,
  label = "追加",
}: {
  sampleKey: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sample-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [sampleKey] }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "追加に失敗しました");
        return;
      }
      const created = body.data?.created as
        | Array<{ id: string; name: string }>
        | undefined;
      if (created && created.length > 0) {
        router.push(`/c/${created[0].id}`);
        router.refresh();
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
        onClick={add}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded border border-khaki-300 bg-khaki-50 px-2.5 py-1.5 text-xs font-medium text-khaki-800 transition-colors hover:bg-khaki-100 disabled:opacity-60"
      >
        <NavIcon name="plus" className="h-3.5 w-3.5" />
        {busy ? "追加中…" : label}
      </button>
      {error && (
        <p className="text-2xs leading-relaxed text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
