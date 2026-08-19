"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A single left-nav row.
 *
 * Two things the old server-rendered links could not do:
 *   1. show which page you are on (the sidebar gave no current-location signal
 *      at all), and
 *   2. acknowledge a press — `active:` needs a real state, and the whole row is
 *      the hit target rather than just the label text.
 *
 * The khaki accent appears only on the selected row, which is exactly the job
 * an accent colour should be doing.
 */
export function NavItem({
  href,
  children,
  className,
  exact,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  /** Match the path exactly — for roots like /home that everything starts with. */
  exact?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  /*
   * The nav's lists are capped in height and scroll independently, so the row
   * for the page you are actually on can sit outside its list's visible box —
   * it rendered clipped in half behind the next section, which read as a broken
   * layout.
   *
   * Scrolling is done by hand rather than with `scrollIntoView`, which walks
   * every scrollable ancestor: it also scrolled the sidebar as a whole and took
   * the logo and ホーム off the top. This adjusts exactly one container — the
   * nearest scrollable one — and only when the row is genuinely outside it.
   */
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;

    let box: HTMLElement | null = el.parentElement;
    while (box && box !== document.body) {
      const overflowY = getComputedStyle(box).overflowY;
      if (/auto|scroll/.test(overflowY) && box.scrollHeight > box.clientHeight) break;
      box = box.parentElement;
    }
    if (!box || box === document.body) return;

    const row = el.getBoundingClientRect();
    const view = box.getBoundingClientRect();
    if (row.top < view.top) box.scrollTop -= view.top - row.top;
    else if (row.bottom > view.bottom) box.scrollTop += row.bottom - view.bottom;
  }, [active]);

  return (
    <Link
      ref={ref}
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        // The 2px left rule carries the selection even where the tint is subtle
        // — the tint alone disappears against an off-white nav.
        "flex items-center gap-2.5 rounded border-l-2 py-2 pl-2.5 pr-3 text-sm",
        "transition-colors duration-fast active:transition-none",
        active
          ? "border-khaki-500 bg-khaki-100 font-semibold text-khaki-800"
          : "border-transparent text-ink-soft hover:bg-paper-sunken hover:text-ink active:bg-ink-line",
        className,
      )}
    >
      {children}
    </Link>
  );
}
