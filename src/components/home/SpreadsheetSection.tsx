/**
 * 「スプレッドシート」 — the one place on the home page that lists everything
 * holding rows.
 *
 * 顧客データベース（顧客・商談・請求書…）も、取り込んだファイルの中のシートも、
 * 同じ「スプレッドシート」。違うのは並べ方だけなので、グループ見出しだけを変えて
 * 同じ行で並べる。中身は 1 クリック先のシート画面（表 / 分析）にあるので、ここは
 * 一覧の入口に徹する。
 */
import Link from "next/link";
import { HomeRow, HomeRowGroupLabel } from "./HomeRow";

export interface SheetEntry {
  id: string;
  name: string;
  icon?: string;
  /** 「128 件」「3 シート」 — already formatted. */
  meta?: string;
  /**
   * 中身の件数（シートなら行数、ファイルならシート数）。ホームは「中身のある
   * ものだけ」を出すのに使う。表示には meta を使う。
   */
  recordCount?: number;
  href: string;
  folder?: boolean;
}

export interface SheetGroup {
  key: string;
  label: string;
  entries: SheetEntry[];
}

export function SpreadsheetSection({
  groups,
  children,
}: {
  groups: SheetGroup[];
  /** 未作成のマスターDBを作る導線など、一覧の下に差し込む内容。 */
  children?: React.ReactNode;
}) {
  const filled = groups.filter((g) => g.entries.length > 0);

  return (
    <section className="space-y-3">
      <h2 className="section-title">スプレッドシート</h2>

      {filled.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-ink-line bg-paper-raised">
          {filled.map((g) => (
            <div key={g.key}>
              <HomeRowGroupLabel label={g.label} />
              <ul>
                {g.entries.map((e) => (
                  <HomeRow
                    key={e.id}
                    href={e.href}
                    icon={e.icon}
                    name={e.name}
                    meta={e.meta}
                    folder={e.folder}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          まだスプレッドシートがありません。
        </p>
      )}

      {children}

      <div className="flex flex-wrap items-center gap-4">
        <Link
          href="/samples"
          className="text-sm font-medium text-khaki-700 hover:underline"
        >
          参考スプレッドシートを見る
        </Link>
        <Link
          href="/import"
          className="text-sm font-medium text-khaki-700 hover:underline"
        >
          Excelを取り込む
        </Link>
      </div>
    </section>
  );
}
