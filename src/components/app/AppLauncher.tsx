"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CollectionIcon, NavIcon } from "./icons";
import { cn } from "@/lib/utils";

/**
 * Salesforce-style app launcher (the waffle button in the far-left of the topbar).
 *
 * DashDrop is the master customer database, so the launcher is the single place
 * that lists every "object": the CRM core (顧客/担当者/商談/請求書/活動), the HR
 * core (部署/社員/勤怠/休暇申請/評価), the sheets of each imported file, loose
 * spreadsheets and saved dashboards — with ホーム pinned at the very top.
 *
 * The nav payload is fetched once by the Topbar and handed down as props so the
 * launcher and the object tab strip never double-fetch /api/nav.
 */

export interface NavSheet {
  id: string;
  slug: string;
  name: string;
  icon: string;
  recordCount: number;
}

export interface NavWorkbook {
  id: string;
  name: string;
  sheets: NavSheet[];
}

export interface NavDashboard {
  id: string;
  name: string;
  icon: string;
}

export interface NavData {
  crm: NavSheet[];
  hr: NavSheet[];
  workbooks: NavWorkbook[];
  looseSheets: NavSheet[];
  dashboards: NavDashboard[];
}

/**
 * ポップオーバー内でフォーカスを回せる要素。role="dialog" を名乗る以上、
 * Tab がパネルの外へ抜けると「開いたのに閉じ方が分からない」状態になるため、
 * この一覧で Tab を内側に閉じ込める。
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 3×3 waffle — the launcher affordance. Matches the 1.7-stroke icon set. */
function WaffleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="4.5" height="4.5" rx="1" />
      <rect x="9.75" y="3" width="4.5" height="4.5" rx="1" />
      <rect x="16.5" y="3" width="4.5" height="4.5" rx="1" />
      <rect x="3" y="9.75" width="4.5" height="4.5" rx="1" />
      <rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1" />
      <rect x="16.5" y="9.75" width="4.5" height="4.5" rx="1" />
      <rect x="3" y="16.5" width="4.5" height="4.5" rx="1" />
      <rect x="9.75" y="16.5" width="4.5" height="4.5" rx="1" />
      <rect x="16.5" y="16.5" width="4.5" height="4.5" rx="1" />
    </svg>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <path d="M3.5 10.5 12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z" />
      <path d="M9.5 20.5v-6h5v6" />
    </svg>
  );
}

/**
 * 未作成のマスターDBの案内。ホームの「スプレッドシート」の下に実際の作成
 * ボタンが出ているので、そこへ送る（以前はボタンの無いページへ送っていた）。
 */
function MissingMaster({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="mt-3 rounded border border-ink-line bg-paper-sunken px-3 py-2.5">
      <p className="text-xs text-ink-soft">{label}がまだありません</p>
      <Link
        href="/home"
        onClick={onClick}
        className="mt-1 inline-block text-xs font-medium text-khaki-600 hover:text-khaki-700"
      >
        ホームで作成する
      </Link>
    </div>
  );
}

function matches(name: string, query: string): boolean {
  if (!query) return true;
  return name.toLowerCase().includes(query.toLowerCase());
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 pb-1.5 pt-4 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
      {children}
    </p>
  );
}

function Tile({
  href,
  icon,
  name,
  meta,
  onClick,
}: {
  href: string;
  icon: string;
  name: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      title={name}
      className="flex min-w-0 items-center gap-2.5 rounded border border-transparent px-2.5 py-2 text-sm text-ink-soft transition-colors hover:border-ink-line hover:bg-paper-sunken hover:text-ink"
    >
      <CollectionIcon name={icon} className="h-4 w-4 shrink-0 text-khaki-500" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{name}</span>
        {meta && (
          <span className="block truncate text-2xs text-ink-faint">{meta}</span>
        )}
      </span>
    </Link>
  );
}

