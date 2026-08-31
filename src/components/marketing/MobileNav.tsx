"use client";

/**
 * スマートフォンでの案内。
 *
 * ヘッダーの並びは `hidden md:flex` で、**768px 未満では1つも出ていなかった**。
 * つまりスマートフォンで開いた人は、機能も料金もお問い合わせもログインも
 * ヘッダーからは辿れず、最下部まで送らないと何も選べない。
 * 日本の中小企業では、最初にスマートフォンで開かれるほうが多い。
 *
 * 気をつけたこと:
 *
 * - **開いている間は背面を固定する。** 下の紙面が一緒に動くと、
 *   閉じたときに読んでいた場所を見失う。
 * - **Escape と背面の押下で閉じる。** 閉じ方が1つしかないのは行き止まり。
 * - **開いた直後に焦点を移す。** キーボードと読み上げの利用者が、
 *   開いたことに気づけないと使えない。
 * - **道を選んだら閉じる。** 同じページ内の移動（#features）では
 *   画面が変わらないので、閉じないと何も起きていないように見える。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const LINKS = [
  { href: "/#features", label: "機能" },
  { href: "/pricing", label: "料金" },
  { href: "/contact", label: "お問い合わせ" },
  { href: "/login", label: "ログイン" },
] as const;

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    // 背面を固定する。閉じたときに読んでいた場所へ戻れるようにするため。
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "メニューを閉じる" : "メニューを開く"}
        className="flex h-9 w-9 items-center justify-center rounded border border-ink-line bg-paper-raised text-ink-soft transition-colors hover:bg-paper-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki-500"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
          {open ? (
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>

      {open && (
        <>
          {/* 背面。押しても閉じる——閉じ方が1つだけだと行き止まりになる。 */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 top-16 z-40 cursor-default bg-ink/25"
          />
          <div
            id="mobile-nav"
            ref={panelRef}
            tabIndex={-1}
            className="fixed inset-x-0 top-16 z-50 border-b border-ink-line bg-paper-raised shadow-raised focus:outline-none"
          >
            <nav className="flex flex-col px-5 py-2">
              {LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="border-b border-ink-line py-4 text-base text-ink transition-colors last:border-b-0 hover:text-khaki-700"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="px-5 pb-5 pt-2">
              <Link
                href="/signup"
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-center gap-1.5 rounded bg-khaki-500 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-khaki-600"
              >
                無料で始める
                <span aria-hidden="true" className="text-ink-line">
                  ›
                </span>
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
