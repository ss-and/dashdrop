/**
 * The home page's tab strip: 「サマリー」 followed by every saved dashboard in the
 * workspace. Tabs are real hyperlinks (`/home?tab=<id>`), so the selected tab is
 * shareable, bookmarkable, and works without JavaScript — the page stays a
 * server component and only the selected dashboard is computed.
 */
import Link from "next/link";
import { NavIcon } from "@/components/app/icons";

export interface HomeTab {
  id: string;
  name: string;
  icon?: string;
}

export function HomeTabs({
  tabs,
  active,
}: {
  /** Dashboard tabs, in display order. サマリー is prepended here. */
  tabs: HomeTab[];
  /** "summary" or a dashboard id. */
  active: string;
}) {
  const items: HomeTab[] = [
    { id: "summary", name: "サマリー", icon: "users" },
    ...tabs,
  ];

  return (
    <div className="border-b border-ink-line">
      <nav
        aria-label="ダッシュボード"
        className="-mb-px flex items-center gap-1 overflow-x-auto"
      >
        {items.map((t) => {
          const isActive = t.id === active;
          return (
            <Link
              key={t.id}
              href={t.id === "summary" ? "/home" : `/home?tab=${t.id}`}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "border-khaki-500 font-semibold text-khaki-800"
                  : "border-transparent font-medium text-ink-muted hover:border-ink-line hover:text-ink"
              }`}
            >
              <NavIcon
                name={t.icon ?? "dashboard"}
                className={`h-3.5 w-3.5 ${
                  isActive ? "text-khaki-600" : "text-ink-faint"
                }`}
              />
              <span className="max-w-[14rem] truncate">{t.name}</span>
            </Link>
          );
        })}

        <Link
          href="/dashboards"
          className="inline-flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-ink-faint transition-colors hover:text-khaki-700"
        >
          <NavIcon name="plus" className="h-3.5 w-3.5" />
          ダッシュボードを追加
        </Link>
      </nav>
    </div>
  );
}
