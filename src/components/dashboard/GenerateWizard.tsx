"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Textarea, Label } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { NavIcon } from "@/components/app/icons";
import { cn } from "@/lib/utils";

const ALLOWED = ".png,.jpg,.jpeg,.webp,.pdf";
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB
const IMAGE_EXT = ["png", "jpg", "jpeg", "webp"];

type Via = "anthropic" | "openai" | "heuristic";

const VIA_LABEL: Record<Via, string> = {
  anthropic: "AIが画像・内容から生成しました",
  openai: "AIが画像・内容から生成しました",
  heuristic: "入力内容に最も近いテンプレートから作成しました",
};

function extOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Uploader + description form that POSTs to /api/dashboards/generate and
 * navigates to the new dashboard on success. Works with or without an AI key —
 * when `aiConfigured` is false, the server falls back to the closest template.
 */
export function GenerateWizard({ aiConfigured }: { aiConfigured: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Revoke object URLs to avoid leaks.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function acceptFile(picked: File): void {
    setError(null);
    const ext = extOf(picked.name);
    const isPdf = ext === "pdf" || picked.type === "application/pdf";
    const isImage = IMAGE_EXT.includes(ext) || picked.type.startsWith("image/");
    if (!isPdf && !isImage) {
      setError("対応形式は .png / .jpg / .jpeg / .webp / .pdf です");
      return;
    }
    if (picked.size > MAX_FILE_BYTES) {
      setError("ファイルサイズが大きすぎます（最大8MB）");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(picked);
    setPreviewUrl(isImage && !isPdf ? URL.createObjectURL(picked) : null);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>): void {
    const picked = e.target.files?.[0];
    if (picked) acceptFile(picked);
  }

  function onDrop(e: React.DragEvent): void {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) acceptFile(dropped);
  }

  function clearFile(): void {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const canSubmit = Boolean(file) || description.trim().length > 0;

  async function submit(): Promise<void> {
    if (!canSubmit || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      if (description.trim()) form.append("description", description.trim());
      if (file) form.append("file", file);

      const res = await fetch("/api/dashboards/generate", {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "生成に失敗しました。もう一度お試しください。");
        return;
      }
      const via = body.data.via as Via | undefined;
      // Best-effort, non-blocking feedback on how it was produced.
      if (via && typeof window !== "undefined") {
        try {
          window.sessionStorage.setItem(
            "dashdrop:lastGenerateVia",
            VIA_LABEL[via],
          );
        } catch {
          /* ignore storage errors */
        }
      }
      router.push(`/d/${body.data.dashboardId}`);
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setSubmitting(false);
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

      {!aiConfigured && (
        <div className="flex items-start gap-3 rounded-md border border-info/20 bg-info-soft px-4 py-3">
          <span className="mt-0.5 shrink-0 text-info">
            <NavIcon name="sparkles" className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <Badge tone="info" variant="soft">AI連携キー未設定</Badge>
            <p className="text-sm text-ink-soft">
              AI連携キーが未設定のため、入力内容に最も近いテンプレートから作成します。
              <span className="text-ink-muted">
                （.env に ANTHROPIC_API_KEY を設定すると画像/PDFから自動生成します）
              </span>
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>画像・PDFからダッシュボードを作成</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <p className="text-sm text-ink-muted">
            作りたいダッシュボードのスクリーンショットやPDFをアップロードするか、
            イメージを説明してください。サンプルデータ付きのダッシュボードを自動で作成します。
          </p>

          {/* Uploader */}
          {file ? (
            <div className="flex items-center gap-4 rounded-md border border-ink-line bg-paper-sunken p-3">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="アップロード画像のプレビュー"
                  className="h-20 w-20 shrink-0 rounded border border-ink-line object-cover"
                />
              ) : (
                <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded border border-ink-line bg-paper text-khaki-700">
                  <NavIcon name="table" className="h-8 w-8" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {file.name}
                </p>
                <p className="text-xs text-ink-muted">
                  {(file.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFile}
                disabled={submitting}
              >
                削除
              </Button>
            </div>
          ) : (
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
                if (e.key === "Enter" || e.key === " ")
                  inputRef.current?.click();
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
                dragging
                  ? "border-khaki-500 bg-khaki-50"
                  : "border-ink-line bg-paper-sunken hover:bg-khaki-50/60",
              )}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-khaki-100 text-khaki-700">
                <NavIcon name="upload" className="h-6 w-6" />
              </span>
              <p className="text-sm font-medium text-ink">
                画像・PDFをドラッグ＆ドロップ
              </p>
              <p className="text-xs text-ink-muted">
                またはクリックして選択（.png / .jpg / .jpeg / .webp / .pdf、8MBまで）
              </p>
              <input
                ref={inputRef}
                type="file"
                accept={ALLOWED}
                className="hidden"
                onChange={onPick}
              />
            </div>
          )}

          {/* Description */}
          <div>
            <Label htmlFor="description">
              作りたいダッシュボードの説明（任意）
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="作りたいダッシュボードのイメージや指標を書いてください（例: 月次の売上と粗利、チャネル別の新規顧客）"
            />
            <p className="mt-1 text-xs text-ink-muted">
              画像・PDFと説明のどちらか一方だけでも作成できます。
            </p>
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center justify-end">
        <Button onClick={submit} disabled={!canSubmit || submitting}>
          <NavIcon name="sparkles" className="h-4 w-4" />
          {submitting ? "生成中…" : "生成する"}
        </Button>
      </div>
    </div>
  );
}
