/**
 * 「今日の数字」 — at most four numbers, not nine.
 *
 * 先頭のタイルだけ幅と文字を大きくして、バンドに主語を持たせる。9 個の同じ大きさの
 * 箱は、どれも読まれない。各タイルはその数字の出どころのスプレッドシートへのリンク。
 */
import Link from "next/link";

export interface SummaryTile {
  key: string;
  label: string;
  /** Already-formatted display value (e.g. "12" / "¥3,200,000"). */
  value: string;
  /** Small caption under the value. */
  hint?: string;
  /**
   * 表示前の生の数値。ホームが「この帯を出す意味があるか」を判断するのに使う
   * （全部ゼロの帯は情報ではなく雑音なので出さない）。表示には value を使う。
   */
  rawValue: number;
  href: string;
}

export function SummaryBand({ tiles }: { tiles: SummaryTile[] }) {
  if (tiles.length === 0) return null;

  return (
    /* One panel divided by rules, not four floating cards — and a flex row so
       the tiles always fill the band whatever the number of them. */
    <section className="flex flex-col divide-y divide-ink-line overflow-hidden rounded-md border border-ink-line sm:flex-row sm:divide-x sm:divide-y-0">
      {tiles.map((t, i) => {
        const hero = i === 0;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`row-hit min-w-0 bg-paper-raised px-4 py-3 ${
              hero ? "sm:flex-[2]" : "sm:flex-1"
            }`}
          >
            <p className="truncate text-xs font-medium text-ink-muted">
              {t.label}
            </p>
            <p
              className={`mt-1 truncate font-semibold tabular-nums tracking-tight text-ink ${
                hero ? "text-3xl" : "text-xl"
              }`}
            >
              {t.value}
            </p>
            {t.hint && (
              <p className="mt-0.5 truncate text-xs text-ink-muted">{t.hint}</p>
            )}
          </Link>
        );
      })}
    </section>
  );
}
