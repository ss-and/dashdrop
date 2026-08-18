/**
 * One row in a home-page list — a spreadsheet, a file, or a dashboard.
 *
 * Deliberately a single component: 顧客データベースのシートも、取り込んだファイルの
 * シートも同じ「スプレッドシート」なので、見た目も同じでなければならない。
 */
import Link from "next/link";
import { CollectionIcon, NavIcon } from "@/components/app/icons";

export function HomeRow({
  href,
  icon,
  name,
  meta,
  folder,
}: {
  href: string;
  /** Collection/dashboard icon name. Ignored when `folder` is set. */
  icon?: string;
  name: string;
  /** Muted right-hand count, e.g. 「128 件」「3 シート」. */
  meta?: string;
  /** Renders the folder glyph — used for ファイル rows. */
  folder?: boolean;
}) {
  return (
    <li className="border-b border-ink-line last:border-b-0">
      <Link href={href} className="row-hit flex items-center gap-2.5 px-4 py-2">
        {folder ? (
          <NavIcon name="folder" className="h-4 w-4 shrink-0 text-ink-muted" />
        ) : (
          <CollectionIcon
            name={icon ?? "table"}
            className="h-4 w-4 shrink-0 text-ink-muted"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{name}</span>
        {meta && (
          <span className="shrink-0 tabular-nums text-xs text-ink-muted">
            {meta}
          </span>
        )}
        <NavIcon name="chevron" className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
      </Link>
    </li>
  );
}

/** Group label inside a list panel (顧客データベース / 取り込んだファイル / その他). */
export function HomeRowGroupLabel({ label }: { label: string }) {
  return (
    <div className="border-b border-ink-line bg-paper-sunken px-4 py-1.5">
      <p className="text-2xs font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </p>
    </div>
  );
}
