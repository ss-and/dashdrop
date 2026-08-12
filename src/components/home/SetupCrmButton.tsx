"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NavIcon } from "@/components/app/icons";
import { Button } from "@/components/ui/Button";

/**
 * 「顧客データベースをはじめる」 — creates the CRM core objects (顧客 / 担当者 /
 * 商談 / 活動) in the workspace via POST /api/crm/install, then refreshes the
 * home page so the new database appears. Idempotent server-side, so a double
 * press is harmless.
 */
export function SetupCrmButton({
  label = "顧客データベースをはじめる",
  withSampleData = true,
  variant = "primary",
  size = "md",
}: {
  label?: string;
  withSampleData?: boolean;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withSampleData }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "顧客データベースの作成に失敗しました");
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
    <div className="flex flex-col items-start gap-1.5">
      <Button type="button" onClick={run} disabled={busy} variant={variant} size={size}>
        <NavIcon name="sparkles" className="h-4 w-4" />
        {busy ? "作成中…" : label}
      </Button>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
