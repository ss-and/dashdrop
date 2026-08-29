"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CollectionIcon, NavIcon } from "@/components/app/icons";
import { cn } from "@/lib/utils";
import { readRecent, type RecentItem } from "@/lib/recent";
import { matchActions, SEARCH_ACTIONS, type SearchAction } from "@/lib/search-actions";

/**
 * Salesforce-style global search that lives in the topbar.
 *
 * One debounced call to /api/search per keystroke returns everything the
 * workspace can offer for a query — matching records (grouped by collection,
 * 顧客データベース first), objects, imported files and dashboards — and the
 * panel renders them as one flat, keyboard-navigable list.
 *
 * Stale responses are dropped with an incrementing sequence ref (same guard as
 * DashboardBuilder's live preview), so a slow early request can never overwrite
 * the results of a later keystroke.
 *
 * 日本語入力（IME）について:
 * 変換中のキーは無視する。「たなか」と打って Space→↓ で候補を選び Enter で
 * 確定する操作は、日本語のこの製品では一番よく通る道なのに、変換確定の Enter を
 * 「選択中の結果を開く」と解釈して勝手に画面遷移していた。`isComposing` が
 * true の間は、この入力はまだ検索語ですらない。
 *
 * 何も打っていないときも空にしない:
 * 検索窓を開いた瞬間に「最近見たもの」（その端末の履歴）と「最近更新された
 * もの」（サーバ）、そして「操作」を出す。以前は空の枠が出るだけで、
 * **打つ前に何ができるのかが分からなかった**——名前を覚えている人しか
 * 使えない検索窓になっていた。Salesforce の検索窓が押した瞬間に履歴を出すのは、
 * これを避けるため。
 *
 * 読み上げについて:
 * listbox の直接の子は option / group だけにし、見出しは装飾（aria-hidden）
 * として置く。強調行は背景色だけでなく `aria-activedescendant` で伝える
 * （色が見えない利用者にも「今どれが選ばれているか」が届くように）。
 */

interface SearchHit {
  recordId: string;
  title: string;
  subtitle: string;
}

interface SearchGroup {
  collectionId: string;
  collectionName: string;
  slug: string;
  icon: string;
  isCrm: boolean;
  hits: SearchHit[];
  /** 上限で切ったため、この表にはまだ一致が残っているかもしれない。 */
  more: boolean;
}

interface SearchObject {
  id: string;
  name: string;
  slug: string;
  icon: string;
  kind: "crm" | "sheet";
}

interface SearchNamed {
  id: string;
  name: string;
}

interface SearchData {
  query: string;
  groups: SearchGroup[];
  objects: SearchObject[];
  files: SearchNamed[];
  dashboards: SearchNamed[];
  /** 名前一致を表示上限で切ったか。 */
  more: { objects: boolean; files: boolean; dashboards: boolean };
  /** 何をどこまで見たか（画面でそのまま断り書きにする）。 */
  scope: {
    rowsPerCollection: number;
    collections: number;
    computedFields: boolean;
  };
}

const DEBOUNCE_MS = 250;

/**
 * 打つ前に出す「場所」の行数。履歴と入口を合わせてこの数まで。
 * これに操作が3行つくので、パネルは常に1画面に収まる。
 */
const IDLE_ROWS = 6;

interface Starters {
  dashboards: { id: string; name: string }[];
  sheets: { id: string; name: string; icon: string }[];
  files: { id: string; name: string }[];
}

/** ワークスペースID。履歴を別のワークスペースと混ぜないための鍵。 */
const EMPTY_STARTERS: Starters = { dashboards: [], sheets: [], files: [] };

const EMPTY: SearchData = {
  query: "",
  groups: [],
  objects: [],
  files: [],
  dashboards: [],
  more: { objects: false, files: false, dashboards: false },
  scope: { rowsPerCollection: 0, collections: 0, computedFields: false },
};

