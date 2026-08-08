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

interface PreviewData {
  sheetName: string;
  headers: string[];
  inferredFields: InferredField[];
  rowCount: number;
  previewRows: Record<string, unknown>[];
}

interface EditableField {
  name: string;
  key: string;
  type: FieldType;
  required: boolean;
}

const ALLOWED = ".xlsx,.xls,.csv";

/** Render an arbitrary cell value for the small preview table. */
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
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [fields, setFields] = useState<EditableField[]>([]);
  const [collectionName, setCollectionName] = useState("");

  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step: "upload" | "map" = preview ? "map" : "upload";

  function reset() {
    setFile(null);
    setPreview(null);
    setFields([]);
    setCollectionName("");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(picked: File) {
    setError(null);
    setLoading(true);
    setFile(picked);
    try {
      const form = new FormData();
      form.append("file", picked);
      const res = await fetch("/api/import/preview", {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "ファイルの解析に失敗しました");
        setFile(null);
        return;
      }
      const data = body.data as PreviewData;
      setPreview(data);
      setFields(
        data.inferredFields.map((f) => ({
          name: f.name,
          key: f.key,
          type: f.type,
          required: false,
        })),
      );
      setCollectionName(data.sheetName || "インポート");
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
      setFile(null);
    } finally {
      setLoading(false);
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

  function updateField(index: number, patch: Partial<EditableField>) {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );
  }

  async function runImport() {
    if (!file) return;
    setError(null);
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("collectionName", collectionName.trim() || preview!.sheetName);
      form.append("fields", JSON.stringify(fields));
      const res = await fetch("/api/import", { method: "POST", body: form });
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
        <div
          role="alert"
          className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
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
              Excel/CSVをアップロードすると、列を自動でフィールド化してテーブルを作成します。
            </p>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
                dragging
                  ? "border-khaki-500 bg-khaki-50"
                  : "border-ink-line bg-paper-sunken hover:bg-khaki-50/60",
              )}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-khaki-100 text-khaki-700">
                <NavIcon name="upload" className="h-6 w-6" />
              </span>
              {loading ? (
                <p className="text-sm font-medium text-ink">解析中…</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-ink">
                    ファイルをドラッグ＆ドロップ
                  </p>
                  <p className="text-xs text-ink-muted">
                    またはクリックして選択（.xlsx / .xls / .csv、5MBまで）
                  </p>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept={ALLOWED}
                className="hidden"
                onChange={onPick}
              />
            </div>
          </CardBody>
        </Card>
      )}

      {step === "map" && preview && (
        <>
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>取り込み内容の確認</CardTitle>
              <Badge tone="khaki">
                <NavIcon name="table" className="h-3.5 w-3.5" />
                {preview.rowCount.toLocaleString()} 行を検出
              </Badge>
            </CardHeader>
            <CardBody className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="tableName">テーブル名</Label>
                  <Input
                    id="tableName"
                    value={collectionName}
                    onChange={(e) => setCollectionName(e.target.value)}
                    placeholder="テーブル名を入力"
                  />
                </div>
                <div>
                  <Label htmlFor="sheetInfo">シート</Label>
                  <Input
                    id="sheetInfo"
                    value={preview.sheetName || "（無題）"}
                    readOnly
                    className="bg-paper-sunken text-ink-muted"
                  />
                </div>
              </div>

              <div>
                <Label>列 → フィールド（{fields.length} 列）</Label>
                <div className="overflow-x-auto rounded-md border border-ink-line">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ink-line bg-paper-sunken text-left text-xs text-ink-muted">
                        <th className="px-3 py-2 font-medium">列名</th>
                        <th className="px-3 py-2 font-medium">フィールド型</th>
                        <th className="px-3 py-2 font-medium text-center">必須</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((f, i) => (
                        <tr
                          key={f.key}
                          className="border-b border-ink-line last:border-0"
                        >
                          <td className="px-3 py-2 align-middle">
                            <Input
                              value={f.name}
                              onChange={(e) =>
                                updateField(i, { name: e.target.value })
                              }
                              className="h-8"
                            />
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <Select
                              value={f.type}
                              onChange={(e) =>
                                updateField(i, {
                                  type: e.target.value as FieldType,
                                })
                              }
                              className="h-8"
                            >
                              {FIELD_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {FIELD_TYPE_META[t].label}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="px-3 py-2 text-center align-middle">
                            <input
                              type="checkbox"
                              checked={f.required}
                              onChange={(e) =>
                                updateField(i, { required: e.target.checked })
                              }
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

              {preview.previewRows.length > 0 && (
                <div>
                  <Label>プレビュー（先頭 {preview.previewRows.length} 行）</Label>
                  <div className="overflow-x-auto rounded-md border border-ink-line">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-ink-line bg-paper-sunken text-left text-xs text-ink-muted">
                          {preview.headers.map((h) => (
                            <th
                              key={h}
                              className="whitespace-nowrap px-3 py-2 font-medium"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.previewRows.map((row, r) => (
                          <tr
                            key={r}
                            className="border-b border-ink-line last:border-0"
                          >
                            {preview.headers.map((h) => (
                              <td
                                key={h}
                                className="whitespace-nowrap px-3 py-2 text-ink-soft"
                              >
                                {renderCell(row[h])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={reset} disabled={importing}>
              別のファイルを選ぶ
            </Button>
            <Button onClick={runImport} disabled={importing || fields.length === 0}>
              <NavIcon name="download" className="h-4 w-4" />
              {importing ? "取り込み中…" : "取り込む"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
