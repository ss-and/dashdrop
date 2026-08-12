"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { NavIcon } from "@/components/app/icons";
import { cn } from "@/lib/utils";
import {
  newWidget,
  genWidgetId,
  canAddWidget,
  WIDGET_META,
  type BuilderWidgetType,
} from "@/lib/widget-builder";
import type { WidgetSpec, WidgetData } from "@/lib/widgets";
import { WidgetPalette } from "@/components/dashboard/builder/WidgetPalette";
import { WidgetConfig } from "@/components/dashboard/builder/WidgetConfig";
import { PreviewCard } from "@/components/dashboard/builder/PreviewCard";

/* --------------------------------- types -------------------------------- */

export interface BuilderCollection {
  id: string;
  name: string;
  slug: string;
  icon: string;
  workbookId: string | null;
  fields: { key: string; name: string; type: string }[];
}

interface DashboardBuilderProps {
  collections: BuilderCollection[];
  workbooks: { id: string; name: string }[];
  preselectSlugs?: string[];
  initial?: {
    id: string;
    name: string;
    description: string;
    collectionSlugs: string[];
    layout: WidgetSpec[];
  };
}

// Static span -> class map (Tailwind must see the literals; never interpolate).
const SPAN_CLASS: Record<number, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
};

type DragPayload =
  | { kind: "palette"; type: BuilderWidgetType }
  | { kind: "reorder"; id: string };

/* --------------------------------- icons -------------------------------- */

