import Link from "next/link";
import { NavIcon } from "@/components/app/icons";
import { buttonStyles } from "@/components/ui/Button";

/**
 * The two ways to build something in DashDrop, shown side by side.
 *
 * New owners kept asking "where do I start?" — the answer is always one of two
 * paths: work from the master customer database, or work straight from a
 * spreadsheet you already have.
 *
 * Deliberately short. The previous version explained each path with a
 * paragraph plus three bullets — nine lines of prose for what is really a
 * two-way choice, and the reader has to get through all of it before finding
 * the button. One sentence and one button per path is the whole job.
 */

interface Path {
  title: string;
  body: string;
  cta: { href: string; label: string };
  secondary?: { href: string; label: string };
  icon: string;
}

function paths(crmHref: string | null): Path[] {
  return [
    {
      icon: "users",
      title: "顧客データベースから作る",
      body: "顧客・商談・請求書をDashDrop側で管理します。金額はホームに自動集計されます。",
      cta: crmHref
        ? { href: crmHref, label: "顧客を開く" }
        : { href: "/home", label: "顧客データベースを作る" },
    },
    {
      icon: "upload",
      title: "スプレッドシートから作る",
      body: "手元のExcel・CSV・Googleスプレッドシートを、そのまま取り込みます。",
      cta: { href: "/import", label: "Excelを取り込む" },
      secondary: { href: "/dashboards/build", label: "ダッシュボードを組む" },
    },
  ];
}

export function GettingStarted({
  crmHref = null,
  compact = false,
  crmAction,
}: {
  /** Link to the 顧客 object when it exists, so path A can jump straight in. */
  crmHref?: string | null;
  /** Drops the heading for use inside a panel that already has one. */
  compact?: boolean;
  /**
   * Replaces path A's link when the database does not exist yet — the home page
   * passes the button that actually creates it. Without this the page ended up
   * showing this block AND a second panel repeating the same offer.
   */
  crmAction?: React.ReactNode;
}) {
  const list = paths(crmHref);
  return (
    <section className="space-y-3">
      {!compact && <h2 className="section-title">はじめかた</h2>}
      <div className="grid grid-cols-1 divide-y divide-ink-line overflow-hidden rounded-md border border-ink-line bg-paper-raised md:grid-cols-2 md:divide-x md:divide-y-0">
        {list.map((p, i) => (
          <div key={p.title} className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
              <NavIcon name={p.icon} className="h-4 w-4 shrink-0 text-khaki-600" />
              <h3 className="text-base font-semibold text-ink">{p.title}</h3>
            </div>
            <p className="text-sm text-ink-soft">{p.body}</p>
            <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
              {i === 0 && crmAction ? (
                crmAction
              ) : (
                <Link
                  href={p.cta.href}
                  className={buttonStyles({ variant: "secondary", size: "sm" })}
                >
                  {p.cta.label}
                </Link>
              )}
              {p.secondary && (
                <Link
                  href={p.secondary.href}
                  className="text-sm font-medium text-khaki-700 hover:underline"
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
