/**
 * Field-type registry — the metadata that makes DashDrop a database.
 *
 * Every Collection Field has a `type` drawn from FIELD_TYPES. This module is
 * the single source of truth for how each type is labelled, validated,
 * coerced from raw input, and inferred from spreadsheet samples. Both the
 * database engine and the Excel importer depend on it.
 */

export const FIELD_TYPES = [
  "text",
  "longtext",
  "number",
  "currency",
  "select",
  "multiselect",
  "date",
  "checkbox",
  "email",
  "phone",
  "url",
  // Cross-spreadsheet types (see src/lib/relations.ts):
  "relation", // link to record(s) in another spreadsheet; value = target record id(s)
  "lookup", // pull a field from linked records (computed, read-only)
  "rollup", // aggregate a field across linked records (computed, read-only)
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Field types whose value is computed from links and never written directly. */
export const COMPUTED_FIELD_TYPES: readonly FieldType[] = ["lookup", "rollup"];
export function isComputedField(type: string): boolean {
  return type === "lookup" || type === "rollup";
}

export interface SelectOption {
  label: string;
  value: string;
  color?: string;
}

export interface FieldTypeMeta {
  type: FieldType;
  label: string;
  description: string;
  /** True for types whose values are numeric (for aggregation/charts). */
  numeric: boolean;
  /** True for types that carry a fixed option set. */
  optioned: boolean;
}

export const FIELD_TYPE_META: Record<FieldType, FieldTypeMeta> = {
  text: {
    type: "text",
    label: "Text",
    description: "Single line of text",
    numeric: false,
    optioned: false,
  },
  longtext: {
    type: "longtext",
    label: "Long text",
    description: "Multi-line notes",
    numeric: false,
    optioned: false,
  },
  number: {
    type: "number",
    label: "Number",
    description: "Numeric value",
    numeric: true,
    optioned: false,
  },
  currency: {
    type: "currency",
    label: "Currency",
    description: "Monetary amount",
    numeric: true,
    optioned: false,
  },
  select: {
    type: "select",
    label: "Select",
    description: "One choice from a list",
    numeric: false,
    optioned: true,
  },
  multiselect: {
    type: "multiselect",
    label: "Multi-select",
    description: "Several choices from a list",
    numeric: false,
    optioned: true,
  },
  date: {
    type: "date",
    label: "Date",
    description: "Calendar date",
    numeric: false,
    optioned: false,
  },
  checkbox: {
    type: "checkbox",
    label: "Checkbox",
    description: "True / false",
    numeric: false,
    optioned: false,
  },
  email: {
    type: "email",
    label: "Email",
    description: "Email address",
    numeric: false,
    optioned: false,
  },
  phone: {
    type: "phone",
    label: "Phone",
    description: "Phone number",
    numeric: false,
    optioned: false,
  },
  url: {
    type: "url",
    label: "URL",
    description: "Web link",
    numeric: false,
    optioned: false,
  },
  relation: {
    type: "relation",
    label: "リンク（他シート参照）",
    description: "別スプレッドシートのレコードにリンク",
    numeric: false,
    optioned: false,
  },
  lookup: {
    type: "lookup",
    label: "ルックアップ（参照値）",
    description: "リンク先のフィールド値を表示（自動）",
    numeric: false,
    optioned: false,
  },
  rollup: {
    type: "rollup",
    label: "ロールアップ（集計）",
    description: "リンク先の値を合計/件数などで集計（自動）",
    numeric: true,
    optioned: false,
  },
};

export function isFieldType(v: unknown): v is FieldType {
  return typeof v === "string" && (FIELD_TYPES as readonly string[]).includes(v);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CoerceResult {
  ok: boolean;
  value: unknown;
  error?: string;
}

/**
 * Coerce a raw cell value (from user input or a spreadsheet) into the
 * canonical stored representation for a field type. Empty values normalise to
 * null. Returns { ok:false, error } when the value is present but invalid.
 */
export function coerceValue(
  type: FieldType,
  raw: unknown,
  options?: SelectOption[],
): CoerceResult {
  // Normalise emptiness (but keep boolean false / number 0).
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }

  switch (type) {
    case "text":
    case "longtext":
    case "phone": {
      return { ok: true, value: String(raw).trim() };
    }
    case "email": {
      const s = String(raw).trim();
      if (!EMAIL_RE.test(s)) return { ok: false, value: raw, error: "Invalid email" };
      return { ok: true, value: s };
    }
    case "url": {
      let s = String(raw).trim();
      if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
      if (!URL_RE.test(s)) return { ok: false, value: raw, error: "Invalid URL" };
      return { ok: true, value: s };
    }
    case "number":
    case "currency": {
      const n =
        typeof raw === "number"
          ? raw
          : Number(String(raw).replace(/[,\s¥$€£]/g, ""));
      if (!Number.isFinite(n)) return { ok: false, value: raw, error: "Not a number" };
      return { ok: true, value: n };
    }
    case "checkbox": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const s = String(raw).trim().toLowerCase();
      const truthy = ["true", "1", "yes", "y", "✓", "done", "はい", "済"];
      const falsy = ["false", "0", "no", "n", "", "未", "いいえ"];
      if (truthy.includes(s)) return { ok: true, value: true };
      if (falsy.includes(s)) return { ok: true, value: false };
      return { ok: true, value: Boolean(raw) };
    }
    case "date": {
      // Accept ISO, Date, or Excel-style already-parsed dates.
      if (raw instanceof Date) {
        return { ok: true, value: raw.toISOString().slice(0, 10) };
      }
      const s = String(raw).trim();
      if (DATE_RE.test(s)) return { ok: true, value: s };
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return { ok: false, value: raw, error: "Invalid date" };
      return { ok: true, value: d.toISOString().slice(0, 10) };
    }
    case "select": {
      const s = String(raw).trim();
      if (options && options.length > 0) {
        const match = options.find(
          (o) => o.value === s || o.label.toLowerCase() === s.toLowerCase(),
        );
        return { ok: true, value: match ? match.value : s };
      }
      return { ok: true, value: s };
    }
    case "multiselect": {
      const arr = Array.isArray(raw)
        ? raw.map((v) => String(v).trim())
        : String(raw)
            .split(/[,;、]/)
            .map((v) => v.trim())
            .filter(Boolean);
      return { ok: true, value: arr };
    }
    case "relation": {
      // Store as an array of linked target-record ids (validated elsewhere).
      const arr = Array.isArray(raw)
        ? raw.map((v) => String(v).trim()).filter(Boolean)
        : String(raw)
            .split(/[,;、]/)
            .map((v) => v.trim())
            .filter(Boolean);
      return { ok: true, value: arr };
    }
    case "lookup":
    case "rollup":
      // Computed on read from linked records; never written directly.
      return { ok: true, value: null };
    default:
      return { ok: true, value: String(raw) };
  }
}

