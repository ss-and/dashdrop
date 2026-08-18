import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * 表 / 分析 tab strip for one spreadsheet.
 *
 * Driven by the `?view=` search param rather than client state, so the page
 * stays a server component and a link to the analysis is shareable.
 */

export type SheetView = "table" | "analyze";

const TABS: Array<{ view: SheetView; label: string; hint: string }> = [
  { view: "table", label: "表", hint: "スプレッドシートを編集" },
  { view: "analyze", label: "分析", hint: "このシートのグラフを見る" },
];

export function SheetTabs({
  collectionId,
  active,
}: {
  collectionId: string;
  active: SheetView;
}) {
  return (
    <div className="border-b border-ink-line">
      <nav aria-label="シートの表示切り替え" className="-mb-px flex items-stretch gap-1">
        {TABS.map((tab) => {
          const isActive = tab.view === active;
          const href =
            tab.view === "analyze"
              ? `/c/${collectionId}?view=analyze`
              : `/c/${collectionId}`;
          return (
            <Link
              key={tab.view}
              href={href}
              scroll={false}
              title={tab.hint}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center border-b-2 px-4 py-2 text-sm",
                "transition-colors duration-fast active:transition-none",
                isActive
                  ? "border-khaki-500 font-medium text-ink"
                  : "border-transparent text-ink-soft hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