function GripIcon({ className }: { className?: string }) {
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
      <path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
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
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
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
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

/* ------------------------------- component ------------------------------ */

export function DashboardBuilder({
  collections,
  workbooks,
  preselectSlugs = [],
  initial,
}: DashboardBuilderProps) {
  const router = useRouter();

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>(
    initial?.collectionSlugs ?? preselectSlugs,
  );
  const [layout, setLayout] = useState<WidgetSpec[]>(initial?.layout ?? []);
  const [results, setResults] = useState<Record<string, WidgetData | null>>({});
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [canvasDragOver, setCanvasDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const dragRef = useRef<DragPayload | null>(null);
  const seqRef = useRef(0);

  // 主データ = first selected sheet in collection order (stable across toggles).
  const primarySheet =
    collections.find((c) => selectedSlugs.includes(c.slug)) ?? null;
  const primarySlug = primarySheet?.slug ?? null;
  const selectedSheets = collections.filter((c) =>
    selectedSlugs.includes(c.slug),
  );
  // How many distinct workbooks the selected sheets span — drives the
  // "cross-file aggregation" reassurance (only meaningful for ≥2 files).
  const selectedWorkbookCount = new Set(
    selectedSheets
      .map((c) => c.workbookId)
      .filter((id): id is string => id != null),
  ).size;
  const spansMultipleFiles = selectedWorkbookCount >= 2;

  /* ------------------------------ live preview ---------------------------- */

  useEffect(() => {
    const seq = ++seqRef.current;
    if (layout.length === 0) {
      setResults({});
      setFetching(false);
      return;
    }
    setFetching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/dashboards/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collectionSlugs: selectedSlugs, layout }),
        });
        const body = await res.json().catch(() => null);
        if (seq !== seqRef.current) return; // stale response — ignore
        if (body?.ok) {
          setResults(
            (body.data?.results as Record<string, WidgetData | null>) ?? {},
          );
        }
      } catch {
        /* keep the last good preview on transient failures */
      } finally {
        if (seq === seqRef.current) setFetching(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [layout, selectedSlugs]);

  /* ------------------------------ data source ----------------------------- */

  function toggleSlug(slug: string) {
    setSelectedSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  }

  /* -------------------------------- widgets ------------------------------- */

  function addWidget(type: BuilderWidgetType, atIndex?: number) {
    if (!primarySlug) return; // guarded by the palette hint
    const sheet = collections.find((c) => c.slug === primarySlug);
    const w = newWidget(type, primarySlug, sheet?.fields ?? []);
    setLayout((prev) => {
      if (atIndex == null || atIndex < 0 || atIndex >= prev.length) {
        return [...prev, w];
      }
      const arr = [...prev];
      arr.splice(atIndex, 0, w);
      return arr;
    });
  }

  function updateWidget(id: string, next: WidgetSpec) {
    setLayout((prev) => prev.map((w) => (w.id === id ? next : w)));
  }

  function duplicateWidget(id: string) {
    setLayout((prev) => {
      const i = prev.findIndex((w) => w.id === id);
      if (i < 0) return prev;
      const clone = { ...prev[i], id: genWidgetId() } as WidgetSpec;
      const arr = [...prev];
      arr.splice(i + 1, 0, clone);
      return arr;
    });
  }

  function removeWidget(id: string) {
    setLayout((prev) => prev.filter((w) => w.id !== id));
  }

  function setSpan(id: string, span: number) {
    setLayout((prev) =>
      prev.map((w) =>
        w.id === id ? ({ ...w, span: Math.min(4, Math.max(1, span)) } as WidgetSpec) : w,
      ),
    );
  }

  /* ---------------------------------- DnD --------------------------------- */

  function reorderBefore(fromId: string, targetId: string) {
    if (fromId === targetId) return;
    setLayout((prev) => {
      const arr = [...prev];
      const fromIdx = arr.findIndex((w) => w.id === fromId);
      if (fromIdx < 0) return prev;
      const [item] = arr.splice(fromIdx, 1);
      const toIdx = arr.findIndex((w) => w.id === targetId);
      arr.splice(toIdx < 0 ? arr.length : toIdx, 0, item);
      return arr;
    });
  }

  function onCardDrop(index: number) {
    const payload = dragRef.current;
    dragRef.current = null;
    setDragOverIndex(null);
    setCanvasDragOver(false);
    setIsDragging(false);
    if (!payload) return;
    if (payload.kind === "palette") {
      addWidget(payload.type, index);
    } else {
      const target = layout[index];
      if (target) reorderBefore(payload.id, target.id);
    }
  }

  function onCanvasDrop() {
    const payload = dragRef.current;
    dragRef.current = null;
    setDragOverIndex(null);
    setCanvasDragOver(false);
    setIsDragging(false);
    if (!payload) return;
    if (payload.kind === "palette") {
      addWidget(payload.type);
    } else {
      // Dropped past the last card — move to the end.
      const last = layout[layout.length - 1];
      if (last && last.id !== payload.id) {
        setLayout((prev) => {
          const arr = [...prev];
          const fromIdx = arr.findIndex((w) => w.id === payload.id);
          if (fromIdx < 0) return prev;
          const [item] = arr.splice(fromIdx, 1);
          arr.push(item);
          return arr;
        });
      }
    }
  }

  /* --------------------------------- save --------------------------------- */

  const canSave = name.trim().length > 0 && layout.length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const url = initial ? `/api/dashboards/${initial.id}` : "/api/dashboards";
      const method = initial ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          collectionSlugs: selectedSlugs,
          layout,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "保存に失敗しました");
        return;
      }
      router.push("/d/" + body.data.dashboardId);
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setSaving(false);
    }
  }

  /* ------------------------------ data groups ----------------------------- */

  const groups = workbooks
    .map((wb) => ({
      wb,
      sheets: collections.filter((c) => c.workbookId === wb.id),
    }))
    .filter((g) => g.sheets.length > 0);
  const looseSheets = collections.filter((c) => !c.workbookId);

  /* --------------------------------- view --------------------------------- */

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ダッシュボード名（必須）"
              className="text-base font-semibold"
              aria-label="ダッシュボード名"
            />
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="サブタイトル（任意）"
              className="text-sm"
              aria-label="サブタイトル"
            />
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboards"
              className="inline-flex h-10 items-center rounded border border-ink-line bg-paper-raised px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-sunken"
            >
              キャンセル
            </Link>
            <Button onClick={save} disabled={!canSave}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
        {error && (
          <div
            role="alert"
            className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {error}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* Left rail */}
        <aside className="shrink-0 space-y-5 lg:w-72">
          {/* Data source */}
          <Card>
            <div className="border-b border-ink-line px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink">データ元</p>
                {selectedSheets.length > 0 && (
                  <span className="shrink-0 text-2xs font-medium text-khaki-600">
                    {selectedSheets.length} シートを使用中
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-muted">
                使用するスプレッドシートを選びます
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                複数のファイル・シートをまたいで選べます
              </p>
              {spansMultipleFiles && (
                <p className="mt-1.5 inline-flex rounded bg-khaki-50 px-1.5 py-0.5 text-2xs font-medium text-khaki-600">
                  ファイルをまたいだ集計に対応しています
                </p>
              )}
            </div>
            <CardBody className="max-h-72 space-y-3 overflow-y-auto py-3">
              {collections.length === 0 && (
                <p className="text-xs text-ink-muted">
                  スプレッドシートがありません。先にデータを取り込んでください。
                </p>
              )}
              {groups.map((g) => (
                <div key={g.wb.id}>
                  <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                    <NavIcon name="folder" className="h-3.5 w-3.5" />
                    <span className="truncate">{g.wb.name}</span>
                  </div>
                  <div className="space-y-0.5">
                    {g.sheets.map((c) => (
                      <SheetRow
                        key={c.slug}
                        collection={c}
                        checked={selectedSlugs.includes(c.slug)}
                        isPrimary={c.slug === primarySlug}
                        onToggle={() => toggleSlug(c.slug)}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {looseSheets.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                    <NavIcon name="folder" className="h-3.5 w-3.5" />
                    <span>その他</span>
                  </div>
                  <div className="space-y-0.5">
                    {looseSheets.map((c) => (
                      <SheetRow
                        key={c.slug}
                        collection={c}
                        checked={selectedSlugs.includes(c.slug)}
                        isPrimary={c.slug === primarySlug}
                        onToggle={() => toggleSlug(c.slug)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Widget palette */}
          <Card>
            <div className="border-b border-ink-line px-4 py-2.5">
              <p className="text-sm font-semibold text-ink">ウィジェット</p>
              <p className="text-xs text-ink-muted">
                ドラッグかクリックで追加します
              </p>
            </div>
            <CardBody className="py-3">
              <WidgetPalette
                disabled={!primarySlug}
                canAdd={(type) => canAddWidget(type, primarySheet?.fields ?? [])}
                onAdd={(type) => addWidget(type)}
                onDragStart={(type) => {
                  dragRef.current = { kind: "palette", type };
                  setIsDragging(true);
                }}
                onDragEnd={() => {
                  dragRef.current = null;
                  setDragOverIndex(null);
                  setCanvasDragOver(false);
                  setIsDragging(false);
                }}
              />
              {!primarySlug && (
                <p className="mt-3 rounded border border-warning/20 bg-warning-soft px-2.5 py-2 text-xs text-warning">
                  先にデータ元を選んでください
                </p>
              )}
            </CardBody>
          </Card>
        </aside>

        {/* Canvas */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-ink-muted">
              {layout.length > 0
                ? `${layout.length} 個のウィジェット`
                : "キャンバス"}
            </p>
            {fetching && (
              <span className="text-xs text-ink-faint">更新中…</span>
            )}
          </div>

          {layout.length === 0 ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setCanvasDragOver(true);
              }}
              onDragLeave={() => setCanvasDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                onCanvasDrop();
              }}
              className={cn(
                "flex min-h-[16rem] flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-12 text-center transition-colors",
                canvasDragOver
                  ? "border-khaki-500 bg-khaki-50"
                  : "border-ink-line bg-paper-sunken",
              )}
            >
              <p className="text-sm font-medium text-ink">
                ここにウィジェットをドラッグ、または左から選択
              </p>
              <p className="text-xs text-ink-muted">
                データ元を選んでから追加してください
              </p>
            </div>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setCanvasDragOver(true);
              }}
              onDrop={(e) => {
                e.preventDefault();
                onCanvasDrop();
              }}
              className={cn(
                "grid grid-cols-1 gap-4 rounded-md sm:grid-cols-2 lg:grid-cols-4",
                canvasDragOver && "ring-1 ring-khaki-300",
              )}
            >
              {layout.map((widget, index) => {
                const span = Math.min(4, Math.max(1, widget.span ?? 1));
                const meta = WIDGET_META[widget.type as BuilderWidgetType];
                const sheetSelected = selectedSlugs.includes(widget.collection);
                return (
                  <Card
                    key={widget.id}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverIndex(index);
                    }}
                    onDragLeave={() => setDragOverIndex((i) => (i === index ? null : i))}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onCardDrop(index);
                    }}
                    className={cn(
                      "relative flex flex-col",
                      SPAN_CLASS[span],
                      isDragging &&
                        dragOverIndex === index &&
                        "ring-1 ring-khaki-300 bg-paper-sunken",
                    )}
                  >
                    {/* Insertion guide — "この位置（このカードの前）に挿入" */}
                    {isDragging && dragOverIndex === index && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 -left-2 z-10 w-0.5 rounded bg-khaki-500"
                      />
                    )}
                    {/* Toolbar */}
                    <div className="flex items-center gap-1.5 border-b border-ink-line px-2.5 py-1.5">
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData(
                            "text/plain",
                            `reorder:${widget.id}`,
                          );
                          dragRef.current = { kind: "reorder", id: widget.id };
                          setIsDragging(true);
                        }}
                        onDragEnd={() => {
                          dragRef.current = null;
                          setDragOverIndex(null);
                          setCanvasDragOver(false);
                          setIsDragging(false);
                        }}
                        className="flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded text-ink-faint hover:bg-paper-sunken hover:text-ink-soft active:cursor-grabbing"
                        aria-label="ドラッグして並び替え"
                        title="ドラッグして並び替え"
                      >
                        <GripIcon />
                      </button>
                      <span className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                        {meta?.label ?? widget.type}
                      </span>
                      {/* Span controls */}
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => setSpan(widget.id, span - 1)}
                          disabled={span <= 1}
                          className="flex h-6 w-6 items-center justify-center rounded text-ink-soft hover:bg-paper-sunken disabled:opacity-30"
                          aria-label="幅を狭める"
                        >
                          −
                        </button>
                        <span className="w-4 text-center text-2xs tabular-nums text-ink-muted">
                          {span}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSpan(widget.id, span + 1)}
                          disabled={span >= 4}
                          className="flex h-6 w-6 items-center justify-center rounded text-ink-soft hover:bg-paper-sunken disabled:opacity-30"
                          aria-label="幅を広げる"
                        >
                          ＋
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => duplicateWidget(widget.id)}
                        className="flex h-6 w-6 items-center justify-center rounded text-ink-soft hover:bg-paper-sunken"
                        aria-label="複製"
                        title="複製"
                      >
                        <CopyIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeWidget(widget.id)}
                        className="flex h-6 w-6 items-center justify-center rounded text-ink-soft hover:bg-danger-soft hover:text-danger"
                        aria-label="削除"
                        title="削除"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <CardBody className="flex-1 space-y-3 py-3">
                      <p className="truncate text-sm font-medium text-ink">
                        {widget.title}
                      </p>
                      <PreviewCard
                        widget={widget}
                        data={results[widget.id]}
                        sheetSelected={sheetSelected}
                      />
                      <WidgetConfig
                        widget={widget}
                        sheets={selectedSheets}
                        onChange={(next) => updateWidget(widget.id, next)}
                      />
                    </CardBody>
                  </Card>
                );
              })}
              {/* Append guide — shown while dragging over empty grid area
                  (not over a specific card): "追加は末尾". */}
              {isDragging && canvasDragOver && dragOverIndex === null && (
                <div
                  aria-hidden="true"
                  className="flex min-h-[6rem] items-center justify-center rounded-md border-2 border-dashed border-khaki-500 bg-khaki-50 text-2xs font-semibold text-khaki-600 lg:col-span-1"
                >
                  末尾に追加
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- sub-parts ------------------------------ */

function SheetRow({
  collection,
  checked,
  isPrimary,
  onToggle,
}: {
  collection: BuilderCollection;
  checked: boolean;
  isPrimary: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-paper-sunken">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-4 w-4 rounded border-ink-line text-khaki-500 focus:ring-khaki-500/40"
      />
      <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
        {collection.name}
      </span>
      {isPrimary && <Badge tone="khaki" variant="soft">主データ</Badge>}
    </label>
  );
}
