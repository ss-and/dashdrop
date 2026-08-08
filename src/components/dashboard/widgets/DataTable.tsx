import { displayValue, isFieldType } from "@/lib/field-types";
import type { TableData } from "@/lib/widgets";

/**
 * Compact data table widget: sticky header, zebra rows, low radius. Cells are
 * formatted through the field-type registry so numbers/currency/dates render
 * consistently with the rest of the app. Scrolls inside its own container so a
 * wide table never widens the page.
 */

function renderCell(type: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (isFieldType(type)) return displayValue(type, value) || "—";
  return String(value);
}

export function DataTable({ data }: { data: TableData }) {
  const { columns, rows } = data;

  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="flex h-40 w-full items-center justify-center text-sm text-ink-faint">
        データなし
      </div>
    );
  }

  return (
    <div className="max-h-80 overflow-auto rounded-md border border-ink-line">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-paper-sunken">
            {columns.map((c) => (
              <th
                key={c.key}
                className="whitespace-nowrap border-b border-ink-line px-3 py-2 text-left text-xs font-semibold text-ink-soft"
              >
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={i % 2 === 1 ? "bg-paper-sunken/40" : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className="whitespace-nowrap border-b border-ink-line px-3 py-2 text-ink tabular-nums"
                >
                  {renderCell(c.type, row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
