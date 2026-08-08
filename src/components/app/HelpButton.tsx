"use client";

import Link from "next/link";
import { useState } from "react";
import { NavIcon } from "./icons";

/**
 * Topbar "?" help entry point. Opens a small panel with a 3-step quick start
 * and jump links to the main actions — so a first-time owner is never stuck
 * wondering "what do I do here?".
 */

const STEPS = [
  {
    n: 1,
    title: "データを用意する",
    body: "Excel / CSV を取り込むか、ギャラリーのテンプレートから始めます。",
  },
  {
    n: 2,
    title: "ダッシュボードで把握",
    body: "問い合わせ・タスク・売上などの動きをグラフでひと目で確認。",
  },
  {
    n: 3,
    title: "そのまま運用する",
    body: "表を直接編集して自分のデータに。いつでも Excel に書き出せます。",
  },
];

const LINKS = [
  { href: "/dashboards", icon: "dashboard", label: "ダッシュボード ギャラリー", desc: "30種のテンプレートから選ぶ" },
  { href: "/import", icon: "upload", label: "Excel / CSV を取り込む", desc: "列を自動でフィールド化" },
  { href: "/c/new", icon: "plus", label: "テーブルを追加", desc: "空 or テンプレートで作成" },
  { href: "/dashboards/new", icon: "sparkles", label: "画像・PDFから作成", desc: "資料をAIでダッシュボード化" },
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
            <p className="text-sm font-semibold text-ink">はじめかた（3ステップ）</p>
            <ol className="mt-3 space-y-3">
              {STEPS.map((s) => (
                <li key={s.n} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-khaki-100 text-2xs font-semibold text-khaki-700">
                    {s.n}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-ink">{s.title}</p>
                    <p className="text-xs leading-relaxed text-ink-muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>

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
