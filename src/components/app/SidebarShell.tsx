"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { usePathname } from "next/navigation";
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
 *
 * ## 狭い画面では、別の部品として振る舞う
 *
 * レールは `w-60`（240px）を横から取る。これを 375px の画面でそのままやると、
 * 本文に残るのは 135px——**製品が使えない**。文字は1行に5〜6字しか入らず、
 * 表もグラフも読めない。
 *
 * なので狭い画面では、場所を取らない**かぶせる引き出し**にする。状態は
 * 広い画面（collapsed）とは別に持つ:
 *
 *   - `collapsed`  … 広い画面。localStorage に残す。既定は開いている
 *   - `mobileOpen` … 狭い画面。**必ず閉じた状態から始まる**。残さない
 *
 * 1つの状態で兼ねようとすると、既定が「開いている」なので、スマホで開いた
 * 瞬間に引き出しが画面を覆った状態で描かれる。サーバーは画面幅を知らないので、
 * ここは状態を分けるほかない。
 */

const STORAGE_KEY = "dashdrop.sidebar.collapsed";

interface SidebarState {
  /** 広い画面でレールを畳んでいるか。 */
  collapsed: boolean;
  /** 狭い画面で引き出しが開いているか。 */
  mobileOpen: boolean;
  /** いま狭い画面か。SSR 中と初回描画では false（＝広い画面として描く）。 */
  narrow: boolean;
  toggle: () => void;
  closeMobile: () => void;
}

const SidebarContext = createContext<SidebarState>({
  collapsed: false,
  mobileOpen: false,
  narrow: false,
  toggle: () => {},
  closeMobile: () => {},
});

export function useSidebar(): SidebarState {
  return useContext(SidebarContext);
}

/** Tailwind の `md`（768px）と同じ境目。CSS と JS で別々の値を持たない。 */
const NARROW_QUERY = "(max-width: 767px)";

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setCollapsed(true);
    } catch {
      // localStorage が使えない環境（プライベートモード等）では既定のまま。
    }
  }, []);

  // 画面幅の変化を追う。回転や分割表示で境目をまたぐことがある。
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /*
   * 画面が変わったら引き出しを閉じる。
   *
   * 閉じないと、リンクを押した瞬間に**引き出しが移動先の画面を覆ったまま**残る。
   * 押した本人は「何も起きなかった」と受け取り、もう一度押す——これが
   * かぶせる形の引き出しで一番多い壊れ方。
   */
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  /*
   * 開閉。**触る状態を画面幅で分ける**。
   *
   * 分けないと、スマホで引き出しを開け閉めするたびに広い画面用の
   * `collapsed` まで書き換わり、localStorage に残る——次にPCで開いたとき、
   * 覚えの無い状態でレールが畳まれている。同じボタンでも、押した人が
   * 意図しているのは目の前の1つだけ。
   */
  const toggle = useCallback(() => {
    if (narrow) {
      setMobileOpen((prev) => !prev);
      return;
    }
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // 保存できなくても開閉自体は動く。
      }
      return next;
    });
  }, [narrow]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Esc で引き出しを閉じる。かぶせる形の部品は、必ず Esc で降りられること。
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

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
    <SidebarContext.Provider
      value={{ collapsed, mobileOpen, narrow, toggle, closeMobile }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

/**
 * レール本体の器。
 *
 * 広い画面では、畳むと幅 0 になる横のレール。狭い画面では、本文の場所を
 * まったく取らない**かぶせる引き出し**。切り替えは CSS の `md:` だけで行い、
 * 画面幅を JS で測った結果には依存させない——測る前の一瞬だけ別の形で
 * 描かれると、開いた直後に画面が飛ぶ。
 *
 * 中身（サーバーコンポーネントのサイドバー）は children としてそのまま受け取る。
 */
export function SidebarPane({ children }: { children: React.ReactNode }) {
  const { collapsed, mobileOpen, narrow, closeMobile } = useSidebar();

  // いま実際に見えているか。読み上げとタブ移動の対象を決めるのに使う。
  const visible = narrow ? mobileOpen : !collapsed;

  return (
    <>
      {/*
        背景の覆い。狭い画面で開いているときだけ。押したら閉じる——
        引き出しの外を押して閉じられない画面は、閉じ方を探させる。
      */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="サイドバーを閉じる"
          onClick={closeMobile}
          className="fixed inset-0 z-30 bg-ink/45 md:hidden"
        />
      )}
      <div
        className={[
          // 狭い画面: 本文の上にかぶせる。閉じているときは画面の外へ。
          "fixed inset-y-0 left-0 z-40 w-[17rem] overflow-hidden bg-paper",
          "transition-transform duration-200 ease-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // 広い画面: 元どおり、横に場所を取るレール。
          "md:static md:z-auto md:translate-x-0 md:bg-transparent",
          "md:shrink-0 md:transition-[width]",
          /*
           * 幅はここ1か所でしか決めない。素の `md:w-60` を併記すると、
           * 畳んだときに `md:w-0` と両方が要素に乗り、どちらが効くかは
           * 生成された CSS の並び順まかせになる（属性の並び順ではない）。
           */
          collapsed ? "md:w-0" : "md:w-60",
        ].join(" ")}
        aria-hidden={!visible}
        inert={visible ? undefined : true}
      >
        {/*
          狭い画面で開いたとき、トップバーの開閉ボタンは引き出しの**下**に
          隠れる（引き出しは左上から覆う）。閉じる手段が「右の細い余白を押す」
          しか無い状態になるので、引き出しの中にも1つ置く。
        */}
        {mobileOpen && (
          <button
            type="button"
            onClick={closeMobile}
            aria-label="サイドバーを閉じる"
            className="absolute right-2 top-3 z-10 flex h-9 w-9 items-center justify-center rounded text-ink-muted hover:bg-paper-sunken hover:text-ink active:bg-ink-line md:hidden"
          >
            <NavIcon name="panelLeft" className="h-4 w-4" />
          </button>
        )}
        {children}
      </div>
    </>
  );
}

/** 開閉ボタン。トップバーの左端に置く。 */
export function SidebarToggle({ className }: { className?: string }) {
  const { collapsed, mobileOpen, narrow, toggle } = useSidebar();
  // 見えているものに合わせて言う。狭い画面で「閉じる」と読み上げながら
  // 実際には開く、という食い違いを作らない。
  const shown = narrow ? mobileOpen : !collapsed;
  const label = shown ? "サイドバーを閉じる" : "サイドバーを開く";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-expanded={shown}
      title={`${label}（⌘B）`}
      /*
       * 狭い画面では 36px。指で押す的は 32px だと外しやすく、外した1回が
       * 「反応しない」という印象になる。広い画面はマウスなので従来どおり。
       */
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded text-ink-muted transition-colors duration-fast hover:bg-paper-sunken hover:text-ink active:bg-ink-line sm:h-8 sm:w-8 ${className ?? ""}`}
    >
      <NavIcon name="panelLeft" className="h-4 w-4" />
    </button>
  );
}
