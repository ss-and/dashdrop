/**
 * Shared value rendering for the Salesforce-style record page.
 *
 * One place decides how a stored cell value becomes readable output — select
 * badges, ¥ amounts, mailto/tel/external links, and (the point of the whole
 * page) relation values rendered as hyperlinks to the linked record's own
 * detail page. Used by the header highlights, the 詳細 card and every related
 * list so a value always looks the same wherever it appears.
 *
 * Server component: no interactivity, just markup.
 */
import Link from "next/link";
import { Badge, toneFromColor } from "@/components/ui/Badge";
import {
  displayValue,
  isComputedField,
  isFieldType,
  type SelectOption,
} from "@/lib/field-types";

/** The minimal field shape the record page needs (matches Prisma's Field). */
export interface RecordFieldDef {
  key: string;
  name: string;
  /** Prisma stores the type as a plain string. */
  type: string;
  options?: unknown;
  config?: unknown;
}

/** One resolved row: raw data plus the computed lookup/rollup bag. */
export interface ResolvedRow {
  id: string;
  data: Record<string, unknown>;
  computed: Record<string, unknown>;
}

/** relationLabels[fieldKey][recordId] = 表示名 */
export type RelationLabels = Record<string, Record<string, string>>;

export const NUMERIC_TYPES = new Set(["number", "currency", "rollup"]);

export function fieldOptions(field: RecordFieldDef): SelectOption[] {
  return Array.isArray(field.options) ? (field.options as SelectOption[]) : [];
}

/** Target collection of a relation field, or null when unconfigured. */
export function relationTarget(field: RecordFieldDef): string | null {
  const cfg = (field.config ?? null) as { targetCollectionId?: string } | null;
  return cfg?.targetCollectionId ?? null;
}

/** Relation values are stored as an array of target record ids. */
export function toIdArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string" && value) return [value];
  return [];
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function EmptyValue() {
  return <span className="text-ink-faint">—</span>;
}

/** YYYY/MM/DD from an ISO date (or anything Date can parse). */
export function formatDate(value: unknown): string {
  const s = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}/${iso[2]}/${iso[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}/${mm}/${dd}`;
}

function formatNumber(value: unknown): string {
  const n =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[,\s¥]/g, ""));
  return Number.isFinite(n)
    ? new Intl.NumberFormat("ja-JP").format(n)
    : String(value);
}

function OptionBadge({
  options,
  value,
}: {
  options: SelectOption[];
  value: unknown;
}) {
  const opt = options.find((o) => o.value === String(value));
  const label = opt?.label ?? String(value);
  // Only coloured options earn a badge; plain choices stay quiet text.
  if (!opt?.color) return <span className="text-ink">{label}</span>;
  return <Badge tone={toneFromColor(opt.color)}>{label}</Badge>;
}

/**
 * Render one field's value for a record.
 *
 * `numericAlign` right-aligns number/currency (used in the 詳細 card and in
 * related-list tables, where amounts line up as a column).
 */
export function RecordValue({
  field,
  data,
  computed,
  relationLabels,
  numericAlign = false,
}: {
  field: RecordFieldDef;
  data: Record<string, unknown>;
  computed?: Record<string, unknown>;
  relationLabels?: RelationLabels;
  numericAlign?: boolean;
}) {
  const computedField = isComputedField(field.type);
  const value = computedField ? computed?.[field.key] : data[field.key];

  if (field.type === "checkbox") {
    return <span className="text-ink">{value ? "はい" : "いいえ"}</span>;
  }

  if (isEmpty(value)) return <EmptyValue />;

  switch (field.type) {
    case "relation": {
      const ids = toIdArray(value);
      if (ids.length === 0) return <EmptyValue />;
      const target = relationTarget(field);
      const labels = relationLabels?.[field.key] ?? {};
      return (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {ids.map((id) => {
            const label = labels[id];
            // A deleted / unreachable target must not become a broken link.
            if (!label || !target) {
              return (
                <span key={id} className="text-xs text-ink-faint">
                  {label ?? id}
                </span>
              );
            }
            return (
              <Link
                key={id}
                href={`/r/${target}/${id}`}
                className="text-khaki-700 underline-offset-2 hover:underline"
              >
                {label}
              </Link>
            );
          })}
        </span>
      );
    }

    case "select":
      return <OptionBadge options={fieldOptions(field)} value={value} />;

    case "multiselect": {
      const arr = Array.isArray(value) ? value : [value];
      return (
        <span className="inline-flex flex-wrap gap-1">
          {arr.map((v, i) => (
            <OptionBadge key={`${String(v)}-${i}`} options={fieldOptions(field)} value={v} />
          ))}
        </span>
      );
    }

    case "date":
      return <span className="text-ink">{formatDate(value)}</span>;

    case "number":
      return (
        <span
          className={`tabular-nums text-ink ${numericAlign ? "block text-right" : ""}`}
        >
          {formatNumber(value)}
        </span>
      );

    case "currency":
      return (
        <span
          className={`tabular-nums text-ink ${numericAlign ? "block text-right" : ""}`}
        >
          ¥{formatNumber(value)}
        </span>
      );

    case "email":
      return (
        <a
          href={`mailto:${String(value)}`}
          className="text-khaki-700 underline-offset-2 hover:underline"
        >
          {String(value)}
        </a>
      );

    case "phone":
      return (
        <a
          href={`tel:${String(value).replace(/[^\d+]/g, "")}`}
          className="text-khaki-700 underline-offset-2 hover:underline"
        >
          {String(value)}
        </a>
      );

    case "url":
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-khaki-700 underline-offset-2 hover:underline"
        >
          {String(value)}
        </a>
      );

    case "longtext":
      return (
        <span className="block whitespace-pre-wrap text-ink">{String(value)}</span>
      );

    case "lookup":
      return (
        <span className="text-ink">
          {Array.isArray(value) ? value.join("、") : String(value)}
        </span>
      );

    case "rollup":
      return (
        <span
          className={`tabular-nums text-ink ${numericAlign ? "block text-right" : ""}`}
        >
          {formatNumber(value)}
        </span>
      );

    default: {
      const text = isFieldType(field.type)
        ? displayValue(field.type, value)
        : String(value);
      return <span className="text-ink">{text || "—"}</span>;
    }
  }
}

/** Plain-text rendering of a field value — used for the page title. */
export function recordValueText(
  field: RecordFieldDef,
  data: Record<string, unknown>,
): string {
  const raw = data[field.key];
  if (raw === null || raw === undefined || raw === "") return "";
  if (field.type === "select" || field.type === "multiselect") {
    const opts = fieldOptions(field);
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr
      .map((v) => opts.find((o) => o.value === String(v))?.label ?? String(v))
      .join("、");
  }
  if (field.type === "date") return formatDate(raw);
  return isFieldType(field.type) ? displayValue(field.type, raw) : String(raw);
}
