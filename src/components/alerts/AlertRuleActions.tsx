"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Per-rule controls: an enabled toggle and a delete action. Kept small so the
 * rule list itself can stay a server-rendered list.
 */
export function AlertRuleActions({
  id,
  enabled,
}: {
  id: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(enabled);

  async function toggle() {
    setBusy(true);
    const next = !on;
    try {
      const res = await fetch(`/api/alerts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) {
        setOn(next);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("このアラートを削除しますか？")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/alerts/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        role="switch"
        aria-checked={on}
        aria-label={on ? "有効（クリックで停止）" : "停止中（クリックで有効化）"}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          on ? "bg-khaki-500" : "bg-ink-line"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            on ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="text-sm text-ink-muted hover:text-danger disabled:opacity-50"
      >
        削除
      </button>
    </div>
  );
}
