/**
 * Notion import helpers — REST API only, no SDK.
 *
 * DashDrop imports a Notion *database* as a spreadsheet: the database schema
 * becomes typed Fields, each page becomes a Record. Everything here is pure-ish
 * and unit-testable: the token is always an argument (never read from the
 * database or the environment), there is no `server-only` import, and no Prisma
 * or request context is touched. The one side effect is `fetch`.
 *
 * Defensive by design. Notion responses are deeply nested and every property is
 * optional in practice (a rollup over an empty relation, a formula that errored,
 * a page whose property was deleted between the schema read and the query).
 * `readPropertyValue` therefore never throws — an unexpected shape yields null.
 */
import { ApiError } from "@/lib/errors";
import { toFieldKey, uniqueName } from "@/lib/utils";
import type { FieldType, SelectOption } from "@/lib/field-types";

const API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const TIMEOUT_MS = 15_000;

/** Notion's own maximum page size for search/query. */
export const NOTION_PAGE_SIZE = 100;
/** Default hard cap on rows pulled from one database in a single import. */
export const DEFAULT_MAX_ROWS = 2000;
/** Never issue more than this many query requests, whatever maxRows says. */
export const MAX_QUERY_PAGES = 30;

/** Placeholder for a database (or select option) with no name. */
export const UNTITLED = "無題";

export interface NotionDatabaseSummary {
  id: string;
  title: string;
  url: string;
}

/** One Notion property translated into a DashDrop field definition. */
export interface NotionField {
  /** Property name in Notion — the key into `page.properties`. */
  notionName: string;
  /** Notion property type, kept for display/debugging. */
  notionType: string;
  name: string;
  key: string;
  type: FieldType;
  options?: SelectOption[];
}

/** A value DashDrop can hand to `coerceValue`. */
export type NotionValue = string | number | boolean | string[] | null;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Map an HTTP status from Notion onto a message the owner of a small business
 * can act on. 404 is by far the most common real failure: the token is valid but
 * the page was never shared with the integration, so Notion pretends it does not
 * exist.
 */
export function notionError(status: number): ApiError {
  if (status === 401) {
    return new ApiError("Notionのトークンが無効です。", 401);
  }
  if (status === 403) {
    return new ApiError(
      "Notionのこのデータベースへのアクセス権がありません。Notion側でインテグレーションに共有してください。",
      403,
    );
  }
  if (status === 404) {
    return new ApiError(
      "データベースが見つかりません。インテグレーションに共有されているか確認してください。",
      404,
    );
  }
  if (status === 429) {
    return new ApiError(
      "Notion側のレート制限です。しばらくして再度お試しください。",
      429,
    );
  }
  return new ApiError(
    `Notionとの通信に失敗しました（HTTP ${status}）。時間をおいて再度お試しください。`,
    502,
  );
}

// ---------------------------------------------------------------------------
// Low-level client
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * One authenticated Notion request. Always time-limited; always returns a plain
 * object (a non-JSON body — Notion's HTML error pages, an empty 200 — becomes
 * `{}` rather than a parse exception).
 */
async function notionFetch(
  token: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // AbortSignal.timeout rejects with a TimeoutError; an aborted request with
    // an AbortError. Neither should reach the user as a raw DOM exception.
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ApiError(
        "Notionへの接続がタイムアウトしました。時間をおいて再度お試しください。",
        504,
      );
    }
    throw new ApiError(
      "Notionへの接続に失敗しました。ネットワーク環境をご確認ください。",
      502,
    );
  }

  if (!res.ok) throw notionError(res.status);

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return isRecord(json) ? json : {};
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** Plain text out of a Notion rich-text / title array. */
function plainText(value: unknown): string {
  return asArray(value)
    .map((chunk) => {
      if (!isRecord(chunk)) return "";
      const plain = chunk.plain_text;
      if (typeof plain === "string") return plain;
      // Fall back to the nested content when plain_text is absent.
      const text = chunk.text;
      if (isRecord(text) && typeof text.content === "string") return text.content;
      return "";
    })
    .join("")
    .trim();
}

/** Every database the integration has been shared with (first 100). */
export async function listDatabases(
  token: string,
): Promise<NotionDatabaseSummary[]> {
  const json = await notionFetch(token, "/search", {
    method: "POST",
    body: {
      filter: { value: "database", property: "object" },
      page_size: NOTION_PAGE_SIZE,
    },
  });

  const out: NotionDatabaseSummary[] = [];
  for (const item of asArray(json.results)) {
    if (!isRecord(item)) continue;
    const id = asString(item.id);
    if (!id) continue;
    // Newer API versions can return other object kinds through search; keep
    // databases only when the object marker is present.
    if (typeof item.object === "string" && item.object !== "database") continue;
    out.push({
      id,
      title: plainText(item.title) || UNTITLED,
      url: asString(item.url) ?? "",
    });
  }
  return out;
}

