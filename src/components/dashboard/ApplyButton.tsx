"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui/Button";

/**
 * Applies a template to the workspace, then navigates to the new dashboard.
 * Shows a loading state while the (potentially slow, sample-seeding) apply
 * runs, and surfaces any error inline.
 */
export function ApplyButton({
  templateKey,
  className,
  variant = "primary",
  size = "md",
  label = "このダッシュボードを使う",
}: {
  templateKey: string;
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  label?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboards/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateKey }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "作成に失敗しました");
      }
      router.push(`/d/${json.data.dashboardId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成に失敗しました");
      setLoading(false);
    }
  }

  return (
    <div className={className}>
      <Button size={size} variant={variant} onClick={apply} disabled={loading}>
        {loading ? "作成中…" : label}
      </Button>
      {error && (
        <p className="mt-1.5 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
