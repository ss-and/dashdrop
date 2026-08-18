/**
 * 取り込みログ — 何を・いつ取り込んだかの記録。
 *
 * Excel / CSV / Google スプレッドシートの取り込みは Activity に
 * `import.completed` として残るので、それを主役の表にし、レコードの追加・更新
 * などのその他の操作は下に控えめに並べる。
 *
 * Server component: workspace-scoped Prisma queries only. `Activity.meta` は
 * Json? なので、どのフィールドも欠けている前提で読む。
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Topbar } from "@/components/app/Topbar";
import { NavIcon } from "@/components/app/icons";
import { HelpTip } from "@/components/ui/HelpTip";
import {
  ImportLogTable,
  type ImportLogRow,
} from "@/components/logs/ImportLogTable";
import {
  OperationLog,
  type OperationLogItem,
} from "@/components/logs/OperationLog";

const ACTIVITY_LIMIT = 100;
const OTHER_LIMIT = 30;

const SOURCE_LABEL: Record<string, string> = {
  excel: "Excel",
  csv: "CSV",
  gsheets: "Google スプレッドシート",
};

const TYPE_LABEL: Record<string, string> = {
  "collection.created": "スプレッドシートを作成",
  "record.created": "レコードを追加",
  "record.updated": "レコードを更新",
  "record.deleted": "レコードを削除",
};

/** YYYY/MM/DD HH:mm */
function formatDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

function readString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function readCount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function readNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s !== "");
}

export default async function LogsPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  const workspaceId = user.workspace.id;

  const [activities, workbooks] = await Promise.all([
    db.activity.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_LIMIT,
    }),
    db.workbook.findMany({ where: { workspaceId }, select: { id: true } }),
  ]);

  const liveWorkbookIds = new Set(workbooks.map((w) => w.id));

  const importRows: ImportLogRow[] = [];
  const otherItems: OperationLogItem[] = [];

  for (const a of activities) {
    const at = formatDateTime(a.createdAt);

    if (a.type === "import.completed") {
      const m = (a.meta ?? {}) as Record<string, unknown>;
      const workbookId = readString(m.workbookId);
      const sheetNames = readNames(m.sheetNames);
      const sheets = readCount(m.sheets);
      const skipped = readCount(m.skipped) ?? 0;
      importRows.push({
        id: a.id,
        at,
        fileName: readString(m.fileName) ?? "（ファイル名なし）",
        href:
          workbookId && liveWorkbookIds.has(workbookId)
            ? `/f/${workbookId}`
            : null,
        sourceLabel:
          SOURCE_LABEL[readString(m.source) ?? "excel"] ?? "Excel",
        sheetCount: sheets ?? (sheetNames.length > 0 ? sheetNames.length : null),
        rowCount: readCount(m.rows),
        skipped: skipped > 0 ? skipped : 0,
        sheetNames,
      });
      continue;
    }

    if (otherItems.length < OTHER_LIMIT) {
      otherItems.push({
        id: a.id,
        at,
        label: TYPE_LABEL[a.type] ?? a.type,
      });
    }
  }

  const totalRows = importRows.reduce((sum, r) => sum + (r.rowCount ?? 0), 0);

  return (
    <>
      <Topbar user={user} title="取り込みログ" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-5">
          {/* ヘッダー */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md border border-ink-line bg-paper-raised">
                <NavIcon name="inbox" className="h-5 w-5 text-khaki-500" />
              </span>
              <div className="min-w-0">
                <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                  ログ
                </p>
                <div className="flex items-center gap-1.5">
                  <h2 className="truncate text-lg font-semibold text-ink">
                    取り込みログ
                  </h2>
                  <HelpTip label="取り込みログについて">
                    Excel・CSV・Googleスプレッドシートを取り込んだ履歴です。
                    ファイル名をクリックすると、その取り込みで作られたシート一覧が開きます。
                    直近 {ACTIVITY_LIMIT} 件の操作を表示しています。
                  </HelpTip>
                </div>
                <p className="text-sm text-ink-muted">
                  {importRows.length.toLocaleString()} 回の取り込み・合計{" "}
                  {totalRows.toLocaleString()} 行
                </p>
              </div>
            </div>
            <Link
              href="/import"
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded border border-ink-line bg-paper-raised px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-sunken"
            >
              <NavIcon name="upload" className="h-4 w-4" />
              Excelを取り込む
            </Link>
          </div>

          {/* 取り込み履歴 */}
          <div className="overflow-hidden rounded-md border border-ink-line bg-paper-raised shadow-card">
            <div className="flex items-center justify-between border-b border-ink-line px-4 py-2.5">
              <p className="text-sm font-semibold text-ink">取り込み履歴</p>
              <span className="text-2xs font-medium text-ink-faint">
                {importRows.length.toLocaleString()} 件
              </span>
            </div>
            <ImportLogTable rows={importRows} />
          </div>

          {/* その他の操作 */}
          <div className="overflow-hidden rounded-md border border-ink-line bg-paper-raised shadow-card">
            <div className="flex items-center justify-between border-b border-ink-line px-4 py-2.5">
              <p className="text-sm font-semibold text-ink">その他の操作</p>
              <span className="text-2xs font-medium text-ink-faint">
                直近 {otherItems.length.toLocaleString()} 件
              </span>
            </div>
            <OperationLog items={otherItems} />
          </div>
        </div>
      </main>
    </>
  );
}
