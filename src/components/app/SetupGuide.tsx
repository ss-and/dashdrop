"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  nextStep as pickNextStep,
  onboardingProgress,
  type OnboardingStep,
  SETUP_DONE_COOKIE,
  SETUP_DONE_MAX_AGE,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";

/**
 * 右下に常駐する「設定ガイド」。
 *
 * ## 形を Stripe から借りた理由
 *
 * 登録直後にウィザードを出すと、この製品の約束（Excelを置けばダッシュボードが
 * 出る）を最初の1画面で破ることになる。**入口は塞がない**。代わりに骨格だけ
 * 借りた——右下常駐・細い進捗バー・「次: ◯◯」の1行・畳む/閉じる・全部済んだら
 * 消える。紫や大きな角丸は借りていない（角丸は 6px まで、面は paper、
 * アクセントはカーキ、という tailwind.config.ts の決めごとのまま）。
 *
 * ## 覚えておくこと（端末側）
 *
 * 「畳んだ」「閉じた」「一度でも見た」は localStorage に置く。DBに列を足す
 * ほどの情報ではないし、その人の1台のなかだけで意味がある——src/lib/recent.ts
 * と同じ判断。壊れていたら黙って初期値に戻す。**ガイドの状態のために画面を
 * 落とすのは割に合わない**。
 *
 * ## z-index
 *
 * 30。他のポップオーバー（通知ベル・ヘルプ・検索）と同じ段だが、あちらは
 * 全部 Topbar の下＝画面上部に出るので重ならない。モーダル（z-40 / z-50）
 * より下なのは意図どおりで、ダイアログが開いたらガイドは隠れてよい。
 */

type Stored = {
  /** 閉じた（もう出さない）。 */
  closed?: boolean;
  /** 畳んだ（見出しだけにする）。 */
  collapsed?: boolean;
  /** 一度でも未完了の状態で見た。「ひととおり終わりました」を出す条件。 */
  seen?: boolean;
  /** 完了の挨拶を出し終えた。 */
  farewell?: boolean;
};

const keyFor = (workspaceId: string) => `dashdrop:setup-guide:${workspaceId}`;

