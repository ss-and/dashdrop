import { displayValue, isFieldType, type SelectOption } from "@/lib/field-types";
import { Badge, toneFromColor } from "@/components/ui/Badge";
import type { TableData } from "@/lib/widgets";

/**
 * Compact data table widget: sticky header, zebra rows, low radius. Cells are
 * rendered the same way as the spreadsheet grid — select/multiselect values map
 * to their option labels and render as Badges; numbers/currency/dates format
 * through the field-type registry. Scrolls inside its own container so a wide
 * table never widens the page.
 */

type Column = TableData["columns"][number];

function optionFor(options: SelectOption[] | null | undefined, value: unknown) {
  if (!options) return undefined;
  return options.find((o) => o.value === String(value));
}

function Cell({ col, value }: { col: Column; value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-ink-faint">—</span>;
  }

  if (col.type === "select") {
    const opt = optionFor(col.options, value);
    return (
      <Badge tone={toneFromColor(opt?.color)}>{opt?.label ?? String(value)}</Badge>
    );
  }

  if (col.type === "multiselect" && Array.isArray(value)) {
    return (
      <span className="inline-flex flex-wrap gap-1">
        {value.map((v) => {
          const opt = optionFor(col.options, v);
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
    return value ? <span className="text-success">✓</span> : <span className="text-ink-faint">—</span>;
  }

  const text = isFieldType(col.type)
    ? displayValue(col.type, value) || "—"
    : String(value);
  return <span>{text}</span>;
}

const NUMERIC = new Set(["number", "currency"]);

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
                className={`whitespace-nowrap border-b border-ink-line px-3 py-2 text-xs font-semibold text-ink-soft ${
                  NUMERIC.has(c.type) ? "text-right" : "text-left"
                }`}
              >
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-paper-sunken/50">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`whitespace-nowrap border-b border-ink-line px-3 py-2 text-ink ${
                    NUMERIC.has(c.type) ? "text-right tabular-nums" : "text-left"
                  }`}
                >
                  <Cell col={c} value={row[c.key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
