"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { NavIcon } from "./icons";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string | null;
  read: boolean;
  createdAt: string;
}

/** JP relative time, e.g. "たった今" / "5分前" / "3時間前" / "2日前". */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (Number.isNaN(then)) return "";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}日前`;
  return new Date(iso).toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric",
  });
}

/**
 * Notification bell for the Topbar. Polls /api/notifications every 30s for the
 * unread count; opening the panel lists recent items and marks everything read.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      const json = await res.json();
      if (res.ok && json.ok) {
        setItems(json.data.notifications as Notification[]);
        setUnread(json.data.unread as number);
      }
    } catch {
      // Silent: the bell is best-effort; a failed poll just keeps prior state.
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function markAllRead() {
    if (unread === 0) return;
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch {
      // Refresh below reconciles if this failed.
    }
    load();
  }

  function togglePanel() {
    const next = !open;
    setOpen(next);
    if (next) markAllRead();
  }

  return (
    <div className="relative">
      <button
        onClick={togglePanel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `通知（未読${unread}件）` : "通知"}
        className="relative flex h-8 w-8 items-center justify-center rounded-full border border-ink-line text-ink-muted transition-colors hover:border-khaki-400 hover:text-khaki-600"
      >
        <NavIcon name="bell" className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-2xs font-semibold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 z-30 mt-2 w-80 animate-fade-in rounded-md border border-ink-line bg-paper-raised shadow-raised">
            <div className="flex items-center justify-between px-4 py-2.5">
              <p className="text-sm font-semibold text-ink">通知</p>
              <button
                onClick={markAllRead}
                className="text-xs font-medium text-khaki-600 hover:text-khaki-700"
              >
                すべて既読
              </button>
            </div>
            <div className="border-t border-ink-line" />
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-ink-muted">
                通知はまだありません
              </p>
            ) : (
              <ul className="max-h-96 divide-y divide-ink-line overflow-y-auto">
                {items.map((n) => {
                  const inner = (
                    <div className="flex gap-2.5">
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          n.read ? "bg-transparent" : "bg-khaki-500"
                        }`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="line-clamp-2 text-xs leading-relaxed text-ink-muted">
                            {n.body}
                          </p>
                        )}
                        <p className="mt-0.5 text-2xs text-ink-faint">
                          {relativeTime(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                  return (
                    <li key={n.id}>
                      {n.url ? (
                        <Link
                          href={n.url}
                          onClick={() => setOpen(false)}
                          className="block px-4 py-3 hover:bg-paper-sunken"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div className="px-4 py-3">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
