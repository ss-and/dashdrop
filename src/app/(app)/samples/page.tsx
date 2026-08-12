/**
 * 参考スプレッドシート gallery — a browsable library of the spreadsheets a
 * Japanese SMB actually keeps (売上日報, 在庫管理, 勤怠管理…), each ready to be
 * added to the workspace with real rows already in it.
 *
 * Server component: reads the workspace's existing collection names so sheets
 * that are already present can be marked 追加済み (re-adding stays allowed).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  SAMPLE_CATEGORIES,
  SAMPLE_SHEETS,
  getSampleCategory,
  getSampleSheetsByCategory,
  sampleSheetCounts,
  type SampleSheet,
} from "@/lib/sample-sheets";
import { Topbar } from "@/components/app/Topbar";
import { CollectionIcon } from "@/components/app/icons";
import { AddSampleButton } from "@/components/samples/AddSampleButton";
import { AddCategoryButton } from "@/components/samples/AddCategoryButton";

/** First few column labels, as a hint of what the sheet looks like. */
function columnPreview(sheet: SampleSheet, max = 4): string {
  const names = sheet.listColumns
    .map((key) => sheet.fields.find((f) => f.key === key)?.name)
    .filter((n): n is string => Boolean(n))
    .slice(0, max);
  const rest = sheet.listColumns.length - names.length;
  return rest > 0 ? `${names.join(" ・ ")} …他${rest}列` : names.join(" ・ ");
}

function SampleCard({
  sheet,
  installed,
}: {
  sheet: SampleSheet;
  installed: boolean;
}) {
  return (
    <div className="flex flex-col rounded-md border border-ink-line bg-paper-raised p-4">
      <div className="flex items-center gap-2">
        <CollectionIcon name={sheet.icon} className="h-4 w-4 shrink-0 text-khaki-500" />
        <h3 className="truncate font-medium text-ink">{sheet.name}</h3>
        {installed && (
          <span className="ml-auto shrink-0 rounded border border-ink-line px-1.5 py-0.5 text-2xs text-ink-faint">
            追加済み
          </span>
        )}
      </div>

      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-muted">
        {sheet.description}
      </p>
      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-soft">
        {sheet.useCase}
      </p>

      <p className="mt-3 text-2xs tabular-nums text-ink-faint">
        {sheet.fields.length} 項目 ・ {sheet.rows.length} 行
      </p>
      <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-ink-faint">
        {columnPreview(sheet)}
      </p>

      <div className="mt-4 flex items-end justify-between gap-3">
        <AddSampleButton sampleKey={sheet.key} />
      </div>
    </div>
  );
}

export default async function SamplesPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const { cat } = await searchParams;
  const activeCat = cat && getSampleCategory(cat) ? cat : undefined;

  const counts = sampleSheetCounts();
  const total = SAMPLE_SHEETS.length;

  const existing = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
    select: { name: true },
  });
  const installedNames = new Set(existing.map((c) => c.name));

  const sections = (
    activeCat ? [getSampleCategory(activeCat)!] : SAMPLE_CATEGORIES
  )
    .map((c) => ({ category: c, sheets: getSampleSheetsByCategory(c.id) }))
    .filter((s) => s.sheets.length > 0);

  const tab = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? "bg-khaki-100 text-khaki-800" : "text-ink-soft hover:bg-paper-sunken"
    }`;

  return (
    <>
      <Topbar user={user} title="参考スプレッドシート" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <section className="space-y-1">
            <h2 className="text-lg font-semibold text-ink">
              よくある業務のスプレッドシートを、そのまま試す
            </h2>
            <p className="text-sm leading-relaxed text-ink-muted">
              中小企業が実際にExcelで持っている台帳を、サンプルデータ入りで用意しました。
              追加するとご自身のワークスペースにコピーされ、項目も中身も自由に編集できます。
              まずは近いものを1つ追加して、自社のデータに置き換えてみてください。
            </p>
          </section>

          {/* Category filter (calm tabs) */}
          <nav className="flex flex-wrap gap-1 border-b border-ink-line pb-2">
            <Link href="/samples" className={tab(!activeCat)}>
              すべて
              <span className="ml-1.5 tabular-nums text-ink-faint">{total}</span>
            </Link>
            {SAMPLE_CATEGORIES.map((c) => (
              <Link key={c.id} href={`/samples?cat=${c.id}`} className={tab(activeCat === c.id)}>
                {c.label}
                <span className="ml-1.5 tabular-nums text-ink-faint">
                  {counts[c.id] ?? 0}
                </span>
              </Link>
            ))}
          </nav>

          {sections.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-muted">
              このカテゴリの参考スプレッドシートはまだありません。
            </p>
          ) : (
            <div className="space-y-8">
              {sections.map(({ category, sheets }) => (
                <section key={category.id} className="space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-sm font-semibold text-ink">{category.label}</h3>
                      <span className="text-xs text-ink-faint">{category.description}</span>
                    </div>
                    <AddCategoryButton sampleKeys={sheets.map((s) => s.key)} />
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {sheets.map((s) => (
                      <SampleCard
                        key={s.key}
                        sheet={s}
                        installed={installedNames.has(s.name)}
                      />
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
