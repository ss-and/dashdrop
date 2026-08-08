/**
 * Dashboard gallery — browse ready-made dashboard templates by category and
 * apply one (which seeds sample data + a live dashboard). Also lists the
 * workspace's already-created dashboards and links to the AI (image/PDF) flow.
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
import { Card, CardBody } from "@/components/ui/Card";
import { Badge, toneFromColor } from "@/components/ui/Badge";
import { CollectionIcon, NavIcon } from "@/components/app/icons";
import { ApplyButton } from "@/components/dashboard/ApplyButton";

/** Short human hint of a template's widget mix, e.g. "KPI 4 ・ チャート 3 ・ 表 1". */
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
  if (chart) parts.push(`チャート ${chart}`);
  if (table) parts.push(`表 ${table}`);
  return parts.join(" ・ ");
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
  const templates = activeCat
    ? getTemplatesByCategory(activeCat)
    : getAllTemplates();

  const dashboards = await db.dashboard.findMany({
    where: { workspaceId: user.workspace.id },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      icon: true,
      color: true,
      category: true,
    },
  });

  const chipBase =
    "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors";

  return (
    <>
      <Topbar user={user} title="ダッシュボード ギャラリー" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-8">
          {/* Created dashboards */}
          {dashboards.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-ink-soft">作成済み</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {dashboards.map((d) => (
                  <Link key={d.id} href={`/d/${d.id}`} className="group">
                    <Card className="h-full transition-colors group-hover:border-khaki-300">
                      <CardBody className="flex items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-ink-line bg-paper-raised">
                          <CollectionIcon
                            name={d.icon}
                            className="h-5 w-5 text-khaki-500"
                          />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">
                            {d.name}
                          </p>
                          {d.description && (
                            <p className="truncate text-xs text-ink-muted">
                              {d.description}
                            </p>
                          )}
                        </div>
                      </CardBody>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Intro + AI card */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-2">
              <h2 className="text-lg font-semibold text-ink">
                テンプレートから始める
              </h2>
              <p className="max-w-xl text-sm text-ink-muted">
                適用するとサンプルデータ付きでテーブルとダッシュボードが作成され、
                そのまま自分のデータに置き換えられます。
              </p>
            </div>
            <Link
              href="/dashboards/new"
              className="group flex items-center gap-3 rounded-md border border-khaki-300 bg-khaki-50 px-4 py-3 transition-colors hover:bg-khaki-100"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-khaki-500 text-white">
                <NavIcon name="sparkles" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-medium text-khaki-800">画像・PDFから作成</p>
                <p className="text-xs text-khaki-700">
                  手元の資料をAIで読み取ってダッシュボード化
                </p>
              </div>
            </Link>
          </section>

          {/* Category chips */}
          <nav className="flex flex-wrap gap-2">
            <Link
              href="/dashboards"
              className={`${chipBase} ${
                !activeCat
                  ? "border-khaki-400 bg-khaki-100 text-khaki-800"
                  : "border-ink-line bg-paper-raised text-ink-soft hover:bg-paper-sunken"
              }`}
            >
              すべて
              <span className="tabular-nums text-ink-faint">{total}</span>
            </Link>
            {CATEGORIES.map((c) => {
              const n = counts[c.id] ?? 0;
              const active = activeCat === c.id;
              return (
                <Link
                  key={c.id}
                  href={`/dashboards?cat=${c.id}`}
                  className={`${chipBase} ${
                    active
                      ? "border-khaki-400 bg-khaki-100 text-khaki-800"
                      : "border-ink-line bg-paper-raised text-ink-soft hover:bg-paper-sunken"
                  }`}
                >
                  <CollectionIcon name={c.icon} className="h-4 w-4" />
                  {c.label}
                  <span className="tabular-nums text-ink-faint">{n}</span>
                </Link>
              );
            })}
          </nav>

          {/* Template grid */}
          {templates.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-muted">
              このカテゴリのテンプレートはまだありません。
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {templates.map((t) => {
                const category = getCategory(t.category);
                return (
                  <Card key={t.key} className="flex h-full flex-col">
                    <CardBody className="flex flex-1 flex-col gap-3">
                      <div className="flex items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-ink-line bg-paper-raised">
                          <CollectionIcon
                            name={t.icon}
                            className="h-5 w-5 text-khaki-500"
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold leading-tight text-ink">
                            {t.name}
                          </h3>
                          {category && (
                            <Badge
                              tone={toneFromColor(category.color)}
                              className="mt-1"
                            >
                              {category.label}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <p className="flex-1 text-sm text-ink-muted">
                        {t.description}
                      </p>

                      <p className="text-2xs uppercase tracking-wide text-ink-faint">
                        {widgetHint(t)}
                      </p>

                      <ApplyButton templateKey={t.key} className="mt-1" />
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
