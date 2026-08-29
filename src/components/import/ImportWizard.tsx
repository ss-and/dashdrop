"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { NavIcon } from "@/components/app/icons";
import { cn } from "@/lib/utils";
import {
  FIELD_TYPES,
  FIELD_TYPE_META,
  type FieldType,
} from "@/lib/field-types";
import {
  IMPORT_MODE_OPTIONS,
  defaultImportMode,
  type ExistingWorkbook,
  type ImportMode,
} from "@/lib/import-mode";

interface InferredField {
  name: string;
  key: string;
  type: FieldType;
}
interface SheetPreview {
  sheetName: string;
  headers: string[];
  rowCount: number;
  inferredFields: InferredField[];
  previewRows: Record<string, unknown>[];
  empty: boolean;
  /** Excel上で非表示のシートか。パーサが申告しない場合に備えて任意扱い。 */
  hidden?: boolean;
  /** 行・列が打ち切られたときの日本語の警告（パーサが生成）。 */
  warnings?: string[];
}
interface EditableField {
  /** 利用者が自由に変えられる表示名。 */
  name: string;
  key: string;
  type: FieldType;
  required: boolean;
  /**
   * 値を読み出す元の列名。表示名を変えても絶対に動かさない。
   * これを送らないと、サーバ側は並び順でしか列と対応づけられない。
   */
  sourceHeader: string;
}
interface SheetState {
  sheetName: string;
  headers: string[];
  rowCount: number;
  previewRows: Record<string, unknown>[];
  fields: EditableField[];
  collectionName: string;
  selected: boolean;
  warnings: string[];
}

interface NotionDatabase {
  id: string;
  title: string;
  url: string;
}

/** /api/import/notion の成功ペイロードのうち、この画面が使う部分。 */
interface NotionImportResult {
  collectionId?: string;
  /** 行が途中で打ち切られたときの日本語の警告。全行取り込めていれば null。 */
  warning?: string | null;
}

/**
 * 取り込んだものからダッシュボードを1枚作り、その行き先を返す。
 *
 * ホームのドロップゾーンと**同じ手順**（src/components/home/ExcelDropZone.tsx）。
 * 2か所で別々に組み立てると、片方だけ直して食い違う——実際に、あちらだけが
 * ダッシュボードへ送っていて、こちらは表に着地していた。
 *
 * 失敗しても投げない。取り込みそのものは成功しているので、呼び出し側が
 * 表へ送れるように null を返すだけにする。
 */
async function autoDashboardHref(
  data: FileImportResult | undefined,
): Promise<string | null> {
  const target = data?.workbookId
    ? { workbookId: data.workbookId }
    : data?.collectionId
      ? { collectionId: data.collectionId }
      : null;
  if (!target) return null;
  try {
    const res = await fetch("/api/dashboards/auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      data?: { dashboardId?: string };
    } | null;
    if (!res.ok || !body?.ok || !body.data?.dashboardId) return null;
    return `/d/${body.data.dashboardId}`;
  } catch {
    return null;
  }
}

/** /api/import と /api/import/gsheets の成功ペイロードのうち、この画面が使う部分。 */
interface FileImportResult {
  collectionId?: string;
  workbookId?: string;
  sheetsImported?: number;
  /** 型に合わず空欄として取り込まれたセル数。 */
  skipped?: number;
  /** 打ち切りや未変換セルがあるときの日本語の警告。問題なければ null。 */
  warning?: string | null;
}

const ALLOWED = ".xlsx,.xls,.csv";