/** Human-readable rendering of a stored value for a field type. */
export function displayValue(type: FieldType, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  switch (type) {
    case "checkbox":
      return value ? "✓" : "";
    case "currency":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "JPY",
            maximumFractionDigits: 0,
          }).format(value)
        : String(value);
    case "number":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-US").format(value)
        : String(value);
    case "multiselect":
    case "lookup":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "rollup":
      return typeof value === "number"
        ? new Intl.NumberFormat("en-US").format(value)
        : value === null || value === undefined
          ? ""
          : String(value);
    case "relation":
      // Grid resolves ids -> labels; fallback shows the count.
      return Array.isArray(value)
        ? value.length
          ? `${value.length}件`
          : ""
        : String(value ?? "");
    default:
      return String(value);
  }
}

/**
 * Infer the most likely field type from a column of sample values.
 * Used by the Excel importer to auto-build a schema.
 */
export function inferFieldType(samples: unknown[]): FieldType {
  const values = samples
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
    .map((v) => (v instanceof Date ? v : v))
    .slice(0, 50);

  if (values.length === 0) return "text";

  const test = (pred: (v: unknown) => boolean) => values.every(pred);

  if (test((v) => typeof v === "boolean")) return "checkbox";
  if (
    test((v) => {
      const s = String(v).trim().toLowerCase();
      return ["true", "false", "yes", "no", "0", "1"].includes(s);
    })
  )
    return "checkbox";
  if (
    test(
      (v) =>
        typeof v === "number" ||
        (String(v).trim() !== "" && Number.isFinite(Number(String(v).replace(/[,\s]/g, "")))),
    )
  )
    return "number";
  if (test((v) => v instanceof Date || DATE_RE.test(String(v).trim()) || !Number.isNaN(Date.parse(String(v)))) &&
      values.some((v) => v instanceof Date || DATE_RE.test(String(v).trim())))
    return "date";
  if (test((v) => EMAIL_RE.test(String(v).trim()))) return "email";
  if (test((v) => URL_RE.test(String(v).trim()))) return "url";

  // Low-cardinality string columns become selects.
  const distinct = new Set(values.map((v) => String(v).trim().toLowerCase()));
  if (distinct.size <= Math.max(2, Math.min(8, values.length / 3)) && distinct.size < values.length) {
    return "select";
  }

  const maxLen = Math.max(...values.map((v) => String(v).length));
  return maxLen > 80 ? "longtext" : "text";
}