/** The database object (its `properties` map is the schema we import). */
export async function fetchDatabase(
  token: string,
  databaseId: string,
): Promise<Record<string, unknown>> {
  const id = String(databaseId ?? "").trim();
  if (!id) {
    throw new ApiError("データベースを選択してください。", 400);
  }
  return notionFetch(token, `/databases/${encodeURIComponent(id)}`, {
    method: "GET",
  });
}

/** Human title of a database object, or 「無題」. */
export function databaseTitle(database: unknown): string {
  if (!isRecord(database)) return UNTITLED;
  return plainText(database.title) || UNTITLED;
}

/**
 * Every page in a database, following `next_cursor` until exhausted.
 *
 * Two independent brakes so one enormous database cannot hang a request:
 * `maxRows` (default 2000) and `MAX_QUERY_PAGES` (30 round-trips).
 */
export async function queryDatabase(
  token: string,
  databaseId: string,
  opts: { maxRows?: number } = {},
): Promise<Record<string, unknown>[]> {
  const id = String(databaseId ?? "").trim();
  if (!id) {
    throw new ApiError("データベースを選択してください。", 400);
  }
  const maxRows = Math.max(
    1,
    Math.min(opts.maxRows ?? DEFAULT_MAX_ROWS, DEFAULT_MAX_ROWS),
  );

  const pages: Record<string, unknown>[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_QUERY_PAGES; page++) {
    const body: Record<string, unknown> = {
      page_size: Math.min(NOTION_PAGE_SIZE, maxRows - pages.length),
    };
    if (cursor) body.start_cursor = cursor;

    const json: Record<string, unknown> = await notionFetch(
      token,
      `/databases/${encodeURIComponent(id)}/query`,
      { method: "POST", body },
    );

    for (const row of asArray(json.results)) {
      if (isRecord(row)) pages.push(row);
      if (pages.length >= maxRows) break;
    }
    if (pages.length >= maxRows) break;

    const hasMore = json.has_more === true;
    const next = asString(json.next_cursor);
    if (!hasMore || !next) break;
    cursor = next;
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Schema mapping
// ---------------------------------------------------------------------------

/**
 * Notion property type → DashDrop field type.
 *
 * Anything Notion computes from elsewhere (people, files, relations, rollups,
 * formulas) lands on `text`: DashDrop stores a readable flattened string rather
 * than pretending to keep the link live.
 */
export function mapPropertyType(notionType: unknown): FieldType {
  switch (notionType) {
    case "title":
    case "rich_text":
      return "text";
    case "number":
      return "number";
    case "select":
    case "status":
      return "select";
    case "multi_select":
      return "multiselect";
    case "date":
    case "created_time":
    case "last_edited_time":
      return "date";
    case "checkbox":
      return "checkbox";
    case "email":
      return "email";
    case "phone_number":
      return "phone";
    case "url":
      return "url";
    case "people":
    case "files":
    case "relation":
    case "rollup":
    case "formula":
    case "created_by":
    case "last_edited_by":
    case "unique_id":
      return "text";
    default:
      return "text";
  }
}

/** Notion's option colours mapped onto the badge tones DashDrop renders. */
function tone(color: unknown): string | undefined {
  switch (color) {
    case "green":
      return "success";
    case "yellow":
    case "orange":
      return "warning";
    case "red":
    case "pink":
      return "danger";
    case "blue":
    case "purple":
      return "info";
    case "brown":
      return "khaki";
    default:
      return undefined;
  }
}

/**
 * The choice list behind a select / status / multi_select property, so an
 * imported column keeps its options. `[]` for every other property type.
 */
export function notionSelectOptions(prop: unknown): SelectOption[] {
  if (!isRecord(prop)) return [];
  const type = prop.type;
  if (type !== "select" && type !== "multi_select" && type !== "status") {
    return [];
  }
  const holder = prop[type as string];
  if (!isRecord(holder)) return [];

  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const raw of asArray(holder.options)) {
    if (!isRecord(raw)) continue;
    const name = asString(raw.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const color = tone(raw.color);
    out.push(color ? { label: name, value: name, color } : { label: name, value: name });
  }
  return out;
}

/**
 * Turn a database's `properties` map into DashDrop fields, title column first
 * (it is the human identifier of every Notion page) and the rest in the order
 * Notion returned them. Keys are unique and machine-safe.
 */
export function notionFields(database: unknown): NotionField[] {
  const props = isRecord(database) ? database.properties : null;
  if (!isRecord(props)) return [];

  const entries = Object.entries(props).filter(([, v]) => isRecord(v));
  entries.sort((a, b) => {
    const at = (a[1] as Record<string, unknown>).type === "title" ? 0 : 1;
    const bt = (b[1] as Record<string, unknown>).type === "title" ? 0 : 1;
    return at - bt;
  });

  const takenKeys = new Set<string>();
  const fields: NotionField[] = [];
  for (const [notionName, raw] of entries) {
    const prop = raw as Record<string, unknown>;
    const name = notionName.trim() || UNTITLED;
    const notionType = typeof prop.type === "string" ? prop.type : "unknown";
    const key = uniqueName(toFieldKey(name), takenKeys);
    takenKeys.add(key);
    const options = notionSelectOptions(prop);
    fields.push({
      notionName,
      notionType,
      name,
      key,
      type: mapPropertyType(notionType),
      ...(options.length > 0 ? { options } : {}),
    });
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Value mapping
// ---------------------------------------------------------------------------

/** "2024-03-05T10:00:00.000+09:00" → "2024-03-05". Null when unusable. */
function toDateOnly(value: unknown): string | null {
  const s = asString(value);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function joinNames(items: unknown[], separator: string): string | null {
  const names = items
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!isRecord(item)) return "";
      return (
        asString(item.name) ??
        asString(item.plain_text) ??
        asString(item.id) ??
        ""
      );
    })
    .filter((s) => s !== "");
  return names.length > 0 ? names.join(separator) : null;
}

/** The value of a formula / rollup, flattened to something storable. */
function readComputed(inner: unknown): NotionValue {
  if (!isRecord(inner)) return null;
  const type = typeof inner.type === "string" ? inner.type : null;
  switch (type) {
    case "string":
      return asString(inner.string);
    case "number":
      return typeof inner.number === "number" ? String(inner.number) : null;
    case "boolean":
      return typeof inner.boolean === "boolean" ? String(inner.boolean) : null;
    case "date": {
      const date = inner.date;
      if (!isRecord(date)) return null;
      return toDateOnly(date.start);
    }
    case "array": {
      const parts = asArray(inner.array)
        .map((item) => readPropertyValue(item))
        .map((v) => (Array.isArray(v) ? v.join("、") : v))
        .filter((v): v is string | number | boolean => v !== null)
        .map((v) => String(v));
      return parts.length > 0 ? parts.join("、") : null;
    }
    default:
      return null;
  }
}

/**
 * One page property → a primitive DashDrop can store. Never throws: a missing,
 * partial, or nonsense shape yields null so one bad row cannot fail an import.
 */
export function readPropertyValue(prop: unknown): NotionValue {
  try {
    if (!isRecord(prop)) return null;
    const type = typeof prop.type === "string" ? prop.type : null;

    switch (type) {
      case "title":
        return plainText(prop.title) || null;
      case "rich_text":
        return plainText(prop.rich_text) || null;
      case "number":
        return typeof prop.number === "number" && Number.isFinite(prop.number)
          ? prop.number
          : null;
      case "select":
      case "status": {
        const holder = prop[type];
        return isRecord(holder) ? asString(holder.name) : null;
      }
      case "multi_select": {
        const names = asArray(prop.multi_select)
          .map((o) => (isRecord(o) ? asString(o.name) : null))
          .filter((n): n is string => n !== null);
        return names.length > 0 ? names : null;
      }
      case "date": {
        const date = prop.date;
        if (!isRecord(date)) return null;
        return toDateOnly(date.start);
      }
      case "created_time":
        return toDateOnly(prop.created_time);
      case "last_edited_time":
        return toDateOnly(prop.last_edited_time);
      case "checkbox":
        return typeof prop.checkbox === "boolean" ? prop.checkbox : null;
      case "email":
        return asString(prop.email);
      case "phone_number":
        return asString(prop.phone_number);
      case "url":
        return asString(prop.url);
      case "people":
        return joinNames(asArray(prop.people), "、");
      case "files":
        return joinNames(asArray(prop.files), "、");
      case "relation": {
        const ids = asArray(prop.relation)
          .map((r) => (isRecord(r) ? asString(r.id) : null))
          .filter((id): id is string => id !== null);
        return ids.length > 0 ? ids.join("、") : null;
      }
      case "created_by":
      case "last_edited_by": {
        const who = prop[type];
        if (!isRecord(who)) return null;
        return asString(who.name) ?? asString(who.id);
      }
      case "unique_id": {
        const uid = prop.unique_id;
        if (!isRecord(uid)) return null;
        if (typeof uid.number !== "number") return null;
        const prefix = asString(uid.prefix);
        return prefix ? `${prefix}-${uid.number}` : String(uid.number);
      }
      case "formula":
        return readComputed(prop.formula);
      case "rollup":
        return readComputed(prop.rollup);
      default:
        // Unknown / future property type: salvage a name or a plain string.
        return asString(prop.name) ?? null;
    }
  } catch {
    return null;
  }
}
