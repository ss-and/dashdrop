"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { NavIcon } from "./icons";
import { NotificationBell } from "./NotificationBell";
import { HelpButton } from "./HelpButton";
import { AppLauncher, type NavData } from "./AppLauncher";
import { SidebarToggle } from "./SidebarShell";
import { getPlanBadge } from "./plan-badge";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import type { CurrentUser } from "@/lib/auth";

/**
 * 上部のオブジェクトタブ帯は廃止した。
 *
 * 利用者の指摘:「文字や見る機能が多すぎて、わかりづらくなっている気がする」
 * 原因は機能の数ではなく、同じものが二重に見えていたこと。この帯に並ぶ
 * 顧客・担当者・商談・請求書・活動・取り込んだシートは、左のサイドバーに
 * ある項目とまったく同じで、7〜11 個が常に画面上部に重複していた。
 * 登録直後は、その全部が 0 件のシートへのリンクだった。
 *
 * シートへの移動はサイドバーとランチャー（ワッフル）が担う。ここには戻さない。
 */

/**
 * アカウントメニュー内でフォーカスを回せる要素。メニューを開いている間は
 * Tab を中に閉じ込め、Escape で必ず閉じられるようにする。
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Top bar: app launcher + page title on the left, workspace/plan/account on the
 * right, with the Salesforce-style object tab strip as a second row. The single
 * /api/nav fetch lives here and is shared by the launcher and the tab strip.
 */
export function Topbar({ user, title }: { user: CurrentUser; title?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountWasOpen = useRef(false);
  const accountHeadingId = useId();

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


  /*
   * アカウントメニューのキーボード操作。以前は Escape ハンドラが無く、閉じる
   * 手段が aria-hidden のクリック捕捉レイヤーだけだったので、キーボードだけの
   * 利用者は開いたら閉じられなかった（WCAG 2.1.1 / 2.1.2）。開いたら中の
   * メニュー項目へフォーカスを移し、上下キーで項目間を移動できるようにする。
   */
  useEffect(() => {
    if (!open) return;
    const menu = accountMenuRef.current;
    if (!menu) return;

    const items = () => Array.from(menu.querySelectorAll<HTMLElement>(FOCUSABLE));
    (items()[0] ?? menu).focus();

    function onKey(e: KeyboardEvent) {
      const list = items();
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (list.length === 0) return;
      const index = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        list[(index + 1 + list.length) % list.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        list[(index - 1 + list.length) % list.length].focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        list[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (e.key === "Tab") {
        // メニューの外へ Tab で抜けられてしまうと開きっぱなしになるため閉じ込める。
        e.preventDefault();
        list[
          e.shiftKey
            ? (index - 1 + list.length) % list.length
            : (index + 1) % list.length
        ].focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /* 閉じたらアバターボタンへフォーカスを戻す。 */
  useEffect(() => {
    if (accountWasOpen.current && !open) accountTriggerRef.current?.focus();
    accountWasOpen.current = open;
  }, [open]);

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
          {/* 左レールの開閉。グラフを見ている間は畳んで横幅を稼げるようにする。 */}
          <SidebarToggle />
          <AppLauncher data={nav} loading={navLoading} error={navError} />
          <span className="h-5 w-px shrink-0 bg-ink-line" aria-hidden="true" />
          <h1 className="truncate text-base font-semibold text-ink">
            {title ?? "ダッシュボード"}
          </h1>
        </div>

        <GlobalSearch className="mx-4 hidden shrink-0 sm:block" />

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
              ref={accountTriggerRef}
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
                  <div className="px-3 py-2" id={accountHeadingId}>
                    <p className="truncate text-sm font-medium text-ink">
                      {user.name}
                    </p>
                    <p className="truncate text-xs text-ink-muted">
                      {user.email}
                    </p>
                  </div>
                  <div className="my-1 border-t border-ink-line" />
                  {/*
                   * トリガーが aria-haspopup="menu" と宣言している以上、開く先は
                   * 素の <div> ではなく本物のメニューでなければならない。操作可能な
                   * 項目だけをこの role="menu" に入れ、上のユーザー名ブロックは
                   * メニューのラベルとして参照する。
                   */}
                  <div
                    ref={accountMenuRef}
                    role="menu"
                    aria-labelledby={accountHeadingId}
                    tabIndex={-1}
                  >
                    <button
                      role="menuitem"
                      onClick={logout}
                      disabled={loggingOut}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink-soft hover:bg-paper-sunken disabled:opacity-50"
                    >
                      <NavIcon name="logout" className="h-4 w-4" />
                      ログアウト
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

    </header>
  );
}
