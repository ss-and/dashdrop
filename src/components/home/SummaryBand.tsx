/**
 * The KPI band at the top of the home page — 顧客数 / 商談数 / パイプライン金額
 * など、ワークスペース全体のサマリー。Each tile is a hyperlink to the object it
 * summarises, so the numbers are an entry point into the database rather than a
 * dead readout.
 */
import Link from "next/link";

export interface SummaryTile {
  key: string;
  label: string;
  /** Already-formatted display value (e.g. "12" / "¥3,200,000"). */
  value: string;
  /** Small caption under the value. */
  hint?: string;
  href: string;
}

export function SummaryBand({ tiles }: { tiles: SummaryTile[] }) {
  if (tiles.length === 0) return null;

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className="group rounded-md border border-ink-line bg-paper-raised px-4 py-3 shadow-card transition-colors hover:border-khaki-300 hover:bg-khaki-50"
        >
          <p className="truncate text-2xs font-semibold uppercase tracking-wider text-ink-faint">
            {t.label}
          </p>
          <p className="mt-1 truncate text-xl font-semibold tabular-nums text-ink group-hover:text-khaki-800">
            {t.value}
          </p>
          {t.hint && (
            <p className="mt-0.5 truncate text-2xs text-ink-muted">{t.hint}</p>
          )}
        </Link>
      ))}
    </section>
  );
}
