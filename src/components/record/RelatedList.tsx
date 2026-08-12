/**
 * A related list — the Salesforce hallmark.
 *
 * One card per child collection that links AT this record: a compact table of
 * the linking rows, each one's primary cell hyperlinked to its own record page,
 * plus a すべて見る escape hatch back to the spreadsheet. Relation cells inside
 * the list are themselves links, so you can keep clicking through the graph.
 */
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import {
  NUMERIC_TYPES,
  RecordValue,
  recordValueText,
  type RecordFieldDef,
  type RelationLabels,
  type ResolvedRow,
} from "./RecordValue";

export interface RelatedListData {
  /** Stable key: child collection id + the relation field that links here. */
  key: string;
  collectionId: string;
  title: string;
  /** Shown when one collection links here through several relation fields. */
  subtitle?: string;
  total: number;
  columns: RecordFieldDef[];
  rows: ResolvedRow[];
  relationLabels: RelationLabels;
}

export function RelatedList({ list }: { list: RelatedListData }) {
  const { columns, rows } = list;
  const primary = columns[0];

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="truncate">
            {list.title}
            <span className="ml-2 text-sm font-normal text-ink-muted">
              {list.total}件
            </span>
          </CardTitle>
          {list.subtitle && (
            <p className="mt-0.5 text-2xs text-ink-faint">{list.subtitle}</p>
          )}
        </div>
        <Link
          href={`/c/${list.collectionId}`}
          className="shrink-0 text-sm text-khaki-700 underline-offset-2 hover:underline"
        >
          すべて見る
        </Link>
      </CardHeader>
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-paper-sunken">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`whitespace-nowrap border-b border-ink-line px-4 py-2 text-xs font-semibold text-ink-soft ${
                      NUMERIC_TYPES.has(c.type) ? "text-right" : "text-left"
                    }`}
                  >
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-paper-sunken/50">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`border-b border-ink-line/70 px-4 py-2 align-top text-ink ${
                        NUMERIC_TYPES.has(c.type) ? "text-right" : "text-left"
                      }`}
                    >
                      {primary && c.key === primary.key ? (
                        <Link
                          href={`/r/${list.collectionId}/${row.id}`}
                          className="font-medium text-khaki-700 underline-offset-2 hover:underline"
                        >
                          {recordValueText(c, row.data) || "（無題）"}
                        </Link>
                      ) : (
                        <RecordValue
                          field={c}
                          data={row.data}
                          computed={row.computed}
                          relationLabels={list.relationLabels}
                          numericAlign={NUMERIC_TYPES.has(c.type)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.total > rows.length && (
          <div className="border-t border-ink-line px-4 py-2 text-xs text-ink-muted">
            {rows.length}件を表示中（全{list.total}件）
          </div>
        )}
      </CardBody>
    </Card>
  );
}
