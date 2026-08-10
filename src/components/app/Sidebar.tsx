import Link from "next/link";
import { db } from "@/lib/db";
import { Logo } from "@/components/ui/Logo";
import type { CurrentUser } from "@/lib/auth";
import { CollectionIcon, NavIcon } from "./icons";

/**
 * Left navigation. Server component: reads the workspace's collections directly
 * so it never depends on a client fetch. Shared by every /(app) page.
 */
export async function Sidebar({ user }: { user: CurrentUser }) {
  const [collections, dashboards] = await Promise.all([
    db.collection.findMany({
      where: { workspaceId: user.workspace.id },
      orderBy: { position: "asc" },
      select: { id: true, name: true, icon: true, color: true },
    }),
    db.dashboard.findMany({
      where: { workspaceId: user.workspace.id },
      orderBy: { position: "asc" },
      select: { id: true, name: true, icon: true },
    }),
  ]);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-ink-line bg-paper-raised">
      <div className="flex h-14 items-center px-4 border-b border-ink-line">
        <Link href="/dashboard" aria-label="DashDrop ダッシュボード">
          <Logo />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <NavLink href="/dashboard" icon="dashboard" label="サマリー" />
        <NavLink href="/import" icon="upload" label="Excel取り込み" />
        <NavLink href="/alerts" icon="bell" label="アラート" />
        <NavLink href="/reports" icon="report" label="レポート" />

        <div className="flex items-center justify-between px-3 pt-5 pb-1.5">
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
            ダッシュボード
          </p>
          <Link
            href="/dashboards"
            className="text-2xs font-medium text-khaki-600 hover:text-khaki-700"
          >
            ギャラリー
          </Link>
        </div>
        <ul className="space-y-0.5">
          {dashboards.map((d) => (
            <li key={d.id}>
              <Link
                href={`/d/${d.id}`}
                className="flex items-center gap-2.5 rounded px-3 py-2 text-sm text-ink-soft hover:bg-paper-sunken hover:text-ink transition-colors"
              >
                <CollectionIcon name={d.icon} className="h-4 w-4 text-khaki-500" />
                <span className="truncate">{d.name}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/dashboards"
              className="flex items-center gap-2 rounded px-3 py-2 text-sm font-medium text-khaki-600 hover:text-khaki-700"
            >
              <NavIcon name="plus" className="h-4 w-4" />
              ダッシュボードを追加
            </Link>
          </li>
        </ul>

        <p className="px-3 pt-5 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
          スプレッドシート
        </p>
        <ul className="space-y-0.5">
          {collections.map((c) => (
            <li key={c.id}>
              <Link
                href={`/c/${c.id}`}
                className="flex items-center gap-2.5 rounded px-3 py-2 text-sm text-ink-soft hover:bg-paper-sunken hover:text-ink transition-colors"
              >
                <CollectionIcon name={c.icon} className="h-4 w-4 text-khaki-500" />
                <span className="truncate">{c.name}</span>
              </Link>
            </li>
          ))}
          {collections.length === 0 && (
            <li className="px-3 py-2 text-xs text-ink-faint">
              まだスプレッドシートがありません
            </li>
          )}
        </ul>

        <div className="px-2 pt-3">
          <Link
            href="/c/new"
            className="flex items-center gap-2 rounded px-1 py-1.5 text-sm font-medium text-khaki-600 hover:text-khaki-700"
          >
            <NavIcon name="plus" className="h-4 w-4" />
            スプレッドシートを追加
          </Link>
        </div>
      </nav>

      <div className="border-t border-ink-line p-2">
        <NavLink href="/settings" icon="settings" label="設定" />
        <NavLink href="/pricing" icon="sparkles" label="プラン" />
      </div>
    </aside>
  );
}

function NavLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded px-3 py-2 text-sm font-medium text-ink-soft hover:bg-paper-sunken hover:text-ink transition-colors"
    >
      <NavIcon name={icon} className="h-4 w-4 text-ink-muted" />
      {label}
    </Link>
  );
}
