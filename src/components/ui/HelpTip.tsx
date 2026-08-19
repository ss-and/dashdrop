"use client";

import { useEffect, useId, useState } from "react";
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

  /*
   * Escape でツールチップを閉じられるようにする（WCAG 2.2 SC 1.4.13
   * Dismissible）。ホバーで出るこの吹き出しは、拡大表示している人の視界を
   * 覆ってしまうことがあり、ポインタを動かさずに消せる必要がある。
   * 「ホバーし続けられる」条件のほうは、吹き出しが親 span の内側にあるので
   * 吹き出し上へマウスを移しても onMouseLeave が起きず、すでに満たしている。
   */
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

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
        /*
         * 見た目は 16px の小さな丸のままにしつつ、擬似要素で 24×24 の当たり判定を
         * 重ねている（WCAG 2.2 SC 2.5.8 ターゲットサイズ 最低 24×24 CSS px）。
         * ボタン自体を h-6 w-6 にすると、この部品を見出しや数値の横にインラインで
         * 置いている全ページで行の高さが変わってしまうため、レイアウトに影響しない
         * この形にしている。
         */
        className="relative inline-flex h-4 w-4 items-center justify-center rounded-full border border-ink-line text-[10px] font-semibold leading-none text-ink-muted transition-colors after:absolute after:left-1/2 after:top-1/2 after:h-6 after:w-6 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:border-khaki-400 hover:text-khaki-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-khaki-500"
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
