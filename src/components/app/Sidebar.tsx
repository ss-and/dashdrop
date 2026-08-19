import Link from "next/link";
import { db } from "@/lib/db";
import { Logo } from "@/components/ui/Logo";
import type { CurrentUser } from "@/lib/auth";
import { CRM_SLUGS } from "@/lib/crm-objects";
import { HR_SLUGS } from "@/lib/hr-objects";
import { CollectionIcon, NavIcon } from "./icons";
import { NavItem } from "./NavItem";
import { CreateCrmButton } from "./CreateCrmButton";
import { CreateHrButton } from "./CreateHrButton";

/**
 * Left navigation. Server component: reads the workspace's collections directly
 * so it never depends on a client fetch. Shared by every /(app) page.
 *
 * Shape: ホーム → スプレッドシート（ファイル＞シートの入れ子）→ ダッシュボード、
 * 最下段に顧客データベースと人事データベース、その下に 設定 / プラン。
 * Top-level links are deliberately kept to a
 * single item so the sidebar reads as a few calm groups instead of a long list;
 * secondary destinations (取り込み / ギャラリー) live in their section header.
 */
export async function Sidebar({ user }: { user: CurrentUser }) {
  const [collections, workbooks, dashboards] = await Promise.all([
    db.collection.findMany({
      where: { workspaceId: user.workspace.id },
      orderBy: { position: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        icon: true,
        color: true,
        workbookId: true,
        _count: { select: { records: true } },
      },
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

  // 顧客データベースのシートも、ファイルの中のシートも、同じスプレッドシート。
  // 並べる場所が違うだけなので、行の見た目は共通（SheetLink）。
  // Order follows CRM_SLUGS, whatever it holds.
  const crmOrder = new Map<string, number>(CRM_SLUGS.map((s, i) => [s, i]));
  const crmSheets = collections
    .filter((c) => crmOrder.has(c.slug))
    .sort((a, b) => (crmOrder.get(a.slug) ?? 0) - (crmOrder.get(b.slug) ?? 0));
  const hrOrder = new Map<string, number>(HR_SLUGS.map((s, i) => [s, i]));
  const hrSheets = collections
    .filter((c) => hrOrder.has(c.slug))
    .sort((a, b) => (hrOrder.get(a.slug) ?? 0) - (hrOrder.get(b.slug) ?? 0));

  const masterIds = new Set([...crmSheets, ...hrSheets].map((c) => c.id));
  const rest = collections.filter((c) => !masterIds.has(c.id));

  // Group sheets under their workbook (file); loose sheets have no workbook.
  const byWorkbook = new Map<string, typeof collections>();
  const loose: typeof collections = [];
  for (const c of rest) {
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
    /* Panel white against the grey canvas, so the nav reads as a fixed chrome
       plane and the selected row (a khaki tint) has something to sit on. */
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-ink-line bg-paper-raised">
      <div className="flex h-14 items-center px-4 border-b border-ink-line">
        <Link href="/home" aria-label="DashDrop ホーム">
          <Logo />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <NavLink href="/home" icon="dashboard" label="ホーム" exact />

        {/* Imported spreadsheets — ファイルを開くと中のシートが並ぶ入れ子構造 */}
        <details open className="group/sheets">
          <SectionSummary
            label="スプレッドシート"
            groupName="sheets"
            action={[
              { href: "/samples", label: "参考" },
              { href: "/import", label: "取り込み" },
            ]}
          />

          {fileGroups.map((w) => (
            <FileGroup key={w.id} title={w.name} href={`/f/${w.id}`} count={w.sheets.length}>
              {w.sheets.map((c) => (
                <SheetLink
                  key={c.id}
                  id={c.id}
                  icon={c.icon}
                  name={c.name}
                  count={c._count.records}
                  nested
                />
              ))}
            </FileGroup>
          ))}

          {/* Sheets with no parent file. Only wrapped in 「その他」 when there is
              an actual file tree to distinguish them from. */}
          {loose.length > 0 &&
            (fileGroups.length > 0 ? (
              <FileGroup title="その他" count={loose.length} muted>
                {loose.map((c) => (
                  <SheetLink
                    key={c.id}
                    id={c.id}
                    icon={c.icon}
                    name={c.name}
                    count={c._count.records}
                    nested
                  />
                ))}
              </FileGroup>
            ) : (
              <ul className="space-y-0.5">
                {loose.map((c) => (
                  <SheetLink
                    key={c.id}
                    id={c.id}
                    icon={c.icon}
                    name={c.name}
                    count={c._count.records}
                  />
                ))}
              </ul>
            ))}

          {rest.length === 0 && (
            <div className="px-3 py-2">
              <p className="text-xs text-ink-muted">まだスプレッドシートがありません</p>
              <Link
                href="/import"
                className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-khaki-700 hover:underline"
              >
                <NavIcon name="upload" className="h-3.5 w-3.5" />
                Excelを取り込む
              </Link>
            </div>
          )}

          <div className="pt-1">
            <Link
              href="/c/new"
              className="flex items-center gap-2 rounded px-3 py-2 text-sm font-medium text-khaki-700 transition-colors duration-fast hover:bg-paper-sunken active:bg-ink-line"
            >
              <NavIcon name="plus" className="h-4 w-4" />
              スプレッドシートを追加
            </Link>
          </div>
        </details>

        {/* Saved dashboards */}
        <details open className="group/dash">
          <SectionSummary
            label="ダッシュボード"
            groupName="dash"
            action={{ href: "/dashboards", label: "ギャラリー" }}
          />
          <ul className="space-y-0.5">
            {dashboards.map((d) => (
              <li key={d.id}>
                <NavItem href={`/d/${d.id}`}>
                  <CollectionIcon name={d.icon} className="h-4 w-4 shrink-0 text-ink-muted" />
                  <span className="truncate">{d.name}</span>
                </NavItem>
              </li>
            ))}
            <li>
              <Link
                href="/dashboards"
                className="flex items-center gap-2 rounded px-3 py-2 text-sm font-medium text-khaki-700 transition-colors duration-fast hover:bg-paper-sunken active:bg-ink-line"
              >
                <NavIcon name="plus" className="h-4 w-4" />
                ダッシュボードを追加
              </Link>
            </li>
          </ul>
        </details>
      </nav>

      {/*
        Master databases — pinned to the bottom of the rail (Salesforce keeps its
        objects at a fixed spot rather than scrolling with the file tree).
        Clicking an object name opens that database.

        両方入れると 10 行になり、その分だけ上のファイルツリーが潰れる。
        「左のタブが多いと迷子になる」という指摘があったので、各グループは
        折りたたみ式にして、既定では顧客データベースだけを開いておく。
      */}
      <div className="max-h-[45vh] shrink-0 space-y-1 overflow-y-auto border-t border-ink-line px-2 py-2">
        <MasterGroup
          label="顧客データベース"
          groupName="master-crm"
          sheets={crmSheets}
          defaultOpen
        >
          <CreateCrmButton />
        </MasterGroup>
        <MasterGroup
          label="人事データベース"
          groupName="master-hr"
          sheets={hrSheets}
        >
          <CreateHrButton />
        </MasterGroup>
      </div>

      <div className="border-t border-ink-line p-2">
        <NavLink href="/settings" icon="settings" label="設定" />
        <NavLink href="/pricing" icon="sparkles" label="プラン" />
      </div>
    </aside>
  );
}

/**
 * One master database in the pinned bottom rail: its objects as rows, or the
 * button that creates them when the workspace hasn't set it up yet.
 */
function MasterGroup({
  label,
  groupName,
  sheets,
  defaultOpen,
  children,
}: {
  label: string;
  /** Tailwind group name — must be unique per group on the page. */
  groupName: "master-crm" | "master-hr";
  sheets: { id: string; icon: string; name: string; _count: { records: number } }[];
  /** Open on first paint. Only one group is open by default, to keep the rail short. */
  defaultOpen?: boolean;
  /** The "create this database" action, shown only when it's missing. */
  children: React.ReactNode;
}) {
  const chevron =
    groupName === "master-crm"
      ? "group-open/master-crm:rotate-90"
      : "group-open/master-hr:rotate-90";
  const listId = `${groupName}-list`;

  // 未作成のときは折りたためない（中身が「作成する」ボタンだけなので、
  // 折りたたむと作成手段が消えてしまう）。
  if (sheets.length === 0) {
    return (
      <div>
        <div className="flex items-center px-3 pb-1.5 pt-1">
          <span className="text-2xs font-semibold uppercase tracking-wider text-ink-muted">
            {label}
          </span>
        </div>
        <div className="px-1 pb-1">{children}</div>
      </div>
    );
  }

  return (
    <details
      open={defaultOpen}
      className={groupName === "master-crm" ? "group/master-crm" : "group/master-hr"}
    >
      <summary className="flex list-none items-center gap-1 rounded px-3 pb-1.5 pt-1">
        <span
          id={listId}
          className="text-2xs font-semibold uppercase tracking-wider text-ink-muted"
        >
          {label}
        </span>
        <NavIcon
          name="chevron"
          className={`h-3 w-3 shrink-0 text-ink-faint transition-transform ${chevron}`}
        />
        <span className="ml-auto text-2xs tabular-nums text-ink-faint">
          {sheets.length}
        </span>
      </summary>
      <ul className="space-y-0.5" aria-labelledby={listId}>
        {sheets.map((c) => (
          <SheetLink
            key={c.id}
            id={c.id}
            icon={c.icon}
            name={c.name}
            count={c._count.records}
          />
        ))}
      </ul>
    </details>
  );
}

/**
 * Section header, doubling as the `<summary>` of a collapsible group. The
 * disclosure chevron sits right after the label (not in a left gutter) so it
 * never lines up with — or gets confused for — the file tree's own chevrons.
 */
function SectionSummary({
  label,
  groupName,
  action,
}: {
  label: string;
  groupName: "crm" | "sheets" | "dash";
  /** Up to two shortcuts, right-aligned in the section header. */
  action?:
    | { href: string; label: string }
    | Array<{ href: string; label: string }>;
}) {
  const actions = action ? (Array.isArray(action) ? action : [action]) : [];
  const chevron: Record<typeof groupName, string> = {
    crm: "group-open/crm:rotate-90",
    sheets: "group-open/sheets:rotate-90",
    dash: "group-open/dash:rotate-90",
  };
  return (
    <summary className="flex list-none items-center gap-1 rounded px-3 pt-5 pb-1.5">
      <span className="text-2xs font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      <NavIcon
        name="chevron"
        className={`h-3 w-3 shrink-0 text-ink-faint transition-transform ${chevron[groupName]}`}
      />
      {actions.length > 0 && (
        <span className="ml-auto flex items-center gap-0.5">
          {actions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="-my-1 rounded px-2 py-1 text-2xs font-medium text-khaki-700 transition-colors duration-fast hover:bg-paper-sunken active:bg-ink-line"
            >
              {a.label}
            </Link>
          ))}
        </span>
      )}
    </summary>
  );
}

/**
 * One file (workbook) in the spreadsheet tree: a folder row that expands to
 * its sheets, which are indented behind a left rule so the parent/child
 * relationship reads at a glance.
 */
function FileGroup({
  title,
  href,
  count,
  muted,
  children,
}: {
  title: string;
  href?: string;
  count: number;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open className="group/file">
      <summary className="flex list-none items-center gap-1.5 rounded px-3 py-2 text-sm font-medium text-ink-soft transition-colors duration-fast hover:bg-paper-sunken hover:text-ink active:bg-ink-line">
        <NavIcon
          name="chevron"
          className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform group-open/file:rotate-90"
        />
        <NavIcon name="folder" className="h-4 w-4 shrink-0 text-ink-muted" />
        {href ? (
          <Link href={href} className="min-w-0 flex-1 truncate hover:text-khaki-700" title={title}>
            {title}
          </Link>
        ) : (
          <span className={`min-w-0 flex-1 truncate ${muted ? "text-ink-muted" : ""}`} title={title}>
            {title}
          </span>
        )}
        <span className="shrink-0 text-2xs font-normal text-ink-faint">{count}</span>
      </summary>
      <ul className="mb-1 ml-4 space-y-0.5 border-l border-ink-line pl-1">{children}</ul>
    </details>
  );
}

/**
 * A single spreadsheet row — used for 顧客データベース のシートにも、ファイルの中の
 * シートにも。`nested` tightens it slightly when it sits inside a file.
 */
function SheetLink({
  id,
  icon,
  name,
  count,
  nested,
}: {
  id: string;
  icon: string;
  name: string;
  /** 行数。あるときだけ、右端に控えめに出す。 */
  count?: number;
  nested?: boolean;
}) {
  return (
    <li>
      <NavItem href={`/c/${id}`} className={nested ? "py-1.5" : undefined}>
        <CollectionIcon name={icon} className="h-4 w-4 shrink-0 text-ink-muted" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {count !== undefined && (
          <span className="shrink-0 text-2xs font-normal tabular-nums text-ink-faint">
            {count.toLocaleString()}
          </span>
        )}
      </NavItem>
    </li>
  );
}

function NavLink({
  href,
  icon,
  label,
  exact,
}: {
  href: string;
  icon: string;
  label: string;
  exact?: boolean;
}) {
  return (
    <NavItem href={href} exact={exact} className="font-medium">
      <NavIcon name={icon} className="h-4 w-4 shrink-0 text-ink-muted" />
      {label}
    </NavItem>
  );
}
