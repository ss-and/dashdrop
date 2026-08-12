/**
 * 「取り込んだファイル」 — a quiet one-line-per-file list of the imported Excel /
 * Google スプレッドシート workbooks, so the raw material stays one click away
 * from the customer database it feeds.
 */
import Link from "next/link";
import { NavIcon } from "@/components/app/icons";

export interface HomeWorkbook {
  id: string;
  name: string;
  sheetCount: number;
}

export function FilesStrip({ workbooks }: { workbooks: HomeWorkbook[] }) {
  if (workbooks.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">取り込んだファイル</h3>
        <Link
          href="/import"
          className="inline-flex items-center gap-1 text-xs font-medium text-khaki-700 hover:text-khaki-800 hover:underline"
        >
          <NavIcon name="upload" className="h-3 w-3" />
          Excel取り込み
        </Link>
      </div>
      <ul className="overflow-hidden rounded-md border border-ink-line bg-paper-raised">
        {workbooks.map((w) => (
          <li key={w.id} className="border-b border-ink-line last:border-b-0">
            <Link
              href={`/f/${w.id}`}
              className="flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-paper-sunken"
            >
              <NavIcon name="folder" className="h-3.5 w-3.5 shrink-0 text-khaki-500" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {w.name}
              </span>
              <span className="shrink-0 tabular-nums text-xs text-ink-muted">
                {w.sheetCount} シート
              </span>
              <NavIcon name="chevron" className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
