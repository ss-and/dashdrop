"use client";

import Link from "next/link";
import { useState } from "react";
import { NavIcon } from "./icons";

/**
 * Topbar "?" help entry point. Opens a small panel with a 3-step quick start
 * and jump links to the main actions — so a first-time owner is never stuck
 * wondering "what do I do here?".
 */

const PATHS = [
  {
    badge: "A",
    title: "顧客データベースから作る",
    body: "顧客・商談・請求書をDashDrop側で正として持つ。データが増えるほど会社の台帳になります。",
    href: "/home",
    cta: "ホームを開く",
  },
  {
    badge: "B",
    title: "スプレッドシートから直接作る",
    body: "手元のExcel / スプレッドシートを取り込む。ファイル単位の入れ子で整理されます。",
    href: "/import",
    cta: "取り込む",
  },
];

const LINKS = [
  { href: "/import", icon: "upload", label: "Excel / CSV を取り込む", desc: "列を自動でフィールド化" },
  { href: "/logs", icon: "report", label: "取り込みログ", desc: "いつ何を取り込んだかの履歴" },
  { href: "/dashboards/build", icon: "plus", label: "ダッシュボードを組む", desc: "ドラッグ&ドロップで作成" },
  { href: "/dashboards", icon: "dashboard", label: "ダッシュボード ギャラリー", desc: "テンプレートから選ぶ" },
];

export function HelpButton() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="ヘルプ・使い方"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-line text-ink-muted transition-colors hover:border-khaki-400 hover:text-khaki-600"
      >
        <span className="text-sm font-semibold leading-none">?</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 z-30 mt-2 w-80 animate-fade-in rounded-md border border-ink-line bg-paper-raised p-4 shadow-raised">
            <p className="text-sm font-semibold text-ink">はじめかたは2通り</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              どちらから始めても、あとで組み合わせられます。
            </p>
            <ul className="mt-3 space-y-2">
              {PATHS.map((p) => (
                <li key={p.badge}>
                  <Link
                    href={p.href}
                    onClick={() => setOpen(false)}
                    className="flex gap-2.5 rounded border border-ink-line p-2.5 transition-colors hover:bg-paper-sunken"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-khaki-300 bg-khaki-50 text-2xs font-semibold text-khaki-800">
                      {p.badge}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">
                        {p.title}
                      </span>
                      <span className="block text-xs leading-relaxed text-ink-muted">
                        {p.body}
                      </span>
                      <span className="mt-1 block text-xs font-medium text-khaki-600">
                        {p.cta} →
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <div className="my-3 border-t border-ink-line" />

            <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
              よく使う操作
            </p>
            <ul className="space-y-0.5">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 rounded px-2 py-1.5 hover:bg-paper-sunken"
                  >
                    <NavIcon name={l.icon} className="mt-0.5 h-4 w-4 text-khaki-500" />
                    <span>
                      <span className="block text-sm text-ink">{l.label}</span>
                      <span className="block text-xs text-ink-muted">{l.desc}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
