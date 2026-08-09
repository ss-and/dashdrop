/**
 * Template preview — "見てから使う". Renders a dashboard template with freshly
 * generated sample data (NOT persisted) so the owner can see exactly what they
 * get before adding it to their workspace.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getTemplate, getCategory } from "@/lib/dashboard-templates";
import { buildTemplatePreview } from "@/lib/preview";
import { Topbar } from "@/components/app/Topbar";
import { NavIcon } from "@/components/app/icons";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { ApplyButton } from "@/components/dashboard/ApplyButton";

export default async function TemplatePreviewPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const { key } = await params;
  const template = getTemplate(key);
  if (!template) redirect("/dashboards");

  const computed = buildTemplatePreview(template);
  const category = getCategory(template.category);
  const sheetNames = template.collections.map((c) => c.name).join("・");

  return (
    <>
      <Topbar user={user} title={template.name} />
      <main className="flex-1 overflow-y-auto">
        {/* Sticky action header */}
        <div className="sticky top-0 z-10 border-b border-ink-line bg-paper/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
            <div className="min-w-0">
              <Link
                href="/dashboards"
                className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink-soft"
              >
                <NavIcon name="table" className="hidden" />
                ← ギャラリーに戻る
              </Link>
              <h2 className="truncate text-lg font-semibold text-ink">
                {template.name}
              </h2>
              <p className="mt-0.5 text-sm text-ink-muted">
                {template.description}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <ApplyButton
                templateKey={template.key}
                variant="primary"
                size="md"
                label="このダッシュボードを使う"
              />
              <p className="text-2xs text-ink-faint">
                {category?.label} ・ スプレッドシート「{sheetNames}」を作成
              </p>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-6xl space-y-4 p-6">
          <div className="flex items-center gap-2 rounded-md border border-ink-line bg-paper-raised px-4 py-2.5 text-sm text-ink-muted">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-khaki-100 text-2xs font-semibold text-khaki-700">
              i
            </span>
            これはサンプルデータのプレビューです。「使う」を押すと、あなたのワークスペースに
            スプレッドシートとダッシュボードが作成され、そのまま自分のデータに置き換えられます。
          </div>

          <DashboardGrid computed={computed} />
        </div>
      </main>
    </>
  );
}
