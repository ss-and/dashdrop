"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NavIcon } from "./icons";
import { NotificationBell } from "./NotificationBell";
import { HelpButton } from "./HelpButton";
import { AppLauncher, type NavData } from "./AppLauncher";
import { ObjectNav, type ObjectNavItem } from "./ObjectNav";
import { getPlanBadge } from "./plan-badge";
import type { CurrentUser } from "@/lib/auth";

/** How many extra (non-CRM) sheets appear as object tabs. */
const EXTRA_TABS = 4;

/** Builds the object tab strip: ホーム + CRM objects + a few more sheets. */
function buildNavItems(data: NavData | null): ObjectNavItem[] {
  const items: ObjectNavItem[] = [{ href: "/home", label: "ホーム" }];
  if (!data) return items;

  for (const c of data.crm) {
    items.push({ href: `/c/${c.id}`, label: c.name });
  }

  const extras = [
    ...data.workbooks.flatMap((w) => w.sheets),
    ...data.looseSheets,
  ].slice(0, EXTRA_TABS);
  for (const s of extras) {
    items.push({ href: `/c/${s.id}`, label: s.name });
  }

  return items;
}

/**
 * Top bar: app launcher + page title on the left, workspace/plan/account on the
 * right, with the Salesforce-style object tab strip as a second row. The single
 * /api/nav fetch lives here and is shared by the launcher and the tab strip.
 */
export function Topbar({ user, title }: { user: CurrentUser; title?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [nav, setNav] = useState<NavData | null>(null);
  const [navLoading, setNavLoading] = useState(true);
  const [navError, setNavError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/nav");
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body?.ok) {
          setNavError(body?.error ?? "ナビゲーションの読み込みに失敗しました");
          return;
        }
        setNav(body.data as NavData);
      } catch {
        if (!cancelled) setNavError("ナビゲーションの読み込みに失敗しました");
      } finally {
        if (!cancelled) setNavLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const navItems = buildNavItems(nav);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const initial = user.name.trim().charAt(0) || "U";
  const plan = getPlanBadge(user.workspace.plan);

  return (
    <header className="shrink-0 border-b border-ink-line bg-paper-raised">
      <div className="flex h-14 items-center justify-between px-5">
        <div className="flex min-w-0 items-center gap-3">
          <AppLauncher data={nav} loading={navLoading} error={navError} />
          <span className="h-5 w-px shrink-0 bg-ink-line" aria-hidden="true" />
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

          <NotificationBell />

          <HelpButton />

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
      </div>

      <ObjectNav items={navItems} />
    </header>
  );
}
