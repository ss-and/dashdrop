"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Salesforce-style object tab strip: a slim second row under the topbar that
 * keeps the main objects (ホーム + the CRM core + a few sheets) one click away.
 * Items are supplied by the Topbar, which owns the single /api/nav fetch.
 */

export interface ObjectNavItem {
  href: string;
  label: string;
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ObjectNav({ items }: { items: ObjectNavItem[] }) {
  const pathname = usePathname() ?? "";

  if (items.length === 0) return null;

  return (
    <nav
      aria-label="オブジェクトナビゲーション"
      className="flex h-9 items-stretch gap-0.5 overflow-x-auto overflow-y-hidden px-3"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={item.label}
            className={cn(
              "flex shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm transition-colors",
              active
                ? "border-khaki-500 font-medium text-ink"
                : "border-transparent text-ink-soft hover:bg-paper-sunken hover:text-ink",
            )}
          >
            <span className="max-w-[10rem] truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
