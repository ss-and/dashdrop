"use client";

import { PALETTES } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * 配色テーマの選択。取り込みのポップアップと、ビルダーの両方で使う。
 *
 * 名前だけの一覧（プルダウン）にしないのは、テーマの違いが**色でしか
 * 表せない**から。「藍」と「若竹」を文字で読んで想像するより、4本の帯を
 * 見るほうが速いし、間違えない。
 */
export function ThemeSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {PALETTES.map((p) => {
        const selected = value === p.key;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            aria-pressed={selected}
            title={p.note}
            className={cn(
              "flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-all duration-fast",
              "active:scale-[0.97] focus:outline-none focus-visible:shadow-focus",
              selected
                ? "border-khaki-500 bg-khaki-50"
                : "border-ink-line hover:border-khaki-300 hover:bg-paper-sunken",
            )}
          >
            <span className="flex gap-0.5" aria-hidden>
              {p.series.slice(0, 4).map((c) => (
                <span
                  key={c}
                  className="h-4 w-1.5 rounded-sm"
                  style={{ backgroundColor: c }}
                />
              ))}
            </span>
            <span
              className={cn(
                "text-xs",
                selected ? "font-medium text-ink" : "text-ink-soft",
              )}
            >
              {p.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
