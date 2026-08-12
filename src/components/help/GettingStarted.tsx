import Link from "next/link";
import { NavIcon } from "@/components/app/icons";

/**
 * The two ways to build something in DashDrop, shown side by side.
 *
 * New owners kept asking "where do I start?" — the answer is always one of two
 * paths: work from the master customer database, or work straight from a
 * spreadsheet you already have. Everything else is a detail of those two.
 */

interface Path {
  badge: string;
  title: string;
  body: string;
  bullets: string[];
  cta: { href: string; label: string };
  secondary?: { href: string; label: string };
  icon: string;
}

function paths(crmHref: string | null): Path[] {
  return [
    {
      badge: "A",
      icon: "users",
      title: "顧客データベースから作る",
      body: "顧客・商談・請求書などをDashDrop側で正として持つ方法です。データが増えるほど、ここが会社の台帳になります。",
      bullets: [
        "顧客を登録し、商談・請求書をひも付ける",
        "レコード同士はリンクで行き来できる",
        "金額はホームのサマリーに自動で集計",
      ],
      cta: crmHref
        ? { href: crmHref, label: "顧客を開く" }
        : { href: "/home", label: "顧客データベースを作る" },
      secondary: { href: "/home", label: "ホームでサマリーを見る" },
    },
    {
      badge: "B",
      icon: "upload",
      title: "スプレッドシートから直接作る",
      body: "手元のExcel / スプレッドシートをそのまま取り込む方法です。ファイル単位で保持され、各シートが表になります。",
      bullets: [
        "Excel・CSV・Googleスプレッドシートを取り込む",
        "ファイル（ブック）の入れ子で整理される",
        "「おすすめ構成で自動作成」でダッシュボード化",
      ],
      cta: { href: "/import", label: "Excelを取り込む" },
      secondary: { href: "/dashboards/build", label: "自分でダッシュボードを組む" },
    },
  ];
}

export function GettingStarted({
  crmHref = null,
  compact = false,
}: {
  /** Link to the 顧客 object when it exists, so path A can jump straight in. */
  crmHref?: string | null;
  /** Tighter spacing for use inside a panel. */
  compact?: boolean;
}) {
  return (
    <section className={compact ? "space-y-2" : "space-y-3"}>
      {!compact && (
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-ink">はじめかたは2通り</h2>
          <p className="text-xs text-ink-muted">
            どちらから始めても、あとで組み合わせられます
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {paths(crmHref).map((p) => (
          <div
            key={p.badge}
            className="flex flex-col rounded-md border border-ink-line bg-paper-raised p-4"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-khaki-300 bg-khaki-50 text-sm font-semibold text-khaki-800">
                {p.badge}
              </span>
              <div className="flex min-w-0 items-center gap-1.5">
                <NavIcon name={p.icon} className="h-4 w-4 shrink-0 text-khaki-600" />
                <h3 className="truncate text-sm font-semibold text-ink">
                  {p.title}
                </h3>
              </div>
            </div>

            <p className="mt-2.5 text-xs leading-relaxed text-ink-muted">
              {p.body}
            </p>

            <ul className="mt-3 space-y-1.5">
              {p.bullets.map((b) => (
                <li
                  key={b}
                  className="flex items-start gap-1.5 text-xs text-ink-soft"
                >
                  <span
                    aria-hidden="true"
                    className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-khaki-500"
                  />
                  {b}
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap items-center gap-2 pt-1">
              <Link
                href={p.cta.href}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-khaki-300 bg-khaki-50 px-3 text-xs font-medium text-khaki-800 transition-colors hover:bg-khaki-100"
              >
                {p.cta.label}
              </Link>
              {p.secondary && (
                <Link
                  href={p.secondary.href}
                  className="text-xs font-medium text-khaki-600 hover:text-khaki-700"
                >
                  {p.secondary.label}
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
