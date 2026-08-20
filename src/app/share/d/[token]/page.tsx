/**
 * Public, read-only shared dashboard.
 * URL: /share/d/<shareToken> — no authentication; the unguessable token is the
 * capability. Renders the same widgets as the private view. `noindex` so shared
 * links are never search-indexed.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadDashboardCollections } from "@/lib/apply-template";
import { computeDashboard } from "@/lib/aggregate";
import type { WidgetSpec } from "@/lib/widgets";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { Logo } from "@/components/ui/Logo";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SharedDashboardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const dashboard = await db.dashboard.findUnique({
    where: { shareToken: token },
  });
  if (!dashboard) notFound();

  const slugs = (dashboard.collectionSlugs as string[]) ?? [];
  const map = await loadDashboardCollections(dashboard.workspaceId, slugs);
  const computed = computeDashboard(dashboard.layout as WidgetSpec[], map);

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-ink-line bg-paper-raised">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" aria-label="DashDrop">
            <Logo />
          </Link>
          <span className="rounded-sm border border-ink-line bg-paper-sunken px-2 py-0.5 text-2xs font-medium text-ink-muted">
            閲覧専用
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 p-6">
        <div>
          <h1 className="text-xl font-semibold text-ink">{dashboard.name}</h1>
          {dashboard.description && (
            <p className="mt-0.5 text-sm text-ink-muted">
              {dashboard.description}
            </p>
          )}
        </div>

        <DashboardGrid computed={computed} theme={dashboard.theme} />

        <div className="border-t border-ink-line pt-4 text-center text-xs text-ink-faint">
          <Link href="/" className="hover:text-ink-muted">
            DashDrop
          </Link>{" "}
          で作成された共有ダッシュボードです
        </div>
      </main>
    </div>
  );
}
