/**
 * 検索の「一致したか」だけを取り出した純粋なモジュール。
 *
 * ルート（/api/search）から切り出してあるのは、DBを立てずに突き合わせの規則
 * そのものをテストできるようにするため（tests/search.test.ts）。検索UIと同じ
 * ディレクトリに置いているのは、「画面に出ている文字で引ける」という約束が
 * 表示側と一体だから。
 *
 * 直している不具合: multiselect の値は配列なので `String(["other"])` は
 * "other"（Chrome では "other" だが複数選択だと "a,b"）となり、選択肢の
 * value とは一致しない。そのため保存されているコードのまま扱われ、画面に
 * 「その他」と出ているのに「その他」では引けず `other` では引ける、という
 * 逆転が起きていた。
 */
import { displayValue, isFieldType, type FieldType } from "@/lib/field-types";

/** 検索対象にするフィールドの、DBから読んだままの形。 */
export interface RawSearchField {
  key: string;
  name: string;
  type: string;
  options: unknown;
}

/** 選択肢のラベル表を1度だけ作ってある、突き合わせ用のフィールド。 */
export interface PreparedField {
  key: string;
  name: string;
  type: FieldType;
  /** 保存値 → 表示ラベル。選択肢を持たない型では空。 */
  labels: Map<string, string>;
}

/**
 * 選択肢配列から「保存値 → ラベル」を作る。ラベルが空のものは入れない
 * （空文字で上書きすると、何が入っているのか画面から分からなくなる）。
 */
export function optionLabels(options: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(options)) return map;
  for (const raw of options) {
    if (!raw || typeof raw !== "object") continue;
    const { value, label } = raw as { value?: unknown; label?: unknown };
    if (typeof value !== "string" || typeof label !== "string" || label === "")
      continue;
    map.set(value, label);
  }
  return map;
}

/** 未知の型は text として扱う（保存されている文字列でとにかく引けるように）。 */
export function prepareField(field: RawSearchField): PreparedField {
  return {
    key: field.key,
    name: field.name,
    type: isFieldType(field.type) ? field.type : "text",
    labels: optionLabels(field.options),
  };
}

/** 値が「空」か。空配列も空として扱う（`[]` は表示上なにも出ない）。 */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  return Array.isArray(value) && value.length === 0;
}

/**
 * 画面に出ているのと同じ文字列にする。
 *
 * select / multiselect は保存値がコードなので、必ずラベルに置き換える。
 * ラベル表に無いコード（選択肢から消えた値）はそのまま残す — 何が保存されて
 * いるのかを利用者から隠さないため。
 */
export function renderValue(field: PreparedField, value: unknown): string {
  if (isBlank(value)) return "";
  if (field.labels.size > 0) {
    if (Array.isArray(value)) {
      return value
        .map((v) => field.labels.get(String(v)) ?? String(v))
        .join(", ");
    }
    const label = field.labels.get(String(value));
    if (label !== undefined) return label;
  }
  return displayValue(field.type, value);
}

/**
 * 1つの値が検索語に一致するか。一致したら「画面に出ている表示」を返す。
 *
 * ラベルで引けるのが主眼だが、保存されているコード（`other` など）でも
 * 引けるままにしておく。以前からコードで探せていたので、取り上げると
 * 「昨日まで出ていたものが出ない」になる。表示するのはあくまでラベル。
 *
 * @param query 小文字化済みの検索語。
 */
export function matchValue(
  field: PreparedField,
  value: unknown,
  query: string,
): string | null {
  if (isBlank(value)) return null;

  const shown = renderValue(field, value);
  if (shown.toLowerCase().includes(query)) return shown;

  if (field.labels.size > 0) {
    const raw = Array.isArray(value)
      ? value.map((v) => String(v)).join(", ")
      : String(value);
    if (raw.toLowerCase().includes(query)) return shown;
  }

  return null;
}

/**
 * 1行分を突き合わせ、最初に一致したフィールドを「項目名: 表示値」で返す。
 * 一致が無ければ null。
 */
export function matchRecord(
  fields: PreparedField[],
  data: Record<string, unknown>,
  query: string,
): string | null {
  for (const field of fields) {
    const shown = matchValue(field, data[field.key], query);
    if (shown !== null) return `${field.name}: ${shown}`;
  }
  return null;
}
