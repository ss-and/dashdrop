"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NavIcon } from "@/components/app/icons";
import { Button } from "@/components/ui/Button";

/**
 * 「顧客データベースをはじめる」「人事データベースをはじめる」 — installs one of
 * the built-in master databases and refreshes the page so it appears.
 *
 * Both installs are idempotent server-side, so a double press is harmless.
 */
const MASTERS = {
  crm: {
    endpoint: "/api/crm/install",
    label: "顧客データベースをはじめる",
    failure: "顧客データベースの作成に失敗しました",
  },
  hr: {
    endpoint: "/api/hr/install",
    label: "人事データベースをはじめる",
    failure: "人事データベースの作成に失敗しました",
  },
} as const;

export function SetupMasterButton({
  kind,
  label,
  withSampleData = true,
  variant = "primary",
  size = "md",
}: {
  kind: keyof typeof MASTERS;
  label?: string;
  withSampleData?: boolean;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
  const master = MASTERS[kind];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(master.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withSampleData }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? master.failure);
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
      <Button
        type="button"
        onClick={run}
        disabled={busy}
        variant={variant}
        size={size}
      >
        <NavIcon name="sparkles" className="h-4 w-4" />
        {busy ? "作成中…" : (label ?? master.label)}
      </Button>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
