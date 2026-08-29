/**
 * 参考スプレッドシート gallery — a browsable library of the spreadsheets a
 * Japanese SMB actually keeps (売上日報, 在庫管理, 勤怠管理…), each ready to be
 * added to the workspace with real rows already in it.
 *
 * Server component: reads the workspace's existing collection names so sheets
 * that are already present can be marked 追加済み (re-adding stays allowed).
 *
 * ---------------------------------------------------------------------------
 * 意図的に「文字を出さない」ページ。
 *
 * 「文字や見る機能が多すぎて、わかりづらくなっている気がする」という指摘を
 * 受けて、1枚あたり 5 行あった説明（説明文・利用シーン・「N 項目 ・ N 行」・
 * 列名のプレビュー）と、カテゴリ見出しの補足文、冒頭の 3 文のリード文を
 * すべて外した。このページの用途は "読む" ことではなく、近いものを 1 つ選んで
 * 「追加」を押すこと。カードに説明文を戻さないこと。
 * ---------------------------------------------------------------------------
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

/**
 * 1枚のカード。名前と行数、そして「追加」だけ。選ぶのに要らないものは載せない。
 */
function SampleCard({
  sheet,
  installed,
}: {
  sheet: SampleSheet;
  installed: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-ink-line bg-paper-raised p-3">
      <CollectionIcon name={sheet.icon} className="h-4 w-4 shrink-0 text-khaki-500" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium text-ink">{sheet.name}</h3>
        <p className="text-2xs tabular-nums text-ink-faint">
          {sheet.rows.length} 行{installed && " ・ 追加済み"}
        </p>
      </div>
      <AddSampleButton sampleKey={sheet.key} />
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
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-6xl space-y-6">
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
                  {/* 見出しはカテゴリ名だけ。補足文は読まれないまま場所を取っていた。 */}
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <h3 className="text-sm font-semibold text-ink">{category.label}</h3>
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
