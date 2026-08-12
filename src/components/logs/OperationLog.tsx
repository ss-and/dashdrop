/**
 * 「その他の操作」 — the non-import activity trail (レコードの追加・更新・削除、
 * オブジェクトの作成) as a calm, single-line-per-event list. Deliberately quiet:
 * the import history above is the main story, this is the background noise that
 * explains where a change came from.
 */

export interface OperationLogItem {
  id: string;
  /** 表示用の日時（YYYY/MM/DD HH:mm）。 */
  at: string;
  /** 日本語ラベル（未知の種別はそのまま生の type）。 */
  label: string;
}

export function OperationLog({ items }: { items: OperationLogItem[] }) {
  if (items.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-faint">
        記録された操作はまだありません
      </p>
    );
  }

  return (
    <ul className="divide-y divide-ink-line">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-4 py-2">
          <span className="shrink-0 tabular-nums text-xs text-ink-faint">
            {item.at}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
