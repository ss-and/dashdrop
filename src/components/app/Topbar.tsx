"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NavIcon } from "./icons";
import { getPlanBadge } from "./plan-badge";
import type { CurrentUser } from "@/lib/auth";

/** Top bar with page title slot, workspace name, plan, and account menu. */
export function Topbar({ user, title }: { user: CurrentUser; title?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const initial = user.name.trim().charAt(0) || "U";
  const plan = getPlanBadge(user.workspace.plan);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-ink-line bg-paper-raised px-5">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold text-ink">
          {title ?? "ダッシュボード"}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden sm:flex items-center gap-1.5 text-sm text-ink-muted">
          {user.workspace.name}
          <span
            className={`rounded-sm border px-1.5 py-0.5 text-2xs font-semibold ${plan.className}`}
          >
            {plan.label}
          </span>
        </span>

        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-khaki-500 text-sm font-semibold text-white"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="アカウントメニュー"
          >
            {initial}
          </button>
          {open && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 z-20 mt-2 w-56 animate-fade-in rounded-md border border-ink-line bg-paper-raised p-1.5 shadow-raised">
                <div className="px-3 py-2">
                  <p className="truncate text-sm font-medium text-ink">
                    {user.name}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {user.email}
                  </p>
                </div>
                <div className="my-1 border-t border-ink-line" />
                <button
                  onClick={logout}
                  disabled={loggingOut}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink-soft hover:bg-paper-sunken disabled:opacity-50"
                >
                  <NavIcon name="logout" className="h-4 w-4" />
                  ログアウト
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
