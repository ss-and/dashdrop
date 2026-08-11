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
  const [collections, workbooks, dashboards] = await Promise.all([
    db.collection.findMany({
      where: { workspaceId: user.workspace.id },
      orderBy: { position: "asc" },
      select: { id: true, name: true, icon: true, color: true, workbookId: true },
    }),
    db.workbook.findMany({
      where: { workspaceId: user.workspace.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    db.dashboard.findMany({
      where: { workspaceId: user.workspace.id },
      orderBy: { position: "asc" },
      select: { id: true, name: true, icon: true },
    }),
  ]);

  // Group sheets under their workbook (file); loose sheets have no workbook.
  const byWorkbook = new Map<string, typeof collections>();
  const loose: typeof collections = [];
  for (const c of collections) {
    if (c.workbookId) {
      const arr = byWorkbook.get(c.workbookId) ?? [];
      arr.push(c);
      byWorkbook.set(c.workbookId, arr);
    } else {
      loose.push(c);
    }
  }
  const fileGroups = workbooks
    .map((w) => ({ ...w, sheets: byWorkbook.get(w.id) ?? [] }))
    .filter((w) => w.sheets.length > 0);

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

        {/* File (workbook) groups: 📁ファイル名 ▸ をトグルで展開すると各シート */}
        {fileGroups.map((w) => (
          <details key={w.id} open className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-3 py-2 text-sm font-medium text-ink-soft hover:bg-paper-sunken hover:text-ink transition-colors">
              <NavIcon
                name="chevron"
                className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform group-open:rotate-90"
              />
              <NavIcon name="folder" className="h-4 w-4 shrink-0 text-khaki-500" />
              <Link
                href={`/f/${w.id}`}
                className="min-w-0 flex-1 truncate hover:text-khaki-700"
                title={w.name}
              >
                {w.name}
              </Link>
            </summary>
            <ul className="mb-1 ml-4 space-y-0.5 border-l border-ink-line pl-1">
              {w.sheets.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/c/${c.id}`}
                    className="flex items-center gap-2.5 rounded px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-sunken hover:text-ink transition-colors"
                  >
                    <CollectionIcon name={c.icon} className="h-4 w-4 text-khaki-500" />
                    <span className="truncate">{c.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ))}

        {/* Loose sheets (templates / manually created, no parent file) */}
        <ul className="space-y-0.5">
          {loose.map((c) => (
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