/** 履歴・入口の行に添えるアイコンと呼び名。利用者の言葉で書く。 */
const KIND_ICON: Record<string, string> = {
  dashboard: "dashboard",
  sheet: "table",
  file: "folder",
  record: "report",
};
const KIND_LABEL: Record<string, string> = {
  dashboard: "ダッシュボード",
  sheet: "スプレッドシート",
  file: "ファイル",
  record: "レコード",
};

/** 強調行を `aria-activedescendant` で指すための id。 */
function optionId(index: number): string {
  return `global-search-option-${index}`;
}

/** Magnifier in the same 1.7-stroke style as the shared icon set. */
function SearchIcon({ className }: { className?: string }) {
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
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/**
 * 見出しは listbox の中では装飾。読み上げには各グループの aria-label で
 * 同じ情報が入るので、ここは目で見るためだけのもの。
 */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p
      aria-hidden="true"
      className="px-2 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wider text-ink-faint first:pt-1"
    >
      {children}
    </p>
  );
}

/** 上限で切ったときの控えめな断り書き。 */
function MoreHint({ className }: { className?: string }) {
  return (
    <p className={cn("px-2 py-1 text-2xs text-ink-faint", className)}>
      ほかにも一致があります。検索語を絞り込んでください。
    </p>
  );
}

