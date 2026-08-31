"use client";

/**
 * トップページで、実際に動くダッシュボード。
 *
 * ## なぜ絵ではなく本物にしたのか
 *
 * ここには手描きの「製品っぽいスクリーンショット」を置いていた。数字は固定で、
 * 中身が変わっても絵は変わらない。つまり**いずれ実物と食い違う**し、
 * 「Excelを置いたらダッシュボードが出る」という唯一の約束を、
 * 見た人は結局ためさないと確かめられなかった。
 *
 * 組み立ての中核（`profileFields` → `autoLayoutFromProfiles` →
 * `computeDashboard`）はDBにもネットワークにも触れない純粋関数なので、
 * そのままブラウザで動く。描画も製品と同じ `DashboardGrid` を使う。
 * **ここで見えているものは、登録後に見えるものと1行も違わない。**
 *
 * ## ファイルを外に出さない
 *
 * 置かれたファイルは読み取りもサーバーへの送信も行わず、この端末の中だけで
 * 処理する。競合は「ChatGPTにCSVを貼って聞く」なので、違いは**実際に外へ
 * 出ないこと**にある。言葉で書くより、動かして見せるほうが早い。
 *
 * ## 重い読み取りは、必要になるまで読み込まない
 *
 * `xlsx` は 900KB 近くある。見本を眺めるだけの人に配るのは筋が悪いので、
 * ファイルが置かれた瞬間に動的 import する。見本は最初からサーバーで
 * 組んで渡してあるので、JavaScript が動く前から画面に出ている。
 */
import { useCallback, useRef, useState } from "react";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import type { WidgetSpec, WidgetData } from "@/lib/widgets";

type Computed = Array<{ widget: WidgetSpec; data: WidgetData }>;

interface Loaded {
  /** 見本か、置かれたファイルか。 */
  source: "sample" | "file";
  label: string;
  computed: Computed;
  rowCount: number;
  fieldCount: number;
}

/** 4MB。製品の取り込み上限（MAX_IMPORT_BYTES）と同じにしてある。 */
const MAX_BYTES = 4 * 1024 * 1024;

export function LiveDemo({
  initial,
  initialRowCount,
  initialFieldCount,
}: {
  initial: Computed;
  initialRowCount: number;
  initialFieldCount: number;
}) {
  const [loaded, setLoaded] = useState<Loaded>({
    source: "sample",
    label: "売上台帳（見本）",
    computed: initial,
    rowCount: initialRowCount,
    fieldCount: initialFieldCount,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(
        `ファイルが大きすぎます（上限 4MB）。シートを分けるか、不要な列を削って ${Math.ceil(file.size / 1024 / 1024)}MB を 4MB 以下にしてください。`,
      );
      return;
    }
    setBusy(true);
    try {
      // 読み取りと組み立ては、置かれたときに初めて読み込む。
      const [{ readSheet, inferFields }, { buildDemoDashboard }] =
        await Promise.all([import("@/lib/excel"), import("@/lib/demo-pipeline")]);

      const buffer = await file.arrayBuffer();
      const sheet = readSheet(buffer);
      if (sheet.headers.length === 0) {
        setError(
          "見出しの行が見つかりませんでした。1行目に列の名前が並んだ表をお試しください。",
        );
        return;
      }
      const fields = inferFields(sheet.headers, sheet.sampleByHeader).map((f) => ({
        key: f.key,
        name: f.name,
        type: f.type,
      }));
      const result = buildDemoDashboard({
        name: sheet.sheetName || file.name.replace(/\.[^.]+$/, ""),
        fields,
        rows: sheet.rows,
      });
      if (result.reason) {
        setError(result.reason);
        return;
      }
      setLoaded({
        source: "file",
        label: file.name,
        computed: result.computed,
        rowCount: result.rowCount,
        fieldCount: result.fieldCount,
      });
    } catch {
      setError(
        "このファイルは読み取れませんでした。Excel（.xlsx / .xls）か CSV をお試しください。",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) void handle(f);
    },
    [handle],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* ─── 置き場 ─────────────────────────────────────── */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3.5 py-2.5 transition-colors ${
          over
            ? "border-khaki-500 bg-khaki-50"
            : "border-ink-line bg-paper-raised"
        }`}
      >
        <span className="font-mono text-2xs text-ink-faint">
          {loaded.source === "sample" ? "見本" : "あなたのファイル"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {loaded.label}
        </span>
        {/*
          * 390px では、この件数表示とファイル名が横幅を取り合い、
          * 名前が「売…」の1文字まで潰れていた。何のファイルを見ているのかが
          * 分からなくなるので、狭い画面では件数のほうを引っ込める。
          */}
        <span className="hidden whitespace-nowrap font-mono text-2xs tabular-nums text-ink-muted sm:inline">
          {loaded.rowCount.toLocaleString("ja-JP")} 行 × {loaded.fieldCount} 列
        </span>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handle(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded border border-ink-rule bg-paper px-2.5 py-1 text-2xs font-medium text-ink-soft transition-colors hover:bg-paper-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki-500 disabled:opacity-50"
        >
          {busy ? "読んでいます…" : "自分のファイルで試す"}
        </button>
        {loaded.source === "file" && (
          <button
            type="button"
            onClick={() =>
              setLoaded({
                source: "sample",
                label: "売上台帳（見本）",
                computed: initial,
                rowCount: initialRowCount,
                fieldCount: initialFieldCount,
              })
            }
            className="rounded px-1.5 py-1 text-2xs text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            見本に戻す
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
        >
          {error}
        </p>
      )}

      {/* ─── 本物のダッシュボード ─────────────────────────── */}
      <div className="rounded-lg border border-ink-line bg-paper p-3 shadow-raised sm:p-4">
        <DashboardGrid computed={loaded.computed} />
      </div>

      <p className="text-2xs leading-relaxed text-ink-faint">
        {loaded.source === "file"
          ? "このファイルは送信していません。読み取りも集計もこの端末の中だけで行いました。"
          : "置いたファイルは送信されません。読み取りも集計もこの端末の中だけで行います。"}
        　画面の図表は、登録後に出るものと同じ部品で描いています。
      </p>
    </div>
  );
}
