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
}
interface EditableField {
  name: string;
  key: string;
  type: FieldType;
  required: boolean;
}
interface SheetState {
  sheetName: string;
  headers: string[];
  rowCount: number;
  previewRows: Record<string, unknown>[];
  fields: EditableField[];
  collectionName: string;
  selected: boolean;
}

const ALLOWED = ".xlsx,.xls,.csv";

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

  // Import source: a local file, or a public/link-shared Google Sheets URL.
  const [source, setSource] = useState<"file" | "gsheets">("file");
  const [gsheetsUrl, setGsheetsUrl] = useState("");
  const [gsheetsLoading, setGsheetsLoading] = useState(false);

  const step: "upload" | "map" = sheets ? "map" : "upload";
  const selectedCount = sheets?.filter((s) => s.selected).length ?? 0;

  function reset() {
    setFile(null);
    setSheets(null);
    setError(null);
    setSource("file");
    setGsheetsUrl("");
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
        selected: true,
        fields: s.inferredFields.map((f) => ({
          name: f.name,
          key: f.key,
          type: f.type,
          required: false,
        })),
      })),
    );
  }

  async function handleFile(picked: File) {
    setError(null);
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
      const data = body.data as { sheets: SheetPreview[] };
      setSource("file");
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
      ingestSheets(data.sheets);
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setGsheetsLoading(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (picked) void handleFile(picked);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
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
        res = await fetch("/api/import", { method: "POST", body: form });
      }
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "取り込みに失敗しました");
        return;
      }
      router.push(`/c/${body.data.collectionId}`);
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
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
                dragging ? "border-khaki-500 bg-khaki-50" : "border-ink-line bg-paper-sunken hover:bg-khaki-50/60",
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
                  <p className="text-xs text-ink-muted">またはクリックして選択（.xlsx / .xls / .csv、15MBまで）</p>
                </>
              )}
              <input ref={inputRef} type="file" accept={ALLOWED} className="hidden" onChange={onPick} />
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
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleGsheets(); } }}
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  className="flex-1"
                  inputMode="url"
                  disabled={gsheetsLoading}
                />
                <Button
                  variant="secondary"
                  onClick={() => void handleGsheets()}
                  disabled={gsheetsLoading || !gsheetsUrl.trim()}
                >
                  {gsheetsLoading ? "読み込み中…" : "読み込む"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                共有設定を『リンクを知っている全員（閲覧者）』にしてください。
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {step === "map" && sheets && (
        <>
          {sheets.length > 1 && (
            <div className="flex items-center gap-2 rounded-md border border-ink-line bg-paper-raised px-4 py-2.5 text-sm text-ink-muted">
              <Badge tone="khaki">{sheets.length} シート検出</Badge>
              取り込むシートを選び、それぞれの名前と列の型を確認してください。各シートは別々のスプレッドシートになります。
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
                  <Badge tone="neutral">
                    <NavIcon name="table" className="h-3.5 w-3.5" />
                    {sheet.rowCount.toLocaleString()} 行
                  </Badge>
                </label>
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
                                  className="h-8"
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
              {source === "gsheets" ? "別のソースを選ぶ" : "別のファイルを選ぶ"}
            </Button>
            <Button onClick={runImport} disabled={importing || selectedCount === 0}>
              <NavIcon name="download" className="h-4 w-4" />
              {importing
                ? "取り込み中…"
                : selectedCount > 1
                  ? `${selectedCount}件のシートを取り込む`
                  : "取り込む"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
