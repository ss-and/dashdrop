import { CollectionIcon } from "@/components/app/icons";

/**
 * A tidy list of the workspace's most recent records. The parent page queries
 * the records (tenant-scoped) and passes normalized items in.
 */

export interface RecentActivityItem {
  id: string;
  /** Template origin of the record's collection. */
  template: "inquiry" | "task" | "custom" | string;
  /** Icon name for the collection (from CollectionIcon). */
  icon: string;
  /** Human collection name, used in the label for custom collections. */
  collectionName: string;
  /** Best-effort display name of the record (customer / title / …). */
  primary: string;
  /** ISO timestamp of record creation. */
  createdAt: string;
}

/** Simple Japanese relative-time helper: x分前 / x時間前 / x日前. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (!Number.isFinite(then) || diff < 0) return "たった今";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}日前`;
  const mo = Math.floor(day / 30);
  return `${mo}ヶ月前`;
}

function labelFor(item: RecentActivityItem): string {
  const name = item.primary || "（無題）";
  if (item.template === "inquiry") return `新しい問い合わせ: ${name}`;
  if (item.template === "task") return `タスク追加: ${name}`;
  return `${item.collectionName}: ${name}`;
}

function toneClass(template: string): string {
  if (template === "inquiry") return "bg-info-soft text-info";
  if (template === "task") return "bg-khaki-100 text-khaki-700";
  return "bg-paper-sunken text-ink-muted";
}

export function RecentActivity({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-ink-faint">
        まだアクティビティがありません
      </p>
    );
  }

  return (
    <ul className="divide-y divide-ink-line">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-5 py-3">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${toneClass(item.template)}`}
          >
            <CollectionIcon name={item.icon} className="h-4 w-4" />
          </span>
          <p className="min-w-0 flex-1 truncate text-sm text-ink-soft">
            {labelFor(item)}
          </p>
          <span className="shrink-0 text-xs tabular-nums text-ink-faint">
            {relativeTime(item.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
