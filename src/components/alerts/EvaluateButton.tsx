"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * "今すぐ評価する" — runs all rules server-side now and reports how many fired.
 * Firing is edge-triggered, so re-running an unchanged workspace fires nothing.
 */
export function EvaluateButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/alerts/evaluate", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "評価に失敗しました");
      const { triggered, evaluated } = json.data as {
        triggered: number;
        evaluated: number;
      };
      setMsg(
        triggered > 0
          ? `${triggered}件のアラートが発火しました`
          : `発火なし（${evaluated}件を評価）`,
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "評価に失敗しました");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" size="sm" onClick={run} disabled={running}>
        {running ? "評価中…" : "今すぐ評価する"}
      </Button>
      {msg && <span className="text-sm text-khaki-700">{msg}</span>}
      {error && (
        <span className="text-sm text-danger" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