function read(workspaceId: string): Stored {
  if (typeof window === "undefined" || !workspaceId) return {};
  try {
    const raw = window.localStorage.getItem(keyFor(workspaceId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Stored;
  } catch {
    return {};
  }
}

function write(workspaceId: string, value: Stored): void {
  if (typeof window === "undefined" || !workspaceId) return;
  try {
    window.localStorage.setItem(keyFor(workspaceId), JSON.stringify(value));
  } catch {
    /* 容量超過やプライベートモード。覚えられなくてもガイドは動く。 */
  }
}

export function SetupGuide({
  workspaceId,
  steps,
}: {
  workspaceId: string;
  steps: OnboardingStep[];
}) {
  /*
   * localStorage はサーバーには無い。初回描画で読むと SSR と食い違って
   * ハイドレーションが警告を出すので、載ってから読む。1フレーム遅れて
   * 現れるが、常駐パネルにとってそれは問題にならない。
   */
  const [stored, setStored] = useState<Stored | null>(null);
  const progress = onboardingProgress(steps);

  useEffect(() => {
    const current = read(workspaceId);
    // 未完了の状態でガイドを出した事実を残す。これが無いと、最初から全部
    // 済んでいる人（シード済みのワークスペースなど）にまで「ひととおり
    // 終わりました」と言ってしまう——覚えのない完了報告ほど白けるものはない。
    if (!progress.complete && !current.seen && !current.closed) {
      const next = { ...current, seen: true };
      write(workspaceId, next);
      setStored(next);
      return;
    }
    setStored(current);
  }, [workspaceId, progress.complete]);

  /*
   * 全部済んだら、次のページからは数えずに済むよう印を残す。
   *
   * この材料を集めるクエリは全ページ共通の器（(app)/layout.tsx）に乗っている。
   * 終えた人がもう出ないパネルのために毎ページ払い続けるのは無駄なので、
   * Cookie を見つけたら層ごと飛ばす。localStorage ではなく Cookie なのは、
   * 判断するのがサーバー側だから。
   *
   * `steps.length > 0` を条件に入れているのは、**実際に数えた結果として
   * 完了した**ときだけ印を付けるため。サーバーが層を飛ばして steps を空で
   * 渡してきた場合も progress.complete は true になるが、それは「もう印が
   * ある」という意味なので、書き直す必要が無い。
   */
  useEffect(() => {
    if (steps.length === 0 || !progress.complete) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      `${SETUP_DONE_COOKIE}=1; path=/; max-age=${SETUP_DONE_MAX_AGE}; SameSite=Lax${secure}`;
  }, [steps.length, progress.complete]);

  function update(patch: Stored) {
    const next = { ...(stored ?? {}), ...patch };
    write(workspaceId, next);
    setStored(next);
  }

  if (!stored || stored.closed) return null;

  /* 全部済んだ ── 挨拶を一度だけ出して、あとは二度と出さない。 */
  if (progress.complete) {
    if (!stored.seen || stored.farewell) return null;
    return (
      <aside className={shell} aria-label="設定ガイド">
        <div className="flex items-start gap-2.5 px-3.5 py-3">
          <CheckMark className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">ひととおり終わりました</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              このガイドはもう出ません。困ったら右上の「?」から。
            </p>
          </div>
          <button
            type="button"
            onClick={() => update({ farewell: true })}
            className={closeButton}
          >
            閉じる
          </button>
        </div>
      </aside>
    );
  }

  const next = pickNextStep(steps);
  /*
   * 既定は畳んだ状態。
   *
   * 全ステップを開いたまま常駐させると、右下で 200px 以上を占め、ダッシュ
   * ボードのグラフや凡例を permanently に覆ってしまう（実際に「受注 / 失注」の
   * 凡例が隠れていた）。常に出しておくのは「進捗」と「次にやること1行」だけで
   * 足り、一覧は開いたときに見せる。
   *
   * `collapsed` が未設定なら畳む。明示的に false を入れた人（一度開いた人）は
   * 開いたままにする。
   */
  const collapsed = stored.collapsed !== false;
  const percent = Math.round((progress.done / progress.total) * 100);

  return (
    <aside className={shell} aria-label="設定ガイド">
      <div className="flex items-center gap-1 border-b border-ink-line px-1.5 py-1.5">
        <button
          type="button"
          onClick={() => update({ collapsed: !collapsed })}
          aria-expanded={!collapsed}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left",
            "transition-colors duration-fast hover:bg-paper-sunken",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-khaki-500/40",
          )}
        >
          <Chevron
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-fast",
              collapsed ? "rotate-0" : "rotate-90",
            )}
          />
          <span className="truncate text-sm font-medium text-ink">設定ガイド</span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-ink-muted">
            {progress.done}/{progress.total}
          </span>
        </button>
        <button
          type="button"
          onClick={() => update({ closed: true })}
          className={closeButton}
          aria-label="設定ガイドを閉じる"
        >
          閉じる
        </button>
      </div>

      {/* 進捗バー。細く、色は1本だけ。太い帯にすると数字より先に目に入る。 */}
      <div
        className="h-1 w-full bg-paper-sunken"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
        aria-label={`${progress.total} 件中 ${progress.done} 件が完了`}
      >
        <div className="h-full bg-khaki-500" style={{ width: `${percent}%` }} />
      </div>

      {/*
        畳んでいるときの1行。ここが常駐時の本体になる——「あと何があるか」より
        「次に何をすればいいか」の方が、手が動く。
      */}
      {collapsed && next && (
        <button
          type="button"
          onClick={() => update({ collapsed: false })}
          className="flex w-full items-start gap-2 px-3.5 py-2.5 text-left transition-colors duration-fast hover:bg-paper-sunken"
        >
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-khaki-500" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">
              次: {next.label}
            </span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              {next.description}
            </span>
          </span>
        </button>
      )}

      {!collapsed && (
        <ul className="max-h-[min(24rem,60vh)] overflow-y-auto py-1">
          {steps.map((step) => {
            const isNext = step.id === next?.id;
            return (
              <li key={step.id}>
                {step.done ? (
                  /* 済んだものは押せなくてよい。行き先はもう用が無い。 */
                  <div className="flex items-center gap-2.5 px-3.5 py-1.5">
                    <CheckMark className="h-4 w-4 shrink-0 text-success" />
                    <span className="truncate text-xs text-ink-muted">
                      {step.label}
                    </span>
                  </div>
                ) : (
                  <Link
                    href={step.href}
                    className={cn(
                      "block px-3.5 py-2 transition-colors duration-fast hover:bg-paper-sunken",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-khaki-500/40",
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full border",
                          isNext
                            ? "border-khaki-500 bg-khaki-500"
                            : "border-ink-rule",
                        )}
                      />
                      <span
                        className={cn(
                          "truncate text-xs",
                          isNext
                            ? "font-medium text-khaki-700"
                            : "text-ink-soft",
                        )}
                      >
                        {isNext ? `次: ${step.label}` : step.label}
                      </span>
                    </span>
                    {/* 理由は次の一手にだけ添える。全部に付けると読まれない。 */}
                    {isNext && (
                      <span className="mt-1 block pl-[1.125rem] text-xs leading-relaxed text-ink-muted">
                        {step.description}
                      </span>
                    )}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/*
 * 器の見た目。挨拶と本体で同じものを使うので定数に出してある。
 * 角丸は rounded-md（4px）まで、影は shadow-raised、面は paper-raised。
 */
const shell = cn(
  /*
   * 狭い画面には出さない。
   *
   * 幅 19rem は 390px の画面ではほぼ全幅で、右下に置くと**表やグラフの上に
   * 居座る**（実機で表の4行目以降を覆っていた）。しかもここが促すのは
   * 「Excelを取り込む」——スマホでやる作業ではない。覆ってまで出す価値がない。
   */
  "hidden sm:block",
  "fixed bottom-4 right-4 z-30 w-[min(19rem,calc(100vw-2rem))]",
  "animate-fade-in rounded-md border border-ink-line bg-paper-raised shadow-raised",
);

const closeButton = cn(
  "shrink-0 rounded px-2 py-1 text-xs text-ink-faint",
  "transition-colors duration-fast hover:bg-paper-sunken hover:text-ink",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-khaki-500/40",
);

/* icons.tsx にチェックと山括弧の細いものが無いので、ここに置いた。 */
function CheckMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m4 12.5 5 5 11-11" />
    </svg>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