/** Whether the event target is somewhere the user is already typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function GlobalSearch({
  workspaceId,
  className,
}: {
  /** 履歴をワークスペースごとに分ける鍵。別の会社の足あとが混ざらないように。 */
  workspaceId: string;
  className?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchData>(EMPTY);
  const [highlight, setHighlight] = useState(-1);
  /** 端末に残っている足あと。開くたびに読み直す。 */
  const [recent, setRecent] = useState<RecentItem[]>([]);
  /** サーバ側の「最近更新されたもの」。一度取ったら開いている間は使い回す。 */
  const [starters, setStarters] = useState<Starters | null>(null);

  const trimmed = query.trim();

  /* ------------------------------ debounced fetch ------------------------- */

  useEffect(() => {
    const seq = ++seqRef.current;
    if (trimmed.length === 0) {
      setData(EMPTY);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        const body = await res.json().catch(() => null);
        if (seq !== seqRef.current) return; // stale response — ignore
        if (!res.ok || !body?.ok) {
          setError(body?.error ?? "検索に失敗しました");
          setData(EMPTY);
          return;
        }
        setError(null);
        setData(body.data as SearchData);
      } catch {
        if (seq === seqRef.current) {
          setError("検索に失敗しました");
          setData(EMPTY);
        }
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmed]);

  /* --------------------- 打つ前に出すもの（履歴・入口） -------------------- */

  /*
   * 履歴は開くたびに読み直す。別のタブで開いたものも拾いたいし、
   * 開きっぱなしのタブで古い履歴を出し続けたくない。
   */
  useEffect(() => {
    if (!open) return;
    const load = () => setRecent(readRecent(workspaceId, 6));
    load();
    window.addEventListener("dashdrop:recent", load);
    // 別タブでの更新も拾う（storage は自分のタブには飛ばないので上と両方いる）。
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("dashdrop:recent", load);
      window.removeEventListener("storage", load);
    };
  }, [open, workspaceId]);

  /*
   * 「最近更新されたもの」は開いたときに一度だけ取る。
   * 打鍵ごとに取る必要はなく、開いている間に増えるものでもない。
   */
  useEffect(() => {
    if (!open || starters !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/search/recent");
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        setStarters(res.ok && body?.ok ? (body.data as Starters) : EMPTY_STARTERS);
      } catch {
        // 取れなくても履歴と操作は出る。ここで画面に断り書きは出さない。
        if (!cancelled) setStarters(EMPTY_STARTERS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, starters]);

  /* --------------------------- flattened render model --------------------- */

  const model = useMemo(() => {
    const flat: string[] = [];
    const add = (href: string) => {
      flat.push(href);
      return flat.length - 1;
    };

    /*
     * 打つ前の並び。上下キーの順番はここで決まるので、
     * **画面に出る順とまったく同じ**に組み立てる。ずれると、
     * 見えている2つ目を選んだつもりで別の場所へ飛ぶ。
     */
    const idle = trimmed.length === 0;
    const recentRows = idle
      ? recent.map((r) => ({ ...r, index: add(r.href) }))
      : [];

    /*
     * 入口は、履歴で埋まらなかったぶんだけ出す。
     *
     * これは補助であって主役ではない。履歴が6件そろっている人に
     * 「最近更新されたもの」を9件足すと、開いた瞬間に15行のパネルが降りてきて、
     * 自分がさっき見たものを目で探すことになる。履歴が無い人の空パネルを
     * 埋めるのが役目なので、埋まったら引っ込む。
     */
    const seen = new Set(recentRows.map((r) => r.href));
    const starterRoom = Math.max(0, IDLE_ROWS - recentRows.length);
    const starterRows = idle && starterRoom > 0
      ? [
          ...(starters?.dashboards ?? []).map((d) => ({
            kind: "dashboard" as const, name: d.name, href: `/d/${d.id}`, icon: "dashboard",
          })),
          ...(starters?.sheets ?? []).map((c) => ({
            kind: "sheet" as const, name: c.name, href: `/c/${c.id}`, icon: c.icon,
          })),
          ...(starters?.files ?? []).map((f) => ({
            kind: "file" as const, name: f.name, href: `/f/${f.id}`, icon: "folder",
          })),
        ]
          .filter((r) => !seen.has(r.href))
          .slice(0, starterRoom)
          .map((r) => ({ ...r, index: add(r.href) }))
      : [];

    /*
     * 操作は、打っていないときは主なものだけ、打っているときは当たったものだけ。
     * 全部を常に出すと、履歴より操作のほうが長くなって主客が逆転する。
     */
    const actionList: SearchAction[] = idle
      ? SEARCH_ACTIONS.slice(0, 3)
      : matchActions(trimmed, 4);
    const actions = actionList.map((a) => ({ ...a, index: add(a.href) }));

    const groups = data.groups.map((g) => ({
      ...g,
      hits: g.hits.map((h) => {
        const href = `/r/${g.collectionId}/${h.recordId}`;
        return { ...h, href, index: add(href) };
      }),
    }));
    const objects = data.objects.map((o) => {
      const href = `/c/${o.id}`;
      return { ...o, href, index: add(href) };
    });
    const files = data.files.map((f) => {
      const href = `/f/${f.id}`;
      return { ...f, href, index: add(href) };
    });
    const dashboards = data.dashboards.map((d) => {
      const href = `/d/${d.id}`;
      return { ...d, href, index: add(href) };
    });

    return {
      idle,
      recentRows,
      starterRows,
      actions,
      groups,
      objects,
      files,
      dashboards,
      flat,
    };
  }, [data, trimmed, recent, starters]);

  // Any new result set invalidates the previous highlight.
  useEffect(() => {
    setHighlight(-1);
  }, [model]);

  // Keep the highlighted row inside the scrollable panel.
  useEffect(() => {
    if (highlight < 0 || !panelRef.current) return;
    const el = panelRef.current.querySelector(`[data-idx="${highlight}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  /* -------------------------------- shortcuts ----------------------------- */

  /*
   * 検索窓を開く鍵は2つ。
   *
   * `/` は文字入力中でないときだけ（Gmail や GitHub と同じ）。
   * `⌘K` / `Ctrl+K` は**入力中でも効く**。表のセルを編集している途中で
   * 「あの資料どこだっけ」と思うのは普通に起きることで、そのたびに
   * 一度セルから抜けろというのは操作として厳しい。
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (cmdK) {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      setOpen(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const isEmpty = model.flat.length === 0;
  /*
   * 打つ前でも開く。以前は `trimmed.length > 0` を条件にしていたので、
   * 押しても何も起きない検索窓に見えていた。
   */
  const panelOpen = open;
  // 走査範囲の断り書きは、実際に検索したときだけ。履歴を見ているときに
  // 「各シート400行を対象に…」と出ても、何の話か分からない。
  const hasScopeNote =
    trimmed.length > 0 && data.scope.rowsPerCollection > 0 && !isEmpty;

  function close() {
    setOpen(false);
    setHighlight(-1);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // 変換中（IME）のキーには一切反応しない。Enter は変換の確定、↓ は候補の
    // 選択であって、検索結果の操作ではない。`keyCode === 229` は
    // `isComposing` を出さない環境（古い Safari など）向けの保険。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (e.key === "Escape") {
      e.preventDefault();
      close();
      inputRef.current?.blur();
      return;
    }
    if (!panelOpen || model.flat.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => (i + 1) % model.flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => (i <= 0 ? model.flat.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (highlight < 0) return;
      e.preventDefault();
      const href = model.flat[highlight];
      close();
      // Leave the query in place so the user can refine after landing.
      router.push(href);
    }
  }

  const rowClass = (index: number) =>
    cn(
      "flex min-w-0 items-center gap-2.5 rounded px-2 py-1.5 text-sm text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink",
      highlight === index && "bg-paper-sunken text-ink",
    );

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "relative w-64 transition-[width] duration-150",
          focused && "w-96",
        )}
      >
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="ワークスペース内を検索"
          aria-expanded={panelOpen}
          aria-controls="global-search-listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            panelOpen && highlight >= 0 ? optionId(highlight) : undefined
          }
          autoComplete="off"
          value={query}
          placeholder="検索"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={onInputKeyDown}
          className="w-full rounded border border-ink-line bg-paper py-1.5 pl-8 pr-9 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-khaki-400 focus:outline-none focus:ring-2 focus:ring-khaki-500/25"
        />
        {query.length === 0 && !focused && (
          /*
           * 押す前から鍵を見せる。ここに何も出ていないと、
           * ショートカットがあること自体が伝わらない。
           */
          <span
            className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1"
            aria-hidden="true"
          >
            {/*
              ヒントは1つだけ出す。`/` と `⌘K` の両方を並べると、幅の限られた
              入力欄の右側を2つのキャップが占領し、プレースホルダが途中で
              切れて「顧客・商談・シートを検」のような壊れた見た目になっていた。
              どちらも効くことは変わらないが、画面に出すのは覚えやすい方だけ。
            */}
            <kbd className="rounded-sm border border-ink-line bg-paper-sunken px-1.5 py-0.5 text-2xs font-normal text-ink-faint">
              ⌘K
            </kbd>
          </span>
        )}
      </div>

      {panelOpen && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={close}
            aria-hidden="true"
          />
          <div
            id="global-search-panel"
            ref={panelRef}
            className="absolute left-0 z-30 mt-2 max-h-[70vh] w-[32rem] max-w-[calc(100vw-2rem)] animate-fade-in overflow-y-auto rounded-md border border-ink-line bg-paper-raised p-1.5 shadow-raised"
          >
            {loading && (
              <p className="px-2 py-3 text-xs text-ink-faint" role="status">
                検索中…
              </p>
            )}

            {error && !loading && (
              <p className="px-2 py-3 text-xs text-danger" role="alert">
                {error}
              </p>
            )}

            {/* listbox の直接の子は option / group と、読み上げから外した
                見出しだけ。状態メッセージは外に出してある。 */}
            <div id="global-search-listbox" role="listbox" aria-label="検索結果">
              {!loading && !error && (
                <>
                  {/* 最近見たもの — その端末の足あと（localStorage）。 */}
                  {model.recentRows.length > 0 && (
                    <>
                      <SectionTitle>最近見たもの</SectionTitle>
                      <div role="group" aria-label="最近見たもの">
                        {model.recentRows.map((r) => (
                          <Link
                            key={r.href}
                            id={optionId(r.index)}
                            href={r.href}
                            data-idx={r.index}
                            role="option"
                            aria-selected={highlight === r.index}
                            onClick={close}
                            onMouseEnter={() => setHighlight(r.index)}
                            className={rowClass(r.index)}
                          >
                            <NavIcon
                              name={KIND_ICON[r.kind]}
                              className="h-4 w-4 shrink-0 text-khaki-500"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {r.name}
                            </span>
                            <span className="shrink-0 text-2xs text-ink-faint">
                              {r.sub ?? KIND_LABEL[r.kind]}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </>
                  )}

                  {/*
                    最近更新されたもの — サーバ側。履歴とは別の見出しで出す。
                    「自分が見たもの」と「誰かが更新したもの」を混ぜると、
                    開いた覚えのないものが履歴に並ぶことになる。
                  */}
                  {model.starterRows.length > 0 && (
                    <>
                      <SectionTitle>最近更新されたもの</SectionTitle>
                      <div role="group" aria-label="最近更新されたもの">
                        {model.starterRows.map((r) => (
                          <Link
                            key={r.href}
                            id={optionId(r.index)}
                            href={r.href}
                            data-idx={r.index}
                            role="option"
                            aria-selected={highlight === r.index}
                            onClick={close}
                            onMouseEnter={() => setHighlight(r.index)}
                            className={rowClass(r.index)}
                          >
                            {r.kind === "sheet" ? (
                              <CollectionIcon
                                name={r.icon}
                                className="h-4 w-4 shrink-0 text-khaki-500"
                              />
                            ) : (
                              <NavIcon
                                name={KIND_ICON[r.kind]}
                                className="h-4 w-4 shrink-0 text-khaki-500"
                              />
                            )}
                            <span className="min-w-0 flex-1 truncate">
                              {r.name}
                            </span>
                            <span className="shrink-0 text-2xs text-ink-faint">
                              {KIND_LABEL[r.kind]}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </>
                  )}

                  {/* 操作 — 名前ではなく「やりたいこと」から辿る道。 */}
                  {model.actions.length > 0 && (
                    <>
                      <SectionTitle>操作</SectionTitle>
                      <div role="group" aria-label="操作">
                        {model.actions.map((a) => (
                          <Link
                            key={a.id}
                            id={optionId(a.index)}
                            href={a.href}
                            data-idx={a.index}
                            role="option"
                            aria-selected={highlight === a.index}
                            onClick={close}
                            onMouseEnter={() => setHighlight(a.index)}
                            className={rowClass(a.index)}
                          >
                            <NavIcon
                              name={a.icon}
                              className="h-4 w-4 shrink-0 text-khaki-500"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {a.label}
                            </span>
                            <span className="hidden shrink-0 text-2xs text-ink-faint sm:inline">
                              {a.hint}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </>
                  )}

                  {/* レコード — collection groups, 顧客データベース first */}
                  {model.groups.length > 0 && (
                    <>
                      <SectionTitle>レコード</SectionTitle>
                      {model.groups.map((g) => (
                        <div
                          key={g.collectionId}
                          role="group"
                          aria-label={`レコード: ${g.collectionName}`}
                          className="pb-1"
                        >
                          <div
                            aria-hidden="true"
                            className="flex items-center gap-2 px-2 py-1"
                          >
                            <CollectionIcon
                              name={g.icon}
                              className="h-3.5 w-3.5 shrink-0 text-khaki-500"
                            />
                            <span className="min-w-0 truncate text-xs font-medium text-ink-soft">
                              {g.collectionName}
                            </span>
                            {g.isCrm && (
                              <span className="shrink-0 rounded-sm border border-khaki-100 bg-khaki-50 px-1.5 py-0.5 text-2xs text-khaki-600">
                                顧客データベース
                              </span>
                            )}
                          </div>
                          <div className="ml-3 border-l border-ink-line pl-1">
                            {g.hits.map((h) => (
                              <Link
                                key={h.recordId}
                                id={optionId(h.index)}
                                href={h.href}
                                data-idx={h.index}
                                role="option"
                                aria-selected={highlight === h.index}
                                onClick={close}
                                onMouseEnter={() => setHighlight(h.index)}
                                className={rowClass(h.index)}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-medium text-ink">
                                    {h.title}
                                  </span>
                                  {h.subtitle && (
                                    <span className="block truncate text-2xs text-ink-muted">
                                      {h.subtitle}
                                    </span>
                                  )}
                                </span>
                              </Link>
                            ))}
                            {g.more && <MoreHint className="pl-1" />}
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {/* スプレッドシート */}
                  {model.objects.length > 0 && (
                    <>
                      <SectionTitle>スプレッドシート</SectionTitle>
                      <div role="group" aria-label="スプレッドシート">
                        {model.objects.map((o) => (
                          <Link
                            key={o.id}
                            id={optionId(o.index)}
                            href={o.href}
                            data-idx={o.index}
                            role="option"
                            aria-selected={highlight === o.index}
                            onClick={close}
                            onMouseEnter={() => setHighlight(o.index)}
                            className={rowClass(o.index)}
                          >
                            <CollectionIcon
                              name={o.icon}
                              className="h-4 w-4 shrink-0 text-khaki-500"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {o.name}
                            </span>
                            <span className="shrink-0 text-2xs text-ink-faint">
                              {o.kind === "crm"
                                ? "顧客データベース"
                                : "スプレッドシート"}
                            </span>
                          </Link>
                        ))}
                        {data.more.objects && <MoreHint />}
                      </div>
                    </>
                  )}

                  {/* ファイル */}
                  {model.files.length > 0 && (
                    <>
                      <SectionTitle>ファイル</SectionTitle>
                      <div role="group" aria-label="ファイル">
                        {model.files.map((f) => (
                          <Link
                            key={f.id}
                            id={optionId(f.index)}
                            href={f.href}
                            data-idx={f.index}
                            role="option"
                            aria-selected={highlight === f.index}
                            onClick={close}
                            onMouseEnter={() => setHighlight(f.index)}
                            className={rowClass(f.index)}
                          >
                            <NavIcon
                              name="folder"
                              className="h-4 w-4 shrink-0 text-khaki-500"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {f.name}
                            </span>
                          </Link>
                        ))}
                        {data.more.files && <MoreHint />}
                      </div>
                    </>
                  )}

                  {/* ダッシュボード */}
                  {model.dashboards.length > 0 && (
                    <>
                      <SectionTitle>ダッシュボード</SectionTitle>
                      <div role="group" aria-label="ダッシュボード">
                        {model.dashboards.map((d) => (
                          <Link
                            key={d.id}
                            id={optionId(d.index)}
                            href={d.href}
                            data-idx={d.index}
                            role="option"
                            aria-selected={highlight === d.index}
                            onClick={close}
                            onMouseEnter={() => setHighlight(d.index)}
                            className={rowClass(d.index)}
                          >
                            <NavIcon
                              name="dashboard"
                              className="h-4 w-4 shrink-0 text-khaki-500"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {d.name}
                            </span>
                          </Link>
                        ))}
                        {data.more.dashboards && <MoreHint />}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            {!loading && !error && isEmpty && (
              /*
               * 打つ前と打った後で言うことが違う。
               * 打つ前に「一致するものがありません」と出すと、
               * 何も打っていないのに空振りしたように見える。
               */
              <p className="px-2 py-4 text-xs text-ink-faint">
                {trimmed.length === 0
                  ? "顧客名・案件名・シート名・ダッシュボード名で探せます。"
                  : `「${trimmed}」に一致するものがありません`}
              </p>
            )}

            {/* 何を見て何を見ていないかを添える。「無い」と「これ以上は
                見ていない」を取り違えさせないため。 */}
            {!loading && !error && hasScopeNote && (
              <p className="mt-1 border-t border-ink-line px-2 pt-2 text-2xs leading-relaxed text-ink-faint">
                各シートの新しい順 {data.scope.rowsPerCollection.toLocaleString()}{" "}
                行・最大 {data.scope.collections} シートを対象に検索しています。
                {!data.scope.computedFields &&
                  "数式・VLOOKUP などの計算列は対象外です。"}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
