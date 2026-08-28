"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { NavIcon } from "@/components/app/icons";
import {
  ImportReview,
  type AnalyzeResult,
  type ImportMode,
  type SheetSelection,
} from "./ImportReview";
import type { DashboardIntent } from "@/lib/dashboard-intent";

/**
 * ホームの主役 — Excel を置く場所。
 *
 * これを作った理由は、利用者からのこの指摘そのもの:
 * 「文字や見る機能が多すぎて、わかりづらくなっている気がするし、
 *   結局Excelをもっと複雑化したみたいな印象かな」
 *
 * それまでのホームは「今日の数字 / 売上サマリー / スプレッドシート /
 * ダッシュボード」の4段積みで、この製品の入口である「Excelを入れる」が
 * どこにも無かった。データベース製品の見た目になっていて、価値が見えない。
 *
 * ここは1手で終わらせる。落とす → 取り込む → グラフまで作る → その画面へ。
 * 途中で設定を聞かない（列の対応づけを直したい人のために /import は残す）。
 */

/**
 * 取り込みの進み方。
 *
 * 以前は「置いた瞬間に取り込む」だけで、確認の余地が無かった。速い代わりに、
 * 想定と違う入り方をしても気づけない（複数タブの取りこぼし、結合セルで欠けた
 * 列名など、入った後では分からない類）。下見（scan）を挟み、提案と質問を見せて
 * から確定する。
 */
type Phase =
  | { kind: "idle" }
  | { kind: "working"; step: "scan" | "upload" | "build"; fileName: string }
  | { kind: "review"; file: File; result: AnalyzeResult }
  | { kind: "importing"; file: File; result: AnalyzeResult }
  | { kind: "error"; message: string };

const ACCEPT = ".xlsx,.xls,.csv";

/**
 * アップロードの上限。**サーバ側の MAX_IMPORT_BYTES（src/lib/excel.ts）と
 * 同じ値にすること。**
 *
 * ここに写しを持つのは、@/lib/excel を client component から import すると
 * xlsx（数百KB）ごとブラウザのバンドルに入ってしまうため。GenerateWizard も
 * 同じ理由で定数を写している。
 *
 * そして、この画面側の判定はサーバ側の重複ではなく**唯一効く判定**でもある。
 * Vercel はリクエストボディを 4.5MB で打ち切り、その 413 はハンドラが起動する
 * 前に返るので、大きいファイルではサーバ側の日本語メッセージは出ない。
 * 送る前にここで止めて、理由と次の一手をこちらから伝える。
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4MB
const MAX_UPLOAD_LABEL = "4MB";

/** 拡張子だけ先に見て、明らかに違うものは通信する前に断る。 */
function looksSupported(file: File): boolean {
  return /\.(xlsx|xls|csv)$/i.test(file.name);
}

/** 大きすぎるファイルの断り文句。何MBだったかと、減らし方まで書く。 */
function tooLargeMessage(file: File): string {
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  return `このファイルは大きすぎます（約${mb}MB / 上限${MAX_UPLOAD_LABEL}）。シートを分けて取り込むか、不要な列や行を削ってから、もう一度お試しください。`;
}

