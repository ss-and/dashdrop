"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { NavIcon } from "./icons";

/**
 * 左レールの開閉。
 *
 * 利用者の要望「左のサイドバーを消したり出したりして欲しい」。ダッシュボードは
 * 横に広いほど読みやすく、グラフを見ている間はナビゲーションが要らない。
 *
 * 状態は localStorage に残す。開くたびに畳み直す作業が発生すると、結局使われない。
 * サーバー側では常に「開いている」形で描き、マウント後に保存値へ合わせる
 * （SSR と初回描画を一致させ、ハイドレーションのズレを出さないため）。
 */

const STORAGE_KEY = "dashdrop.sidebar.collapsed";

interface SidebarState {
  collapsed: boolean;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarState>({
  collapsed: false,
  toggle: () => {},
});

export function useSidebar(): SidebarState {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setCollapsed(true);
    } catch {
      // localStorage が使えない環境（プライベートモード等）では既定のまま。
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // 保存できなくても開閉自体は動く。
      }
      return next;
    });
  }, []);

  // ⌘B / Ctrl+B — エディタ類と同じ割り当て。入力中は奪わない。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "b" && e.key !== "B") return;
      if (!e.metaKey && !e.ctrlKey) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (el as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

/**
 * レール本体の器。畳むと幅 0 になる。
 * 中身（サーバーコンポーネントのサイドバー）は children としてそのまま受け取る。
 */
export function SidebarPane({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <div
      className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
        collapsed ? "w-0" : "w-60"
      }`}
      // 畳んでいる間は中身を読み上げ・タブ移動の対象から外す。
      aria-hidden={collapsed}
      inert={collapsed ? true : undefined}
    >
      {children}
    </div>
  );
}

/** 開閉ボタン。トップバーの左端に置く。 */
export function SidebarToggle({ className }: { className?: string }) {
  const { collapsed, toggle } = useSidebar();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
      title={`${collapsed ? "サイドバーを開く" : "サイドバーを閉じる"}（⌘B）`}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-muted transition-colors duration-fast hover:bg-paper-sunken hover:text-ink active:bg-ink-line ${className ?? ""}`}
    >
      <NavIcon name="panelLeft" className="h-4 w-4" />
    </button>
  );
}
