/**
 * Record page header — the Salesforce "highlights panel".
 *
 * Breadcrumb (file → object) above, the record's display name as the page
 * title, a row of up to four key fields beneath it, and the actions on the
 * right. Purely presentational; the page decides which fields are "key".
 */
import Link from "next/link";
import { CollectionIcon, NavIcon } from "@/components/app/icons";
import {
  RecordValue,
  type RecordFieldDef,
  type RelationLabels,
} from "./RecordValue";

export function RecordHeader({
  title,
  collectionId,
  collectionName,
  collectionIcon,
  workbook,
  highlights,
  data,
  computed,
  relationLabels,
}: {
  title: string;
  collectionId: string;
  collectionName: string;
  collectionIcon: string;
  workbook: { id: string; name: string } | null;
  highlights: RecordFieldDef[];
  data: Record<string, unknown>;
  computed: Record<string, unknown>;
  relationLabels: RelationLabels;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-ink-line bg-paper-raised">
            <CollectionIcon name={collectionIcon} className="h-5 w-5 text-khaki-500" />
          </span>
          <div className="min-w-0">
            {/* Breadcrumb: ファイル › スプレッドシート */}
            <nav
              aria-label="パンくずリスト"
              className="flex flex-wrap items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-ink-faint"
            >
              {workbook && (
                <>
                  <Link
                    href={`/f/${workbook.id}`}
                    className="flex items-center gap-1 hover:text-khaki-700 hover:underline"
                  >
                    <NavIcon name="folder" className="h-3 w-3" />
                    <span className="truncate">{workbook.name}</span>
                  </Link>
                  <NavIcon name="chevron" className="h-3 w-3" />
                </>
              )}
              <Link
                href={`/c/${collectionId}`}
                className="hover:text-khaki-700 hover:underline"
              >
                {collectionName}
              </Link>
            </nav>
            <h2 className="mt-0.5 break-words text-xl font-semibold text-ink">
              {title}
            </h2>
          </div>
        </div>

        <div className="flex shrink-0 items-start gap-2">
          <Link
            href={`/c/${collectionId}`}
            className="inline-flex h-9 items-center gap-2 rounded border border-ink-line bg-paper-raised px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-sunken"
          >
            <NavIcon name="table" className="h-4 w-4" />
            スプレッドシートで開く
          </Link>
        </div>
      </div>

      {highlights.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-ink-line pt-4 md:grid-cols-4">
          {highlights.map((f) => (
            <div key={f.key} className="min-w-0">
              <dt className="truncate text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                {f.name}
              </dt>
              <dd className="mt-1 truncate text-sm">
                <RecordValue
                  field={f}
                  data={data}
                  computed={computed}
                  relationLabels={relationLabels}
                />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
