/**
 * Google Sheets import helpers — no OAuth.
 *
 * We import a Google Sheet purely through its public / link-shared CSV export
 * endpoint. Given any share/edit/view URL we derive the canonical CSV export
 * URL and fetch it as bytes, which then flow into the SAME Excel/CSV pipeline
 * (`readAllSheets` / `readSheet`) that powers file uploads.
 *
 * Pure-ish + server-only: no Prisma, no request context. `fetchSheetCsv` is the
 * one side effect (a network fetch), and it throws `ApiError` with clear,
 * user-facing Japanese messages when the sheet is not publicly reachable.
 */
import { ApiError } from "@/lib/api";
import { MAX_IMPORT_BYTES } from "@/lib/excel";

/** Message shown when a sheet is private / behind a Google login redirect. */
const ACCESS_DENIED_MESSAGE =
  "このGoogle Sheetsにアクセスできません。共有設定を『リンクを知っている全員（閲覧者）』にするか、ファイル→共有→ウェブに公開 してから再度お試しください。";

/**
 * Turn any Google Sheets URL into its CSV export URL.
 *
 * Handles the common shapes:
 *   - https://docs.google.com/spreadsheets/d/<ID>/edit#gid=<GID>
 *   - https://docs.google.com/spreadsheets/d/<ID>/edit?usp=sharing
 *   - https://docs.google.com/spreadsheets/d/<ID>/view
 *   - https://docs.google.com/spreadsheets/d/e/<LONG>/pubhtml (published)
 *
 * Extracts the doc ID (the `/d/<ID>/` segment, incl. the `/d/e/<...>` published
 * form) and the gid (`#gid=` or `?gid=`, default 0). Returns null when the URL
 * is not a Google Sheets URL.
 */
export function toCsvExportUrl(url: string): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // Must be a Google Docs spreadsheets host + path.
  const host = parsed.hostname.toLowerCase();
  if (host !== "docs.google.com" && host !== "www.docs.google.com") return null;
  if (!parsed.pathname.includes("/spreadsheets/")) return null;

  // Doc ID: the segment after `/d/`. Published sheets use `/d/e/<LONG>`.
  const idMatch = parsed.pathname.match(/\/spreadsheets\/d\/(e\/)?([^/]+)/);
  if (!idMatch) return null;
  const docId = `${idMatch[1] ?? ""}${idMatch[2] ?? ""}`.replace(/\/$/, "");
  if (!docId) return null;

  // gid from query (?gid=) or hash (#gid=); default 0.
  let gid = parsed.searchParams.get("gid");
  if (!gid && parsed.hash) {
    const hashMatch = parsed.hash.match(/gid=([0-9]+)/);
    if (hashMatch) gid = hashMatch[1];
  }
  if (!gid || !/^[0-9]+$/.test(gid)) gid = "0";

  return `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv&gid=${gid}`;
}

/** Heuristic: does this look like an HTML login / error page rather than CSV? */
function looksLikeHtml(contentType: string | null, bytes: ArrayBuffer): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/html")) return true;
  if (ct.includes("csv") || ct.includes("text/plain") || ct.includes("octet-stream")) {
    return false;
  }
  // No/ambiguous content-type: sniff the first bytes for an HTML document.
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(new Uint8Array(bytes.slice(0, 512)))
    .trimStart()
    .toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

/**
 * Fetch the CSV export URL as bytes.
 *
 * - ~15s timeout via AbortController.
 * - Follows redirects (Google bounces export URLs a couple of times).
 * - A private sheet redirects to a Google login page (HTML) — we detect that
 *   and throw a clear 403 telling the user how to fix their sharing settings.
 * - Enforces the same size cap as file uploads (413 when exceeded).
 */
export async function fetchSheetCsv(url: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/csv,text/plain,*/*" },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(
        "Google Sheetsの読み込みがタイムアウトしました。時間をおいて再度お試しください。",
        504,
      );
    }
    throw new ApiError(
      "Google Sheetsへの接続に失敗しました。URLと共有設定をご確認ください。",
      502,
    );
  } finally {
    clearTimeout(timeout);
  }

  // 401/403 from Google — definitely a permissions problem.
  if (res.status === 401 || res.status === 403) {
    throw new ApiError(ACCESS_DENIED_MESSAGE, 403);
  }
  if (!res.ok) {
    throw new ApiError(ACCESS_DENIED_MESSAGE, 400);
  }

  const bytes = await res.arrayBuffer();

  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    // 文面は MAX_IMPORT_BYTES と一致させること（15MB のまま置き去りにすると、
    // 4MB で断りながら「上限は15MB」と言う嘘になる）。Google Sheets の取り込みは
    // ブラウザからのアップロードではないので 4.5MB のボディ上限には当たらないが、
    // 解析の上限は共通なので、同じ値・同じ言い方で断る。
    throw new ApiError(
      `シートのサイズが上限（4MB）を超えています（このシートは約${(bytes.byteLength / (1024 * 1024)).toFixed(1)}MB）。タブを分けるか、不要な列や行を削ってから、もう一度お試しください。`,
      413,
    );
  }

  // A public CSV export is text/csv; a private sheet redirects to an HTML
  // login/error page. Treat HTML as an access failure.
  if (looksLikeHtml(res.headers.get("content-type"), bytes)) {
    throw new ApiError(ACCESS_DENIED_MESSAGE, 403);
  }

  return bytes;
}
