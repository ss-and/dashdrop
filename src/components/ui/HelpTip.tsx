"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A small "?" affordance that reveals a short explanation on hover/focus/tap.
 * Use it next to a title, label, or metric the user might not immediately get.
 * Deliberately quiet: ink-faint by default, khaki on interaction.
 */
export function HelpTip({
  children,
  label = "ヘルプ",
  side = "top",
  className,
}: {
  children: React.ReactNode;
  label?: string;
  side?: "top" | "bottom";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-ink-line text-[10px] font-semibold leading-none text-ink-muted transition-colors hover:border-khaki-400 hover:text-khaki-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-khaki-500/40"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "absolute left-1/2 z-30 w-56 -translate-x-1/2 rounded-md border border-ink-line bg-paper-raised px-3 py-2 text-xs font-normal leading-relaxed text-ink-soft shadow-raised",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
