"use client";

import {
  WIDGET_TYPES,
  WIDGET_META,
  type BuilderWidgetType,
} from "@/lib/widget-builder";
import { CollectionIcon } from "@/components/app/icons";

/**
 * Widget palette: the available widget types as draggable chips, grouped by
 * WIDGET_META.group (指標 / グラフ / 明細). Each chip supports drag-to-canvas
 * (native HTML5 DnD) and click-to-add as a keyboard-friendly fallback.
 */

const GROUP_ORDER: WidgetMetaGroup[] = ["指標", "グラフ", "明細"];
type WidgetMetaGroup = "指標" | "グラフ" | "明細";

export function WidgetPalette({
  disabled,
  onAdd,
  onDragStart,
  onDragEnd,
}: {
  /** No sheet selected yet — adding shows a hint and does nothing. */
  disabled: boolean;
  onAdd: (type: BuilderWidgetType) => void;
  onDragStart: (type: BuilderWidgetType) => void;
  onDragEnd: () => void;
}) {
  return (
    <div className="space-y-4">
      {GROUP_ORDER.map((group) => {
        const types = WIDGET_TYPES.filter(
          (t) => WIDGET_META[t].group === group,
        );
        if (types.length === 0) return null;
        return (
          <div key={group}>
            <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
              {group}
            </p>
            <div className="space-y-1.5">
              {types.map((type) => {
                const meta = WIDGET_META[type];
                return (
                  <button
                    key={type}
                    type="button"
                    draggable={!disabled}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "copy";
                      e.dataTransfer.setData("text/plain", `palette:${type}`);
                      onDragStart(type);
                    }}
                    onDragEnd={onDragEnd}
                    onClick={() => onAdd(type)}
                    className={
                      "flex w-full items-start gap-2.5 rounded-md border border-ink-line bg-paper-raised px-3 py-2 text-left transition-colors hover:bg-paper-sunken " +
                      (disabled ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing")
                    }
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-ink-line bg-paper-sunken text-khaki-600">
                      <CollectionIcon name={meta.icon} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">
                        {meta.label}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        {meta.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