/**
 * アップロードの上限。**サーバ側の MAX_IMPORT_BYTES（src/lib/excel.ts）と
 * 同じ値にすること。**
 *
 * ここに写しを持つのは、@/lib/excel を client component から import すると
 * xlsx（数百KB）ごとブラウザのバンドルに入ってしまうため。
 *
 * そして、この画面側の判定はサーバ側の重複ではなく**唯一効く判定**でもある。
 * Vercel はリクエストボディを 4.5MB で打ち切り、その 413 はハンドラが起動する
 * 前に返るので、大きいファイルではサーバ側の日本語メッセージは出ない。
 * 送る前にここで止めて、理由と次の一手をこちらから伝える。
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4MB
const MAX_UPLOAD_LABEL = "4MB";

/** 大きすぎるファイルの断り文句。何MBだったかと、減らし方まで書く。 */
function tooLargeMessage(file: File): string {
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  return `このファイルは大きすぎます（約${mb}MB / 上限${MAX_UPLOAD_LABEL}）。シートを分けて取り込むか、不要な列や行を削ってから、もう一度お試しください。`;
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "✓" : "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function ImportWizard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetState[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 取り込みは成功したが、そのまま画面を移ると気づけないこと（打ち切り・
  // 空欄になったセル）。遷移先は保持して、進むかどうかは本人に決めてもらう。
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [importDest, setImportDest] = useState<string | null>(null);

  /*
   * 同じ名前で既に入っているファイル（/api/import/preview が返す）と、その扱い。
   *
   * 【回帰防止】以前この画面は mode を送っていなかったので、/api/import は
   * 常に "add" として動いていた。毎月同じ「売上台帳」を入れ直す人のファイルが
   * 1つずつ増え、同名のシートとダッシュボードが並んで見分けが付かなくなる。
   * ホームのドロップゾーン（ExcelDropZone → ImportReview）は最初から選ばせて
   * いたのに、設定ガイドが案内するのはこちらの画面だった。
   *
   * 既定は import-mode.ts の defaultImportMode に任せる（同名があれば
   * "replace"）。ホーム側と既定が食い違うと、同じ操作の結果が入口で変わる。
   */
  const [existing, setExisting] = useState<ExistingWorkbook | null>(null);
  const [mode, setMode] = useState<ImportMode>("add");

  // Import source: a local file, a public/link-shared Google Sheets URL, or a
  // Notion database read through the workspace's stored integration token.
  const [source, setSource] = useState<"file" | "gsheets" | "notion">("file");
  const [gsheetsUrl, setGsheetsUrl] = useState("");
  const [gsheetsLoading, setGsheetsLoading] = useState(false);

  // Notion has no mapping step: the database schema already carries the types,
  // so picking a database commits the import directly.
  const [notionDbs, setNotionDbs] = useState<NotionDatabase[] | null>(null);
  const [notionDbId, setNotionDbId] = useState("");
  const [notionName, setNotionName] = useState("");
  const [notionLoading, setNotionLoading] = useState(false);
  const [notionImporting, setNotionImporting] = useState(false);
  const [notionNotConnected, setNotionNotConnected] = useState(false);
  // 部分的にしか取り込めなかったときの警告と、その結果できたシートのID。
  const [notionWarning, setNotionWarning] = useState<string | null>(null);
  const [notionResultId, setNotionResultId] = useState<string | null>(null);
  // 打ち切られた取り込みの元データベース。同じデータベースをもう一度取り込んでも
  // 取り込めなかった行は取得されず、同じ先頭N行のスプレッドシートがもう1つ増えて
  // プランのシート数を消費するだけなので、再実行そのものを止める。
  const [notionTruncatedDbId, setNotionTruncatedDbId] = useState<string | null>(null);

  // Notionの取り込み中は他のソースを触らせない。ファイルやGoogle Sheetsを
  // 開始するとmapステップへ移るが、そのあと解決したNotion取り込みが
  // router.pushで画面を奪い、入力内容が説明なく消えるため。
  const notionBusy = notionImporting;
  // 逆向きも同じ。ファイル/Google Sheetsの解析中にNotion取り込みを走らせると、
  // 先に終わったNotion側のrouter.pushが解析結果を奪って消してしまう。
  const otherSourceBusy = loading || gsheetsLoading;
  // 打ち切られた直後の同一データベースは、押せても重複を作るだけ。
  const notionRerunBlocked =
    notionTruncatedDbId !== null && notionTruncatedDbId === notionDbId;

  const step: "upload" | "map" = sheets ? "map" : "upload";
  const selectedCount = sheets?.filter((s) => s.selected).length ?? 0;
  // 実際に取り込まれるシート。上書き時に「どれが入れ替わるか」を出すのに使う
  // （runImport が送る chosen と同じ条件にしてあること）。
  const chosenSheets = sheets?.filter((s) => s.selected && s.fields.length > 0) ?? [];
  // 列名が空のまま送ると、サーバ側でその項目が落ちて以降の列が1つずつずれる
  // （入社日の欄に部署が入り、最後の列は消える）。押せる前に止める。
  const blankNameBlocked =
    sheets?.some((s) => s.selected && s.fields.some((f) => !f.name.trim())) ??
    false;
  // 警告付きで完了したあとの再実行は、同じ内容のスプレッドシートを
  // もう1つ作るだけ（＋唯一の導線である警告表示が消える）。
  const importDone = importWarning !== null;

  function reset() {
    setFile(null);
    setSheets(null);
    setError(null);
    setSource("file");
    setGsheetsUrl("");
    setNotionDbs(null);
    setNotionDbId("");
    setNotionName("");
    setNotionNotConnected(false);
    setNotionWarning(null);
    setNotionResultId(null);
    setNotionTruncatedDbId(null);
    setImportWarning(null);
    setImportDest(null);
    setExisting(null);
    // 別のファイルを選び直したのに前のファイルの「上書きする」が残っていると、
    // 関係ないブックを置き換えてしまう。ここで必ず安全側（追加）へ戻す。
    setMode("add");
    if (inputRef.current) inputRef.current.value = "";
  }

  /** Map the preview `{ sheets }` payload into editable per-sheet state. */
  function ingestSheets(previews: SheetPreview[]) {
    setSheets(
      previews.map((s) => ({
        sheetName: s.sheetName,
        headers: s.headers,
        rowCount: s.rowCount,
        previewRows: s.previewRows,
        collectionName: s.sheetName || "インポート",
        // 【回帰防止】以前は非表示シートも含めて全て選択済みにしていた。
        // 「作業用」のような裏方のタブが勝手にスプレッドシート化され、
        // プランのシート数まで消費していた。必要なら本人が選び直せる。
        selected: s.hidden !== true,
        warnings: Array.isArray(s.warnings) ? s.warnings : [],
        fields: s.inferredFields.map((f) => ({
          name: f.name,
          key: f.key,
          type: f.type,
          required: false,
          // 推定時点の名前＝元の列。以降 name をどう変えてもここは動かさない。
          sourceHeader: f.name,
        })),
      })),
    );
  }

  async function handleFile(picked: File) {
    setError(null);
    // 送ってから断られるのでは遅い（4.5MB を超えるとサーバ側の文面は
    // そもそも出ない）。解析中の表示に入る前にここで止める。file を
    // 立てないのは、この後の確定ボタンが「選択済みのファイル」を見るため。
    if (picked.size > MAX_UPLOAD_BYTES) {
      setError(tooLargeMessage(picked));
      setFile(null);
      setSheets(null);
      return;
    }
    setLoading(true);
    setFile(picked);
    try {
      const form = new FormData();
      form.append("file", picked);
      const res = await fetch("/api/import/preview", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "ファイルの解析に失敗しました");
        setFile(null);
        return;
      }
      const data = body.data as {
        sheets: SheetPreview[];
        existing?: ExistingWorkbook | null;
      };
      setSource("file");
      // 古いデプロイの preview が existing を返さない場合もあるので、
      // 無ければ「同名なし」＝従来どおりの追加として扱う。
      const found = data.existing ?? null;
      setExisting(found);
      setMode(defaultImportMode(found));
      ingestSheets(data.sheets);
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
      setFile(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleGsheets() {
    const url = gsheetsUrl.trim();
    if (!url) {
      setError("Google SheetsのURLを貼り付けてください。");
      return;
    }
    setError(null);
    setGsheetsLoading(true);
    try {
      const res = await fetch("/api/import/gsheets/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "Google Sheetsの読み込みに失敗しました");
        return;
      }
      const data = body.data as { sheets: SheetPreview[] };
      setFile(null);
      setSource("gsheets");
      /*
       * Google スプレッドシート経由には同名の置き換えが無い。
       * /api/import/gsheets は mode を受け取らず必ず db.workbook.create する
       * ので、選択肢を出しても効かない（押せるのに何も変わらないのが最悪）。
       * 出さないことをここで明示しておく。
       */
      setExisting(null);
      setMode("add");
      ingestSheets(data.sheets);
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setGsheetsLoading(false);
    }
  }

  /** Load the databases the workspace's Notion token can see. */
  async function loadNotionDatabases() {
    setError(null);
    setNotionNotConnected(false);
    setNotionLoading(true);
    try {
      const res = await fetch("/api/integrations/notion/databases");
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        // 400 means "no token stored" — offer the settings link instead of an
        // error the user cannot act on here.
        if (res.status === 400) setNotionNotConnected(true);
        else setError(body?.error ?? "Notionのデータベース一覧を取得できませんでした");
        return;
      }
      // ok:true でも data ごと欠けている envelope があり得る（TypeError防止）。
      const data = body.data as { databases?: NotionDatabase[] } | undefined;
      const list = Array.isArray(data?.databases) ? data.databases : [];
      setNotionDbs(list);
      if (list.length > 0) {
        setNotionDbId(list[0].id);
        setNotionName(list[0].title);
      }
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setNotionLoading(false);
    }
  }

  /** Commit a Notion database as a new spreadsheet. */
  async function runNotionImport() {
    if (!notionDbId) return;
    // 再実行が重複シートしか生まないケースと、他ソースの解析中は走らせない
    // （ボタンのdisabledと同じ条件。Enterキーなど別経路からの実行も塞ぐ）。
    if (notionImporting || otherSourceBusy || notionRerunBlocked) return;
    setError(null);
    setNotionWarning(null);
    setNotionResultId(null);
    setSource("notion");
    setNotionImporting(true);
    try {
      const res = await fetch("/api/import/notion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          databaseId: notionDbId,
          collectionName: notionName.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "Notionからの取り込みに失敗しました");
        return;
      }
      const data = body.data as NotionImportResult | undefined;
      const collectionId = data?.collectionId;
      if (!collectionId) {
        setError("取り込み結果を受け取れませんでした。スプレッドシート一覧をご確認ください。");
        return;
      }
      if (data?.warning) {
        // 一部しか取り込めていない場合に自動遷移すると警告ごと消え、利用者は
        // 「全行入った」と誤解する。遷移するかどうかは本人に決めてもらう。
        setNotionWarning(data.warning);
        setNotionResultId(collectionId);
        // 画面に留まる以上、同じデータベースの取り込みボタンは押せたままになる。
        // 押しても続きは取得できず重複シートが増えるだけなので、ここで塞ぐ。
        setNotionTruncatedDbId(notionDbId);
        router.refresh();
        return;
      }
      router.push(`/c/${collectionId}`);
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setNotionImporting(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    if (notionBusy) return;
    const picked = e.target.files?.[0];
    if (picked) void handleFile(picked);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (notionBusy) return;
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) void handleFile(dropped);
  }

  function patchSheet(si: number, patch: Partial<SheetState>) {
    setSheets((prev) =>
      prev ? prev.map((s, i) => (i === si ? { ...s, ...patch } : s)) : prev,
    );
  }
  function patchField(si: number, fi: number, patch: Partial<EditableField>) {
    setSheets((prev) =>
      prev
        ? prev.map((s, i) =>
            i === si
              ? { ...s, fields: s.fields.map((f, j) => (j === fi ? { ...f, ...patch } : f)) }
              : s,
          )
        : prev,
    );
  }

  async function runImport() {
    if (!sheets) return;
    if (source === "file" && !file) return;
    // ボタンのdisabledと同じ条件。Enterキーなど別経路からの実行も塞ぐ。
    if (importing || importDone || blankNameBlocked) return;
    const chosen = sheets.filter((s) => s.selected && s.fields.length > 0);
    if (chosen.length === 0) return;
    const selection = chosen.map((s) => ({
      sheetName: s.sheetName,
      collectionName: s.collectionName.trim() || s.sheetName,
      fields: s.fields,
    }));
    setError(null);
    setImporting(true);
    try {
      let res: Response;
      if (source === "gsheets") {
        res = await fetch("/api/import/gsheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: gsheetsUrl.trim(), sheets: selection }),
        });
      } else {
        const form = new FormData();
        form.append("file", file as File);
        form.append("sheets", JSON.stringify(selection));
        /*
         * 【回帰防止】ここで mode を送らないと /api/import は既定の "add" で
         * 動き、同名のファイルが黙って増え続ける（この画面が長らくそうだった）。
         * 同名が無いときは "add" 固定——ホーム側（ImportReview → ExcelDropZone）
         * と同じ送り方。
         */
        form.append("mode", existing ? mode : "add");
        // 上書き先は名前ではなく id で指定する。下見のあとに同名のファイルが
        // もう1つ増えていても、利用者が見て選んだものへ確実に当たるように。
        if (existing && mode === "replace") {
          form.append("workbookId", existing.workbookId);
        }
        res = await fetch("/api/import", { method: "POST", body: form });
      }
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "取り込みに失敗しました");
        return;
      }
      const data = body.data as FileImportResult | undefined;

      /*
       * 着地はダッシュボード。
       *
       * この製品の約束は「Excelを置いたらダッシュボードが出る」。ホームの
       * ドロップゾーンは最初からそう作られていた（/api/dashboards/auto を
       * 呼んでから /d/… へ送る）のに、**この画面だけ表かファイル概要に
       * 着地していた**。同じ部屋への扉が2つあって行き先が違う、という状態で、
       * /import から入った人だけが「置いたのにグラフが出ない、自分で作りに
       * 行かないといけない」という体験をしていた。
       *
       * グラフ作りに失敗しても取り込み自体は成功しているので、そのときだけ
       * 従来どおり表（複数シートならファイル概要）へ送る。
       */
      const fallback =
        (data?.sheetsImported ?? 0) > 1 && data?.workbookId
          ? `/f/${data.workbookId}`
          : data?.collectionId
            ? `/c/${data.collectionId}`
            : null;
      const dest = (await autoDashboardHref(data)) ?? fallback;
      if (!dest) {
        setError("取り込み結果を受け取れませんでした。スプレッドシート一覧をご確認ください。");
        return;
      }
      if (data?.warning) {
        // 【回帰防止】以前は skipped も warning も読まずに即 router.push して
        // いた。3,000行の売上台帳で金額200セルが「1,234円」のまま空欄になって
        // も、緑のグリッドが出るだけで何も知らせていなかった。
        // 自動遷移すると警告ごと消えるので、進むかどうかは本人に決めてもらう。
        setImportWarning(data.warning);
        setImportDest(dest);
        router.refresh();
        return;
      }
      router.push(dest);
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {error && (
        <div role="alert" className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle>Excel / CSV を取り込む</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-4 text-sm text-ink-muted">
              Excel/CSVをアップロードすると、列を自動でフィールド化してスプレッドシートを作成します。
              複数シート（タブ）がある場合は、それぞれを別のスプレッドシートとして取り込めます。
            </p>
            <div
              onDragOver={(e) => { e.preventDefault(); if (!notionBusy) setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => { if (!notionBusy) inputRef.current?.click(); }}
              role="button"
              tabIndex={notionBusy ? -1 : 0}
              aria-disabled={notionBusy}
              onKeyDown={(e) => { if (!notionBusy && (e.key === "Enter" || e.key === " ")) inputRef.current?.click(); }}
              className={cn(
                "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
                notionBusy
                  ? "pointer-events-none cursor-not-allowed border-ink-line bg-paper-sunken opacity-50"
                  : "cursor-pointer",
                !notionBusy && (dragging ? "border-khaki-500 bg-khaki-50" : "border-ink-line bg-paper-sunken hover:bg-khaki-50/60"),
              )}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-khaki-100 text-khaki-700">
                <NavIcon name="upload" className="h-6 w-6" />
              </span>
              {loading ? (
                <p className="text-sm font-medium text-ink">解析中…</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-ink">ファイルをドラッグ＆ドロップ</p>
                  <p className="text-xs text-ink-muted">またはクリックして選択（.xlsx / .xls / .csv、{MAX_UPLOAD_LABEL}まで）</p>
                </>
              )}
              <input ref={inputRef} type="file" accept={ALLOWED} className="hidden" onChange={onPick} disabled={notionBusy} />
            </div>

            <div className="mt-5 rounded-lg border border-ink-line bg-paper-raised p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-khaki-100 text-khaki-700">
                  <NavIcon name="table" className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-ink">Google スプレッドシートから取り込み</p>
                  <p className="text-xs text-ink-muted">共有URLを貼り付けるだけ（OAuth不要）</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={gsheetsUrl}
                  onChange={(e) => setGsheetsUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !notionBusy) { e.preventDefault(); void handleGsheets(); } }}
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  className="flex-1"
                  inputMode="url"
                  disabled={gsheetsLoading || notionBusy}
                />
                <Button
                  variant="secondary"
                  onClick={() => void handleGsheets()}
                  disabled={gsheetsLoading || notionBusy || !gsheetsUrl.trim()}
                >
                  {gsheetsLoading ? "読み込み中…" : "読み込む"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                共有設定を『リンクを知っている全員（閲覧者）』にしてください。
              </p>
            </div>

            <div className="mt-4 rounded-lg border border-ink-line bg-paper-raised p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-khaki-100 text-khaki-700">
                  <NavIcon name="folder" className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-ink">Notionから取り込み</p>
                  <p className="text-xs text-ink-muted">
                    データベースを選ぶだけ（列の型はNotionの設定を引き継ぎます）
                  </p>
                </div>
              </div>

              {notionWarning && (
                <div
                  role="status"
                  className="mb-3 rounded border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning"
                >
                  <p>{notionWarning}</p>
                  {/* 「足りない」だけ伝えて再実行できると、同じ先頭N行の
                      スプレッドシートがもう1つできるだけになる。何が起きるかを
                      明示し、次にやるべきことまで書く。 */}
                  <p className="mt-1">
                    このデータベースをもう一度取り込んでも、取り込めなかった行は取得されません。同じ内容のスプレッドシートがもう1つ作成されるだけのため、再取り込みは停止しています。Notion側で不要な行を減らすか、別のデータベースを選んでください。
                  </p>
                  {notionResultId && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        router.push(`/c/${notionResultId}`);
                        router.refresh();
                      }}
                    >
                      取り込んだスプレッドシートを開く
                    </Button>
                  )}
                </div>
              )}

              {notionBusy && (
                <p className="mb-3 text-xs text-ink-muted">
                  Notionから取り込み中は、ファイルとGoogle スプレッドシートの読み込みを一時的に停止しています。
                </p>
              )}

              {notionNotConnected ? (
                // 接続前でも「共有し直したので読み直したい」が必ず起きる。
                // 再読み込みの導線がないと画面ごとリロードするしかなかった。
                <div className="space-y-2">
                  <p className="text-sm text-ink-muted">
                    <a
                      href="/settings"
                      className="text-khaki-700 underline underline-offset-2 hover:text-khaki-800"
                    >
                      Notionを接続してください
                    </a>
                    （設定画面でインテグレーション トークンを登録します）
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => void loadNotionDatabases()}
                    disabled={notionLoading}
                  >
                    {notionLoading ? "読み込み中…" : "再読み込み"}
                  </Button>
                </div>
              ) : notionDbs === null ? (
                <Button
                  variant="secondary"
                  onClick={() => void loadNotionDatabases()}
                  disabled={notionLoading}
                >
                  {notionLoading ? "読み込み中…" : "データベースを読み込む"}
                </Button>
              ) : notionDbs.length === 0 ? (
                // 共有し直した直後に押せるボタンがないと、案内どおり操作しても
                // 画面をリロードするまで反映されない。
                <div className="space-y-2">
                  <p className="text-sm text-ink-muted">
                    表示できるデータベースがありません。Notionでページを開き、「…」→「接続」からインテグレーションに共有してください。
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => void loadNotionDatabases()}
                    disabled={notionLoading}
                  >
                    {notionLoading ? "読み込み中…" : "再読み込み"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="notion-db">データベース</Label>
                    <Select
                      id="notion-db"
                      value={notionDbId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setNotionDbId(id);
                        const hit = notionDbs.find((d) => d.id === id);
                        setNotionName(hit ? hit.title : "");
                      }}
                      disabled={notionImporting}
                    >
                      {notionDbs.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.title}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="notion-name">スプレッドシート名</Label>
                    <Input
                      id="notion-name"
                      value={notionName}
                      onChange={(e) => setNotionName(e.target.value)}
                      placeholder="スプレッドシート名を入力"
                      disabled={notionImporting}
                    />
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {otherSourceBusy && (
                      <p className="text-xs text-ink-muted">
                        他のファイルを読み込み中です。完了までNotionからの取り込みはお待ちください。
                      </p>
                    )}
                    <Button
                      onClick={() => void runNotionImport()}
                      // ファイル/Google Sheetsの解析中に押されると、先に終わった
                      // こちらのrouter.pushが解析結果を消してしまう。打ち切り後の
                      // 同一データベースは重複シートを作るだけなので同様に塞ぐ。
                      disabled={
                        notionImporting ||
                        !notionDbId ||
                        otherSourceBusy ||
                        notionRerunBlocked
                      }
                    >
                      <NavIcon name="download" className="h-4 w-4" />
                      {notionImporting ? "取り込み中…" : "取り込む"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {step === "map" && sheets && (
        <>
          {importWarning && (
            <div
              role="status"
              className="rounded border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning"
            >
              <p className="font-medium">取り込みは完了しましたが、確認が必要です。</p>
              {/* 打ち切りと未変換セルは改行区切りで届く。 */}
              <p className="mt-1 whitespace-pre-line">{importWarning}</p>
              {importDest && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    router.push(importDest);
                    router.refresh();
                  }}
                >
                  取り込んだスプレッドシートを開く
                </Button>
              )}
            </div>
          )}

          {sheets.length > 1 && (
            <div className="flex items-center gap-2 rounded-md border border-ink-line bg-paper-raised px-4 py-2.5 text-sm text-ink-muted">
              <Badge tone="khaki" variant="soft">{sheets.length} シート検出</Badge>
              取り込むシートを選び、それぞれの名前と列の型を確認してください。各シートは別々のスプレッドシートになります。
            </div>
          )}

          {/*
            同名ファイルがある場合の選択。
            見せ方も文言も src/components/home/ImportReview.tsx に合わせてある。
            同じ判断を入口ごとに違う言い方で聞かれると、別のことを聞かれている
            と読まれる。文言を直すときは import-mode.ts と両方そろえること。
          */}
          {existing && (
            <div className="space-y-3 rounded-md border border-ink-line bg-paper-raised p-4">
              <h3 className="text-sm font-semibold text-ink">
                同じ名前のファイルが既にあります
              </h3>
              <p className="text-sm text-ink-soft">
                「{existing.name}」（
                {existing.sheets.length.toLocaleString()} シート・
                {existing.sheets
                  .reduce((n, sh) => n + sh.rowCount, 0)
                  .toLocaleString()}
                行）
              </p>

              <div className="space-y-2">
                {IMPORT_MODE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-start gap-2.5 rounded px-2 py-1.5 transition-colors duration-fast hover:bg-paper-sunken"
                  >
                    <input
                      type="radio"
                      name="import-mode"
                      value={opt.value}
                      checked={mode === opt.value}
                      onChange={() => setMode(opt.value)}
                      disabled={importing}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-khaki-500"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">
                        {opt.label}
                      </span>
                      {/* 選んだ結果を1行で。このリポジトリは選択肢に必ず結果を書く。 */}
                      <span className="block text-xs text-ink-muted">
                        {opt.hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {mode === "replace" && (
                /* 何が消えるのかを、押す前に名前と行数で見せる。 */
                <ul className="space-y-0.5 border-t border-ink-line pt-2 text-xs text-ink-muted">
                  {existing.sheets.map((sh) => {
                    const willReplace = chosenSheets.some(
                      (c) =>
                        c.collectionName.trim() === sh.name ||
                        c.sheetName === sh.name,
                    );
                    return (
                      <li key={sh.slug}>
                        {sh.name}（{sh.rowCount.toLocaleString()}行）—{" "}
                        {willReplace ? "入れ替え" : "そのまま残ります"}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {sheets.map((sheet, si) => (
            <Card key={sheet.sheetName + si} className={cn(!sheet.selected && "opacity-60")}>
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={sheet.selected}
                    onChange={(e) => patchSheet(si, { selected: e.target.checked })}
                    className="h-4 w-4 rounded border-ink-line text-khaki-500 focus:ring-khaki-500/40"
                  />
                  <CardTitle>{sheet.sheetName || "（無題シート）"}</CardTitle>
                  <Badge tone="neutral" variant="soft">
                    <NavIcon name="table" className="h-3.5 w-3.5" />
                    {/* 打ち切られたシートで「50,000 行」とだけ出すと、それが
                        全部だと読めてしまう。読めた範囲であることを明示する。 */}
                    {sheet.warnings.length > 0 ? "先頭 " : ""}
                    {sheet.rowCount.toLocaleString()} 行
                  </Badge>
                </label>
                {sheet.warnings.length > 0 && (
                  // 取り込んだ後にしか知らせないと、選ぶ判断ができない。
                  <p role="status" className="w-full text-xs text-warning">
                    {sheet.warnings.join(" ")}
                  </p>
                )}
              </CardHeader>

              {sheet.selected && (
                <CardBody className="space-y-4">
                  <div className="max-w-sm">
                    <Label htmlFor={`name-${si}`}>スプレッドシート名</Label>
                    <Input
                      id={`name-${si}`}
                      value={sheet.collectionName}
                      onChange={(e) => patchSheet(si, { collectionName: e.target.value })}
                      placeholder="スプレッドシート名を入力"
                    />
                  </div>

                  <div>
                    <Label>列 → フィールド（{sheet.fields.length} 列）</Label>
                    <div className="overflow-x-auto rounded-md border border-ink-line">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-ink-line bg-paper-sunken text-left text-xs text-ink-muted">
                            <th className="px-3 py-2 font-medium">列名</th>
                            <th className="px-3 py-2 font-medium">フィールド型</th>
                            <th className="px-3 py-2 text-center font-medium">必須</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sheet.fields.map((f, fi) => (
                            <tr key={f.key} className="border-b border-ink-line last:border-0">
                              <td className="px-3 py-2 align-middle">
                                <Input
                                  value={f.name}
                                  onChange={(e) => patchField(si, fi, { name: e.target.value })}
                                  aria-label={`${f.sourceHeader} の列名`}
                                  aria-invalid={f.name.trim() ? undefined : true}
                                  className={cn(
                                    "h-8",
                                    !f.name.trim() && "border-danger focus:ring-danger/40",
                                  )}
                                />
                              </td>
                              <td className="px-3 py-2 align-middle">
                                <Select
                                  value={f.type}
                                  onChange={(e) => patchField(si, fi, { type: e.target.value as FieldType })}
                                  className="h-8"
                                >
                                  {FIELD_TYPES.map((t) => (
                                    <option key={t} value={t}>{FIELD_TYPE_META[t].label}</option>
                                  ))}
                                </Select>
                              </td>
                              <td className="px-3 py-2 text-center align-middle">
                                <input
                                  type="checkbox"
                                  checked={f.required}
                                  onChange={(e) => patchField(si, fi, { required: e.target.checked })}
                                  className="h-4 w-4 rounded border-ink-line text-khaki-500 focus:ring-khaki-500/40"
                                  aria-label={`${f.name} を必須にする`}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {sheet.fields.some((f) => !f.name.trim()) && (
                      // 空欄のまま取り込むと、以降の列が1つずつずれて入る。
                      // 元のバグはここに検証が無かったこと。
                      <p role="alert" className="mt-1.5 text-xs text-danger">
                        列名が空の列があります。空欄のままでは取り込めません。元の列名（
                        {sheet.fields
                          .filter((f) => !f.name.trim())
                          .map((f) => f.sourceHeader)
                          .join("、")}
                        ）を入力してください。
                      </p>
                    )}
                  </div>

                  {sheet.previewRows.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-ink-muted hover:text-ink-soft">
                        プレビュー（先頭 {sheet.previewRows.length} 行）
                      </summary>
                      <div className="mt-2 overflow-x-auto rounded-md border border-ink-line">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-ink-line bg-paper-sunken text-left text-xs text-ink-muted">
                              {sheet.headers.map((h) => (
                                <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sheet.previewRows.map((row, r) => (
                              <tr key={r} className="border-b border-ink-line last:border-0">
                                {sheet.headers.map((h) => (
                                  <td key={h} className="whitespace-nowrap px-3 py-2 text-ink-soft">
                                    {renderCell(row[h])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </CardBody>
              )}
            </Card>
          ))}

          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={reset} disabled={importing}>
              {source === "file" ? "別のファイルを選ぶ" : "別のソースを選ぶ"}
            </Button>
            <div className="flex flex-col items-end gap-1">
              {blankNameBlocked && (
                <p className="text-xs text-danger">
                  列名が空の列があるため取り込めません。
                </p>
              )}
              <Button
                onClick={runImport}
                // 列名が空だと列がずれて取り込まれる。警告付きで完了した後の
                // 再実行は、同じ内容のスプレッドシートを増やすだけ。
                disabled={
                  importing ||
                  selectedCount === 0 ||
                  blankNameBlocked ||
                  importDone
                }
              >
                <NavIcon name="download" className="h-4 w-4" />
                {importing
                  ? "取り込み中…"
                  : importDone
                    ? "取り込み済み"
                    : selectedCount > 1
                      ? `${selectedCount}件のシートを取り込む`
                      : "取り込む"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
