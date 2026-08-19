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
  // Analysis types (computed on read):
  "formula", // an expression over this row's other fields — 粗利 = 売上 - 原価
  "vlookup", // pull/aggregate a value from another sheet matched on a key column
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Field types derived from other data and never written directly. */
export const COMPUTED_FIELD_TYPES: readonly FieldType[] = [
  "lookup",
  "rollup",
  "formula",
  "vlookup",
];
export function isComputedField(type: string): boolean {
  return (COMPUTED_FIELD_TYPES as readonly string[]).includes(type);
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
  formula: {
    type: "formula",
    label: "Formula",
    description: "この行の他の項目から計算（粗利＝売上−原価 など）",
    numeric: true,
    optioned: false,
  },
  vlookup: {
    type: "vlookup",
    label: "Sheet lookup",
    description: "別シートをキーで突合して値を引く（VLOOKUP相当）",
    numeric: false,
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
/**
 * 日本のビジネス文書に出てくる数の書き方を読む。
 *
 * 取り込み時に列の型を「数値」に直すと、`1,234円` `▲500` `１２３` `15%` が
 * すべて弾かれて空欄になっていた。利用者から見ると「正しい型を選んだのに
 * 中身が消えた」という最悪の挙動で、文字列のまま諦めるしか無かった。
 *
 * 読める書き方:
 *   1,234 / ￥1,234 / 1,234円 / 1234.5
 *   ▲500 / △500 / (500) / -500      … 会計表記の負数
 *   １２３                            … 全角
 *   15%                              … 0.15 として読む
 *   1,234万 / 5億                     … 万・億
 *
 * 読めないものは null を返す（当て推量で数にしない）。
 */
export function parseJapaneseNumber(input: string): number | null {
  let s = input.normalize("NFKC").trim();
  if (s === "") return null;

  let sign = 1;
  // ▲ / △ は会計の負数表記。括弧書きも同じ意味。
  if (/^[▲△]/.test(s)) {
    sign = -1;
    s = s.slice(1).trim();
  } else if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1).trim();
  }

  const percent = s.endsWith("%");
  if (percent) s = s.slice(0, -1).trim();

  // 通貨記号・桁区切り・円/圓 を落とす。
  s = s.replace(/[¥$€£]/g, "").replace(/,/g, "").replace(/[円圓]$/u, "").trim();

  // 万・億（1,234万 = 12,340,000）。組み合わせは扱わない。
  let scale = 1;
  const unit = /^(.*?)(万|億|兆)$/u.exec(s);
  if (unit) {
    s = unit[1].trim();
    scale = unit[2] === "万" ? 1e4 : unit[2] === "億" ? 1e8 : 1e12;
  }

  if (s === "" || !/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;

  const scaled = n * scale * sign;
  return percent ? scaled / 100 : scaled;
}

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
      if (typeof raw === "number") {
        return Number.isFinite(raw)
          ? { ok: true, value: raw }
          : { ok: false, value: raw, error: "数値として読み取れません" };
      }
      const n = parseJapaneseNumber(String(raw));
      if (n === null) {
        return { ok: false, value: raw, error: "数値として読み取れません" };
      }
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
    case "formula":
    case "vlookup":
      // Computed on read; may legitimately be null (no match / not calculable),
      // which must read as blank rather than the string "null".
      if (value === null || value === undefined) return "";
      if (Array.isArray(value)) return value.join(", ");
      if (typeof value === "boolean") return value ? "true" : "false";
      return typeof value === "number"
        ? new Intl.NumberFormat("en-US").format(value)
        : String(value);
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
/**
 * 先頭ゼロを持つ「数字に見えるが数値ではない」値。
 *
 * 郵便番号 0600001、社員番号 0012、商品コード 007、電話 0312345678 —
 * どれも数値にすると先頭のゼロが消えて別物になる。桁数が揃っている
 * ことが多いので、`0` で始まり2桁以上なら数値とは見なさない。
 * 「0」「0.5」「-0.3」のような本物の数はここに入らない。
 */
const LEADING_ZERO_RE = /^0\d/;

function looksLikeCode(v: unknown): boolean {
  return typeof v !== "number" && LEADING_ZERO_RE.test(String(v).trim());
}

/** 真偽値として読める文字列（0/1 は含めない。下の注記を参照）。 */
const BOOLEAN_WORDS = [
  "true",
  "false",
  "yes",
  "no",
  "はい",
  "いいえ",
  "有",
  "無",
  "○",
  "×",
];

export function inferFieldType(samples: unknown[]): FieldType {
  const values = samples
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
    .map((v) => (v instanceof Date ? v : v))
    .slice(0, 50);

  if (values.length === 0) return "text";

  const test = (pred: (v: unknown) => boolean) => values.every(pred);

  if (test((v) => typeof v === "boolean")) return "checkbox";
  // 0/1 を真偽値扱いしない。数量・在庫・件数の列は小さい値だけのことが普通に
  // あり、`1,0,1` という数量列がチェックボックスになって true/false として
  // 保存されてしまっていた。真偽値だと分かる語だけを見る。
  if (
    test((v) => BOOLEAN_WORDS.includes(String(v).trim().toLowerCase()))
  )
    return "checkbox";
  // 数値の判定は coerceValue と同じ読み方（parseJapaneseNumber）を使う。
  // ここだけ別の読み方をしていたため、`▲500` や `￥88,000` を含む金額列が
  // text と判定され、利用者が型を「数値」に直すと全部の値が消えていた。
  // ％ は「0.15 として保存される」のが直感に反するので、推定では数値にしない
  // （利用者が明示的に数値型を選んだ場合だけ換算する）。
  if (
    test(
      (v) =>
        typeof v === "number" ||
        (String(v).trim() !== "" &&
          !String(v).includes("%") &&
          !String(v).includes("％") &&
          parseJapaneseNumber(String(v)) !== null),
    ) &&
    // 先頭ゼロが1件でもあれば、その列は数値ではなくコード。1件でも壊したら
    // 取り返しがつかないので、多数決ではなく「1件でもあれば」で判断する。
    !values.some(looksLikeCode)
  ) {
    // 通貨記号や「円」が付いていれば通貨列として扱う。
    const CURRENCY_MARK = /[¥￥$€£]|円|圓/u;
    return values.some((v) => CURRENCY_MARK.test(String(v)))
      ? "currency"
      : "number";
  }
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
