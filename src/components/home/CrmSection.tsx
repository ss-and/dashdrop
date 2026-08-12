/**
 * 顧客データベース section of the home page.
 *
 * Renders one Salesforce-style list view per CRM object (顧客 / 商談 / 担当者 /
 * 活動): a compact card with the record count, a link to the full sheet, and the
 * most recent rows. Every row's primary cell links to that record's detail page
 * (`/r/{collectionId}/{recordId}`), and relation cells link straight through to
 * the linked record — so the whole database is navigable by hyperlink.
 *
 * Pure presentation: the page (server component) does all the loading and hands
 * this component resolved values + relation labels.
 */
import Link from "next/link";
import { Badge, toneFromColor } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { CollectionIcon, NavIcon } from "@/components/app/icons";
import {
  displayValue,
  isFieldType,
  type SelectOption,
} from "@/lib/field-types";

export interface CrmColumn {
  key: string;
  name: string;
  /** Field type from the stored Field row (may be any string). */
  type: string;
  options?: SelectOption[] | null;
  /** For `relation` columns: the collection the link points at. */
  targetCollectionId?: string | null;
}

export interface CrmRow {
  id: string;
  /** Stored data merged with resolved lookup/rollup values. */
  values: Record<string, unknown>;
}

export interface CrmObjectView {
  slug: string;
  name: string;
  icon: string;
  description: string;
  collectionId: string;
  count: number;
  /** Field key whose cell labels the record and links to its detail page. */
  primaryKey: string;
  columns: CrmColumn[];
  rows: CrmRow[];
  /** relationLabels[fieldKey][linkedRecordId] = 表示名 */
  relationLabels: Record<string, Record<string, string>>;
}

const NUMERIC = new Set(["number", "currency", "rollup"]);

function asIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string" && value) return [value];
  return [];
}

function formatDate(value: unknown): string {
  if (value instanceof Date) {
    return `${value.getFullYear()}/${String(value.getMonth() + 1).padStart(2, "0")}/${String(
      value.getDate(),
    ).padStart(2, "0")}`;
  }
  const s = String(value ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return s;
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/** Plain text for a cell (no links / badges) — also used for the name cell. */
function cellText(col: CrmColumn, value: unknown): string {
  if (isEmptyValue(value)) return "";
  if (col.type === "date") return formatDate(value);
  if (col.type === "select") {
    const opt = col.options?.find((o) => o.value === String(value));
    return opt?.label ?? String(value);
  }
  if (isFieldType(col.type)) return displayValue(col.type, value);
  return String(value);
}

function Cell({
  view,
  col,
  row,
}: {
  view: CrmObjectView;
  col: CrmColumn;
  row: CrmRow;
}) {
  const value = row.values[col.key];

  // Primary (name) cell — always a link to the record detail page.
  if (col.key === view.primaryKey) {
    return (
      <Link
        href={`/r/${view.collectionId}/${row.id}`}
        className="font-medium text-khaki-700 hover:text-khaki-800 hover:underline"
      >
        {cellText(col, value) || "（無題）"}
      </Link>
    );
  }

  if (col.type === "relation") {
    const ids = asIds(value);
    if (ids.length === 0) return <span className="text-ink-faint">—</span>;
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {ids.map((id) => {
          const label = view.relationLabels[col.key]?.[id] ?? "（無題）";
          return col.targetCollectionId ? (
            <Link
              key={id}
              href={`/r/${col.targetCollectionId}/${id}`}
              className="text-khaki-700 hover:text-khaki-800 hover:underline"
            >
              {label}
            </Link>
          ) : (
            <span key={id}>{label}</span>
          );
        })}
      </span>
    );
  }

  if (isEmptyValue(value)) return <span className="text-ink-faint">—</span>;

  if (col.type === "select") {
    const opt = col.options?.find((o) => o.value === String(value));
    return (
      <Badge tone={toneFromColor(opt?.color)}>
        {opt?.label ?? String(value)}
      </Badge>
    );
  }

  if (col.type === "multiselect" && Array.isArray(value)) {
    return (
      <span className="inline-flex flex-wrap gap-1">
        {value.map((v) => {
          const opt = col.options?.find((o) => o.value === String(v));
          return (
            <Badge key={String(v)} tone={toneFromColor(opt?.color)}>
              {opt?.label ?? String(v)}
            </Badge>
          );
        })}
      </span>
    );
  }

  if (col.type === "checkbox") {
    return value ? (
      <span className="text-success">✓</span>
    ) : (
      <span className="text-ink-faint">—</span>
    );
  }

  return <span>{cellText(col, value) || "—"}</span>;
}

function ObjectCard({ view }: { view: CrmObjectView }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-ink-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <CollectionIcon
            name={view.icon}
            className="h-4 w-4 shrink-0 text-khaki-500"
          />
          <Link
            href={`/c/${view.collectionId}`}
            className="truncate text-sm font-semibold text-ink hover:text-khaki-700"
          >
            {view.name}
          </Link>
          <span className="shrink-0 tabular-nums text-2xs font-medium text-ink-faint">
            {view.count.toLocaleString()} 件
          </span>
        </div>
        <Link
          href={`/c/${view.collectionId}`}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-khaki-700 hover:text-khaki-800 hover:underline"
        >
          すべて見る
          <NavIcon name="chevron" className="h-3 w-3" />
        </Link>
      </div>

      {view.rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8">
          <p className="text-sm text-ink-faint">まだデータがありません</p>
          <Link
            href={`/c/${view.collectionId}`}
            className="text-xs font-medium text-khaki-700 hover:text-khaki-800 hover:underline"
          >
            {view.name}のシートを開いて入力する
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-paper-sunken text-2xs uppercase tracking-wider text-ink-faint">
                {view.columns.map((c) => (
                  <th
                    key={c.key}
                    className={`whitespace-nowrap px-4 py-2 font-semibold ${
                      NUMERIC.has(c.type) ? "text-right" : "text-left"
                    }`}
                  >
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-line">
              {view.rows.map((row) => (
                <tr key={row.id} className="hover:bg-paper-sunken/60">
                  {view.columns.map((c) => (
                    <td
                      key={c.key}
                      className={`whitespace-nowrap px-4 py-2 align-middle text-ink ${
                        NUMERIC.has(c.type)
                          ? "text-right tabular-nums"
                          : "text-left"
                      }`}
                    >
                      <Cell view={view} col={c} row={row} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function CrmSection({ views }: { views: CrmObjectView[] }) {
  if (views.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">顧客データベース</h3>
        <p className="text-xs text-ink-muted">
          行をクリックすると、その顧客・商談の詳細が開きます
        </p>
      </div>
      <div className="space-y-4">
        {views.map((v) => (
          <ObjectCard key={v.slug} view={v} />
        ))}
      </div>
    </section>
  );
}
