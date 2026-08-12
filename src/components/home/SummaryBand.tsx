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
    /*
     * One panel divided by rules, not six floating cards. Six separate bordered
     * rectangles with gaps between them was the most literal version of the
     * "薄い色の長方形が並ぶ" problem, and it made the numbers — the actual
     * content — compete with their own containers for attention.
     */
    <section className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-ink-line bg-ink-line sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className="group bg-paper-raised px-4 py-3 transition-colors duration-fast hover:bg-paper-sunken active:bg-ink-line"
        >
          <p className="truncate text-xs font-medium text-ink-muted">
            {t.label}
          </p>
          <p className="mt-1 truncate text-2xl font-semibold tabular-nums tracking-tight text-ink">
            {t.value}
          </p>
          {t.hint && (
            <p className="mt-0.5 truncate text-xs text-ink-muted">{t.hint}</p>
          )}
        </Link>
      ))}
    </section>
  );
}