export function ExcelDropZone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  /** 止めるほどではないが、伝えておきたいこと。 */
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** ドラッグ中の子要素をまたぐたびに leave が飛ぶので、深さで数える。 */
  const dragDepth = useRef(0);

  const busy = phase.kind === "working" || phase.kind === "importing";

  /** 段階1 — ファイルを下見して、提案と質問を作る。まだ何も書き込まない。 */
  const run = useCallback(async (file: File) => {
    if (!looksSupported(file)) {
      setPhase({
        kind: "error",
        message: "Excel（.xlsx / .xls）か CSV のファイルを置いてください。",
      });
      return;
    }
    // 送ってから断られるのでは遅い（4.5MB を超えるとサーバ側の文面は
    // そもそも出ない）。読み込みの表示を出す前にここで止める。
    if (file.size > MAX_UPLOAD_BYTES) {
      setPhase({ kind: "error", message: tooLargeMessage(file) });
      return;
    }

    setPhase({ kind: "working", step: "scan", fileName: file.name });
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import/analyze", {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        data?: AnalyzeResult;
      } | null;

      if (!res.ok || !body?.ok || !body.data) {
        setPhase({
          kind: "error",
          message: body?.error ?? "ファイルを読み取れませんでした。",
        });
        return;
      }
      setPhase({ kind: "review", file, result: body.data });
    } catch {
      setPhase({
        kind: "error",
        message: "通信エラーが発生しました。しばらくして再度お試しください。",
      });
    }
  }, []);

  /** 段階2 — 確認した内容で取り込み、グラフまで作ってその画面へ送る。 */
  const commit = useCallback(
    async (
      file: File,
      result: AnalyzeResult,
      selection: SheetSelection[],
      mode: ImportMode,
      intent: DashboardIntent,
    ) => {
      setPhase({ kind: "importing", file, result });
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("sheets", JSON.stringify(selection));
        form.append("mode", mode);
        // 上書き先は名前ではなく id で指定する。下見のあとに同名のファイルが
        // もう1つ増えていても、利用者が見て選んだものへ確実に当たるように。
        if (mode === "replace" && result.existing) {
          form.append("workbookId", result.existing.workbookId);
        }
        const res = await fetch("/api/import", { method: "POST", body: form });
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          data?: {
            collectionId?: string;
            workbookId?: string;
            warning?: string | null;
            notice?: string | null;
          };
        } | null;

        if (!res.ok || !body?.ok || !body.data?.collectionId) {
          setPhase({
            kind: "error",
            message: body?.error ?? "取り込みに失敗しました。",
          });
          return;
        }

        const { collectionId, workbookId, warning, notice } = body.data;

        // 行が落ちた場合は、グラフに進む前に必ず伝える。黙って先に進むと
        // 「取り込めた」と誤解したまま、欠けた数字でグラフを見ることになる。
        if (warning) {
          setPhase({ kind: "error", message: warning });
          router.push(`/c/${collectionId}`);
          return;
        }

        // 進行は止めない知らせ（上書きで残したシートなど）。受信箱にも
        // 同じものが残るので、画面が切り替わっても後から確認できる。
        if (notice) setNotice(notice);

        // 表だけ出して終わりにしない。グラフまで出して初めて
        // 「入れたら分析が出てきた」という体験になる。
        setPhase({ kind: "working", step: "build", fileName: file.name });
        const auto = await fetch("/api/dashboards/auto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(workbookId ? { workbookId } : { collectionId }),
            intent,
          }),
        });
        const autoBody = (await auto.json().catch(() => null)) as {
          ok?: boolean;
          data?: { dashboardId?: string };
        } | null;

        // グラフ作りに失敗しても取り込み自体は成功している。表へ送る。
        if (auto.ok && autoBody?.ok && autoBody.data?.dashboardId) {
          router.push(`/d/${autoBody.data.dashboardId}`);
        } else {
          router.push(`/c/${collectionId}`);
        }
        router.refresh();
      } catch {
        setPhase({
          kind: "error",
          message:
            "通信エラーが発生しました。しばらくして再度お試しください。",
        });
      }
    },
    [router],
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void run(file);
  }

  // 確認中はドロップ枠を引っ込め、確認画面だけを見せる。並べて出すと
  // 「置き直すのか、確認して進むのか」がぼやける。
  if (phase.kind === "review" || phase.kind === "importing") {
    return (
      <ImportReview
        result={phase.result}
        busy={phase.kind === "importing"}
        onConfirm={(selection, mode, intent) =>
          void commit(phase.file, phase.result, selection, mode, intent)
        }
        onCancel={() => setPhase({ kind: "idle" })}
      />
    );
  }

  return (
    <section>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          if (!busy) setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDrop={onDrop}
        className={[
          "rounded-md border-2 border-dashed px-6 py-14 text-center transition-colors",
          dragging
            ? "border-khaki-500 bg-khaki-50"
            : "border-ink-line bg-paper-raised",
          busy ? "opacity-90" : "",
        ].join(" ")}
      >
        {busy ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <p className="text-lg font-semibold text-ink">
              {phase.step === "scan"
                ? "中身を読んでいます…"
                : phase.step === "upload"
                  ? "取り込んでいます…"
                  : "グラフを作っています…"}
            </p>
            <p className="text-sm text-ink-muted">{phase.fileName}</p>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-semibold text-ink">
              Excelをここに置いてください
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              置くだけで表とグラフになります。設定は要りません。
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-6 inline-flex h-11 items-center gap-2 rounded bg-khaki-500 px-5 text-sm font-medium text-white transition-colors hover:bg-khaki-600"
            >
              <NavIcon name="upload" className="h-4 w-4" />
              ファイルを選ぶ
            </button>
            <p className="mt-4 text-xs text-ink-muted">
              .xlsx / .xls / CSV、{MAX_UPLOAD_LABEL}まで（Excelで保存したものは
              そのままで大丈夫です）
            </p>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // 同じファイルをもう一度選べるように毎回クリアする。
            e.target.value = "";
            if (file) void run(file);
          }}
        />
      </div>

      {phase.kind === "error" && (
        <p
          role="alert"
          className="mt-3 rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {phase.message}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="mt-3 rounded border border-ink-line bg-paper-sunken px-3 py-2 text-sm text-ink-soft"
        >
          {notice}
        </p>
      )}

      {/* 列の対応づけを自分で決めたい人と、手元にファイルが無い人の逃げ道。
          主導線ではないので、文字は小さく1行に収める。 */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <Link href="/import" className="text-khaki-700 hover:underline">
          列を確認しながら取り込む
        </Link>
        <Link href="/samples" className="text-khaki-700 hover:underline">
          手元にファイルが無いので、見本で試す
        </Link>
      </div>
    </section>
  );
}
