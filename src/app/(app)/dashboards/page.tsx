/**
 * Dashboard gallery — browse ready-made dashboard templates and open a preview
 * before adding one. Calm, typography-first cards grouped by category; the
 * loud per-card badges/buttons were removed in favour of a "見てから使う" flow.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getAllTemplates,
  getTemplatesByCategory,
  CATEGORIES,
  getCategory,
  templateCounts,
} from "@/lib/dashboard-templates";
import type { DashboardTemplate } from "@/lib/widgets";
import { Topbar } from "@/components/app/Topbar";
import { CollectionIcon, NavIcon } from "@/components/app/icons";

/** Short human hint of a template's widget mix, e.g. "KPI 4 ・ グラフ 3 ・ 表 1". */
function widgetHint(t: DashboardTemplate): string {
  let kpi = 0;
  let chart = 0;
  let table = 0;
  for (const w of t.widgets) {
    if (w.type === "kpi") kpi++;
    else if (w.type === "table") table++;
    else chart++;
  }
  const parts: string[] = [];
  if (kpi) parts.push(`KPI ${kpi}`);
  if (chart) parts.push(`グラフ ${chart}`);
  if (table) parts.push(`表 ${table}`);
  return parts.join(" ・ ");
}

function TemplateCard({ t }: { t: DashboardTemplate }) {
  return (
    <Link
      href={`/dashboards/preview/${t.key}`}
      className="group flex flex-col rounded-md border border-ink-line bg-paper-raised p-4 transition-colors hover:border-khaki-300 hover:bg-paper-raised/60"
    >
      <div className="flex items-center gap-2">
        <CollectionIcon name={t.icon} className="h-4 w-4 shrink-0 text-khaki-500" />
        <h3 className="truncate font-medium text-ink group-hover:text-khaki-800">
          {t.name}
        </h3>
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-muted">
        {t.description}
      </p>
      <p className="mt-3 text-2xs tabular-nums text-ink-faint">{widgetHint(t)}</p>
    </Link>
  );
}

export default async function DashboardsGalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const { cat } = await searchParams;
  const activeCat = cat && getCategory(cat) ? cat : undefined;

  const counts = templateCounts();
  const total = getAllTemplates().length;

  const dashboards = await db.dashboard.findMany({
    where: { workspaceId: user.workspace.id },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, description: true, icon: true },
  });

  // Sections to render: one per category (all) or just the active category.
  const sections = (activeCat ? [getCategory(activeCat)!] : CATEGORIES)
    .map((c) => ({ category: c, templates: getTemplatesByCategory(c.id) }))
    .filter((s) => s.templates.length > 0);

  const tab = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? "bg-khaki-100 text-khaki-800"
        : "text-ink-soft hover:bg-paper-sunken"
    }`;

  return (
    <>
      <Topbar user={user} title="ダッシュボード" />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-6xl space-y-8">
          {/* Created dashboards */}
          {dashboards.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-ink-soft">作成済み</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {dashboards.map((d) => (
                  <Link
                    key={d.id}
                    href={`/d/${d.id}`}
                    className="group flex items-center gap-2.5 rounded-md border border-ink-line bg-paper-raised px-4 py-3 transition-colors hover:border-khaki-300"
                  >
                    <CollectionIcon name={d.icon} className="h-4 w-4 shrink-0 text-khaki-500" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink group-hover:text-khaki-800">
                        {d.name}
                      </span>
                      {d.description && (
                        <span className="block truncate text-xs text-ink-muted">
                          {d.description}
                        </span>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Header + creation entries */}
          <section className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-ink">ダッシュボードを作る</h2>
              <p className="text-sm text-ink-muted">
                取り込んだExcel・スプレッドシートを、そのままグラフやKPIに。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/dashboards/build"
                className="group inline-flex items-center gap-2.5 rounded-md border border-khaki-300 bg-khaki-50 px-3.5 py-2 transition-colors hover:bg-khaki-100"
              >
                <NavIcon name="plus" className="h-4 w-4 text-khaki-600" />
                <span className="text-sm">
                  <span className="font-medium text-khaki-800">ドラッグ&ドロップで作成</span>
                  <span className="ml-1.5 text-khaki-600">自分で組む</span>
                </span>
              </Link>
              <Link
                href="/dashboards/new"
                className="group inline-flex items-center gap-2.5 rounded-md border border-ink-line bg-paper-raised px-3.5 py-2 transition-colors hover:border-khaki-300"
              >
                <NavIcon name="sparkles" className="h-4 w-4 text-khaki-500" />
                <span className="text-sm">
                  <span className="font-medium text-ink">画像・PDFから作成</span>
                  <span className="ml-1.5 text-ink-muted">AIで読み取り</span>
                </span>
              </Link>
            </div>
          </section>

          <section className="space-y-1">
            <h2 className="text-lg font-semibold text-ink">テンプレートから始める</h2>
            <p className="text-sm text-ink-muted">
              カードを選ぶとプレビューを表示します。内容を確認してから追加できます。
            </p>
          </section>

          {/* Category filter (calm tabs) */}
          <nav className="flex flex-wrap gap-1 border-b border-ink-line pb-2">
            <Link href="/dashboards" className={tab(!activeCat)}>
              すべて
              <span className="ml-1.5 tabular-nums text-ink-faint">{total}</span>
            </Link>
            {CATEGORIES.map((c) => (
              <Link key={c.id} href={`/dashboards?cat=${c.id}`} className={tab(activeCat === c.id)}>
                {c.label}
                <span className="ml-1.5 tabular-nums text-ink-faint">
                  {counts[c.id] ?? 0}
                </span>
              </Link>
            ))}
          </nav>

          {/* Grouped template sections */}
          {sections.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-muted">
              このカテゴリのテンプレートはまだありません。
            </p>
          ) : (
            <div className="space-y-8">
              {sections.map(({ category, templates }) => (
                <section key={category.id} className="space-y-3">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-ink">{category.label}</h3>
                    <span className="text-xs text-ink-faint">{category.description}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {templates.map((t) => (
                      <TemplateCard key={t.key} t={t} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