export function AppLauncher({
  data,
  loading = false,
  error = null,
}: {
  data: NavData | null;
  loading?: boolean;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  /*
   * Escape で閉じ、開いた瞬間にパネル内（検索欄）へフォーカスを移し、Tab を
   * パネル内に閉じ込める。クリック捕捉レイヤーは aria-hidden でフォーカスを
   * 受け取らないため、キーボード操作には閉じる手段として使えない。
   */
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    (focusables()[0] ?? panel).focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /* 閉じたらトリガーへフォーカスを戻す。 */
  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const filtered = useMemo(() => {
    if (!data) return null;
    const q = query.trim();
    return {
      crm: (data.crm ?? []).filter((c) => matches(c.name, q)),
      hr: (data.hr ?? []).filter((c) => matches(c.name, q)),
      workbooks: data.workbooks
        .map((w) => ({
          ...w,
          sheets: matches(w.name, q)
            ? w.sheets
            : w.sheets.filter((s) => matches(s.name, q)),
        }))
        .filter((w) => w.sheets.length > 0 || matches(w.name, q)),
      looseSheets: data.looseSheets.filter((s) => matches(s.name, q)),
      dashboards: data.dashboards.filter((d) => matches(d.name, q)),
    } satisfies NavData;
  }, [data, query]);

  const homeVisible =
    matches("ホーム", query.trim()) || matches("home", query.trim());
  const nothingFound =
    filtered !== null &&
    !homeVisible &&
    filtered.crm.length === 0 &&
    filtered.hr.length === 0 &&
    filtered.workbooks.length === 0 &&
    filtered.looseSheets.length === 0 &&
    filtered.dashboards.length === 0;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="アプリケーションランチャー"
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded border border-transparent text-ink-muted transition-colors hover:bg-paper-sunken hover:text-khaki-600",
          open && "border-ink-line bg-paper-sunken text-khaki-600",
        )}
      >
        <WaffleIcon className="h-[18px] w-[18px]" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={close}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="アプリケーションランチャー"
            tabIndex={-1}
            /*
             * 狭い画面では左端に寄せ直す。トリガーはトップバーの左から
             * 70〜100px の位置にあり、そこから左端合わせで 26rem を伸ばすと
             * パネルの**右側が画面の外**に出る（幅は収まっているのに中身が
             * 見えない、という分かりにくい壊れ方）。
             */
            className="absolute left-0 z-30 mt-2 max-h-[70vh] w-[26rem] max-w-[calc(100vw-1.5rem)] max-sm:fixed max-sm:left-3 max-sm:right-3 max-sm:top-14 max-sm:w-auto animate-fade-in overflow-y-auto rounded-md border border-ink-line bg-paper-raised p-3 shadow-raised"
          >
            {/* ここで絞り込めるのは、この一覧に並んでいる名前だけ
                （/api/nav で取得済みのシート・ファイル・ダッシュボード名）。
                レコードは1件も読んでいないので「レコードを検索」とは言わない。
                行そのものを探すのは上部のグローバル検索。 */}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="この一覧を名前で絞り込む…"
              aria-label="スプレッドシート・ダッシュボードを名前で絞り込む"
              className="w-full rounded border border-ink-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-khaki-500 focus:outline-none focus:ring-2 focus:ring-khaki-500"
            />

            {homeVisible && (
              <Link
                href="/home"
                onClick={close}
                className="mt-3 flex items-center gap-2.5 rounded border border-khaki-100 bg-khaki-50 px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:border-khaki-300 hover:bg-khaki-100"
              >
                <HomeIcon className="h-[18px] w-[18px] text-khaki-600" />
                <span className="min-w-0 flex-1 truncate">ホーム</span>
                <span className="text-2xs text-ink-muted">全体の入口</span>
              </Link>
            )}

            {loading && (
              <p className="px-1 py-3 text-xs text-ink-faint">読み込み中…</p>
            )}

            {error && !loading && (
              <p className="px-1 py-3 text-xs text-danger">{error}</p>
            )}

            {filtered && (
              <>
                {/* 顧客データベース（CRMコア） */}
                {filtered.crm.length > 0 && (
                  <>
                    <SectionTitle>顧客データベース</SectionTitle>
                    <div className="grid grid-cols-2 gap-1">
                      {filtered.crm.map((c) => (
                        <Tile
                          key={c.id}
                          href={`/c/${c.id}`}
                          icon={c.icon}
                          name={c.name}
                          meta={`${c.recordCount} 件`}
                          onClick={close}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* 未作成のマスターDB — ホームに作成ボタンが出ている。 */}
                {data && !query.trim() && (data.crm ?? []).length === 0 && (
                  <MissingMaster label="顧客データベース" onClick={close} />
                )}

                {/* 人事データベース（HRコア） */}
                {filtered.hr.length > 0 && (
                  <>
                    <SectionTitle>人事データベース</SectionTitle>
                    <div className="grid grid-cols-2 gap-1">
                      {filtered.hr.map((c) => (
                        <Tile
                          key={c.id}
                          href={`/c/${c.id}`}
                          icon={c.icon}
                          name={c.name}
                          meta={`${c.recordCount} 件`}
                          onClick={close}
                        />
                      ))}
                    </div>
                  </>
                )}

                {data && !query.trim() && (data.hr ?? []).length === 0 && (
                  <MissingMaster label="人事データベース" onClick={close} />
                )}

                {/* 取り込んだファイル（ワークブック単位） */}
                {filtered.workbooks.length > 0 && (
                  <>
                    <SectionTitle>取り込んだファイル</SectionTitle>
                    <div className="space-y-2">
                      {filtered.workbooks.map((w) => (
                        <div key={w.id}>
                          <Link
                            href={`/f/${w.id}`}
                            onClick={close}
                            title={w.name}
                            className="flex items-center gap-2 rounded px-1 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink"
                          >
                            <NavIcon
                              name="folder"
                              className="h-4 w-4 shrink-0 text-khaki-500"
                            />
                            <span className="min-w-0 truncate">{w.name}</span>
                          </Link>
                          <div className="ml-3 grid grid-cols-2 gap-1 border-l border-ink-line pl-1">
                            {w.sheets.map((s) => (
                              <Tile
                                key={s.id}
                                href={`/c/${s.id}`}
                                icon={s.icon}
                                name={s.name}
                                meta={`${s.recordCount} 件`}
                                onClick={close}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* その他のスプレッドシート */}
                {filtered.looseSheets.length > 0 && (
                  <>
                    <SectionTitle>その他のスプレッドシート</SectionTitle>
                    <div className="grid grid-cols-2 gap-1">
                      {filtered.looseSheets.map((s) => (
                        <Tile
                          key={s.id}
                          href={`/c/${s.id}`}
                          icon={s.icon}
                          name={s.name}
                          meta={`${s.recordCount} 件`}
                          onClick={close}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* ダッシュボード */}
                {filtered.dashboards.length > 0 && (
                  <>
                    <SectionTitle>ダッシュボード</SectionTitle>
                    <div className="grid grid-cols-2 gap-1">
                      {filtered.dashboards.map((d) => (
                        <Tile
                          key={d.id}
                          href={`/d/${d.id}`}
                          icon={d.icon}
                          name={d.name}
                          onClick={close}
                        />
                      ))}
                    </div>
                    <Link
                      href="/dashboards"
                      onClick={close}
                      className="mt-1 inline-block px-1 text-xs font-medium text-khaki-600 hover:text-khaki-700"
                    >
                      すべて見る
                    </Link>
                  </>
                )}

                {nothingFound && (
                  <div className="px-1 py-4 text-xs text-ink-faint">
                    <p>名前が一致するものがありません</p>
                    {/* レコードを探しに来た人を、実際に探せる場所へ送る。 */}
                    <p className="mt-1">
                      レコード（行）を探すときは、上部の検索ボックスをお使いください。
                    </p>
                  </div>
                )}
              </>
            )}

            <div className="mt-3 flex items-center justify-between border-t border-ink-line pt-2.5">
              <Link
                href="/import"
                onClick={close}
                className="flex items-center gap-2 rounded px-1 py-1 text-xs font-medium text-khaki-600 transition-colors hover:text-khaki-700"
              >
                <NavIcon name="upload" className="h-4 w-4" />
                Excel取り込み
              </Link>
              <span className="flex items-center gap-2">
                <Link
                  href="/samples"
                  onClick={close}
                  className="rounded px-1 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
                >
                  参考スプレッドシート
                </Link>
                <Link
                  href="/dashboards"
                  onClick={close}
                  className="rounded px-1 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
                >
                  ダッシュボード一覧
                </Link>
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
