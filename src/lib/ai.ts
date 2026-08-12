/**
 * AI dashboard generation ("画像・PDFから作成").
 *
 * Turns a user's screenshot / PDF / free-text description of a dashboard into a
 * real, schema-valid DashboardTemplate that `applyTemplate` can materialise.
 *
 * Providers are optional and probed in order (Anthropic → OpenAI). When no key
 * is configured — or the provider call fails / returns something that does not
 * validate — we degrade gracefully to a keyword-matched heuristic pick from the
 * built-in template gallery. `generateDashboardTemplate` therefore NEVER throws
 * for "no key": it always returns something usable.
 *
 * Server-only. Uses the global `fetch`; no extra npm dependencies. The API key
 * is never logged.
 */
import { env } from "./env";
import {
  dashboardTemplateSchema,
  type DashboardTemplate,
} from "./widgets";
import { getAllTemplates } from "./dashboard-templates";
import { CATEGORIES } from "./dashboard-templates/categories";

export type GenerationVia = "anthropic" | "openai" | "heuristic";

export interface GenerateInput {
  description?: string;
  file?: {
    base64: string;
    mediaType: string;
    kind: "image" | "pdf";
  };
}

export interface GenerateResult {
  template: DashboardTemplate;
  via: GenerationVia;
}

const REQUEST_TIMEOUT_MS = 30_000;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * A concise, self-contained spec of our DashboardTemplate shape. Embedded in
 * the model prompt so the model emits JSON that validates against
 * `dashboardTemplateSchema` on the first try.
 */
const CATEGORY_IDS = CATEGORIES.map((c) => c.id).join("|");

const SPEC_PROMPT = `あなたはBIダッシュボード設計アシスタントです。ユーザーが作りたいダッシュボード（画像・PDF・説明文）から、下記スキーマに厳密に一致する JSON を **1つだけ** 出力してください。前置き・後書き・コードフェンス・説明文は一切禁止。出力はトップレベルのJSONオブジェクトのみ。

# 出力スキーマ (DashboardTemplate)
{
  "key": string,           // "ai-" で始まる一意なslug (例 "ai-monthly-sales")
  "category": string,      // ${CATEGORY_IDS} のいずれか
  "name": string,          // 日本語のダッシュボード名
  "description": string,   // 日本語1文の説明
  "icon": string,          // dashboard|inbox|table|sparkles|users|settings のいずれか
  "color": string,         // khaki|info|success|warning|danger|neutral のいずれか
  "collections": TemplateCollection[],  // 1〜2個
  "widgets": WidgetSpec[]                // 6〜9個
}

# TemplateCollection
{
  "name": string,          // 日本語のテーブル名
  "slug": string,          // 英小文字のslug (例 "orders")。widget.collection はこの slug と完全一致させる
  "icon": string,          // table|inbox|sparkles|users
  "color": string,         // khaki|info|success|warning|danger|neutral
  "sampleRows": number,    // 60〜150
  "fields": TemplateField[] // 5〜9個
}

# TemplateField
{
  "key": string,           // 英小文字のフィールドキー (例 "amount"、"created_at")
  "name": string,          // 日本語のフィールド名
  "type": "text"|"longtext"|"number"|"currency"|"select"|"multiselect"|"date"|"checkbox"|"email"|"phone"|"url",
  "required"?: boolean,
  "options"?: [{ "label": string(日本語), "value": string(英小文字), "color"?: "khaki"|"info"|"success"|"warning"|"danger" }],
  "sample"?: { "min"?: number, "max"?: number, "daysBack"?: number, "weights"?: number[], "trend"?: "flat"|"up"|"down" }
}
ルール:
- select / multiselect 型のフィールドには必ず options を2個以上つける。
- currency / number 型には sample.min と sample.max をつける (例 currencyは min:100000, max:5000000)。
- date 型には sample.daysBack (30〜120) をつけ、時系列の主軸には trend:"up" をつけると自然。
- 各コレクションに date 型を最低1つ入れる (時系列グラフの軸になる)。

# WidgetSpec (type で判別)
共通: { "id": string(一意), "title": string(日本語), "collection": <コレクションslug>, "span": 1〜4, "filters"?: Filter[] }
- kpi:   { "type":"kpi", "measure": Measure, "unit"?:"number"|"currency"|"percent"|"days", "icon"?:string, "rateNumerator"?: Filter[], "delta"?:{ "dateField"?:string, "period":"week"|"month" }, "target"?:number }
         ※ rateNumerator を使うと「一致件数 / 全件」の割合(%)になる。delta を付けると値が当該期間(今週/今月)に限定されるので title も「今週の…」等にする。
- line/area/bar: { "type":"line"|"area"|"bar", "dateField"?:<date型フィールドkey>, "bucket":"day"|"week"|"month", "rangeCount": 2〜60, "measures":[{ "label":string, "measure":Measure, "filters"?:Filter[], "color"?:"khaki"|"info"|"success"|"warning"|"danger" }] (1〜4), "stacked"?:boolean }
- donut/hbar: { "type":"donut"|"hbar", "groupBy": <フィールドkey>, "measure"?: Measure, "limit": 2〜12 }
- table: { "type":"table", "columns": [<フィールドkey>] (1〜8), "sort"?:{ "field":<フィールドkey>, "dir":"asc"|"desc" }, "limit": 1〜50 }

Measure = { "kind":"count" } | { "kind":"sum"|"avg"|"min"|"max", "field": <number/currency型フィールドkey> }
Filter  = { "field": <フィールドkey>, "op":"eq"|"neq"|"in"|"gt"|"gte"|"lt"|"lte"|"truthy"|"falsy", "value"?: any }

# 厳守事項
- すべての widget.collection は、いずれかの collections[].slug と完全一致すること。
- widget 内で参照する全フィールド(dateField / groupBy / columns / measure.field / filter.field / sort.field)は、そのコレクションに実在する field.key であること。
- グリッドは横4カラム。各「行」の widget.span の合計が 4 になるように並べる (例: kpi×4、または span2+span2、span1+span1+span2)。
- KPIは先頭に3〜4個、続けて時系列(line/area)1〜2個、内訳(donut/hbar)2個前後、最後にtable1個、という構成が定番。
- 文言はすべて日本語。key/slug/field.key/option.value は英小文字。
- 出力は JSON オブジェクト1つのみ。`;

/** ------------------------------------------------------------------ */
/*  Public API                                                          */
/** ------------------------------------------------------------------ */

export async function generateDashboardTemplate(
  input: GenerateInput,
): Promise<GenerateResult> {
  const instruction = buildInstruction(input);

  // Anthropic first (can read images AND PDFs natively).
  if (env.ANTHROPIC_API_KEY) {
    try {
      const raw = await callAnthropic(input, instruction);
      const template = parseAndValidate(raw);
      return { template, via: "anthropic" };
    } catch (err) {
      logProviderFailure("anthropic", err);
      // fall through to next provider / heuristic
    }
  }

  // OpenAI next. Note: cannot read PDFs here — if the only signal is a PDF and
  // there is no description, skip straight to the heuristic.
  if (env.OPENAI_API_KEY) {
    const openaiCanHelp =
      Boolean(input.description) ||
      (input.file ? input.file.kind === "image" : false);
    if (openaiCanHelp) {
      try {
        const raw = await callOpenAI(input, instruction);
        const template = parseAndValidate(raw);
        return { template, via: "openai" };
      } catch (err) {
        logProviderFailure("openai", err);
        // fall through to heuristic
      }
    }
  }

  // Graceful degradation — always returns something usable.
  return { template: pickHeuristicTemplate(input), via: "heuristic" };
}

/** ------------------------------------------------------------------ */
/*  Prompt building                                                     */
/** ------------------------------------------------------------------ */

function buildInstruction(input: GenerateInput): string {
  const parts: string[] = [];
  if (input.file?.kind === "image") {
    parts.push(
      "添付のダッシュボード画像を読み取り、そこに写っている指標・グラフ・テーブルを再現する DashboardTemplate を作成してください。",
    );
  } else if (input.file?.kind === "pdf") {
    parts.push(
      "添付のPDFを読み取り、記載されている指標・グラフ・テーブルを再現する DashboardTemplate を作成してください。",
    );
  }
  if (input.description && input.description.trim()) {
    parts.push(
      `ユーザーの要望:\n"""\n${input.description.trim()}\n"""\nこの要望に沿った DashboardTemplate を作成してください。`,
    );
  }
  if (parts.length === 0) {
    parts.push(
      "一般的な業務ダッシュボードの DashboardTemplate を作成してください。",
    );
  }
  parts.push("出力は前述のスキーマに厳密に一致する JSON オブジェクト1つのみ。");
  return parts.join("\n\n");
}

/** ------------------------------------------------------------------ */
/*  Anthropic Messages API                                              */
/** ------------------------------------------------------------------ */

async function callAnthropic(
  input: GenerateInput,
  instruction: string,
): Promise<string> {
  const content: unknown[] = [];

  if (input.file) {
    if (input.file.kind === "image") {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: input.file.mediaType,
          data: input.file.base64,
        },
      });
    } else {
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: input.file.base64,
        },
      });
    }
  }
  content.push({ type: "text", text: instruction });

  const body = {
    model: env.ANTHROPIC_MODEL,
    max_tokens: 4000,
    system: SPEC_PROMPT,
    messages: [{ role: "user", content }],
  };

  const res = await fetchWithTimeout(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `Anthropic API がエラーを返しました (HTTP ${res.status})`,
    );
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Anthropic の応答にテキストがありません");
  return text;
}

/** ------------------------------------------------------------------ */
/*  OpenAI Chat Completions API                                         */
/** ------------------------------------------------------------------ */

async function callOpenAI(
  input: GenerateInput,
  instruction: string,
): Promise<string> {
  const userContent: unknown[] = [{ type: "text", text: instruction }];

  // Only images are attachable here; PDFs fall back to description-only text.
  if (input.file?.kind === "image") {
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${input.file.mediaType};base64,${input.file.base64}`,
      },
    });
  }

  const body = {
    model: env.OPENAI_MODEL,
    max_tokens: 4000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SPEC_PROMPT },
      { role: "user", content: userContent },
    ],
  };

  const res = await fetchWithTimeout(OPENAI_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`OpenAI API がエラーを返しました (HTTP ${res.status})`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI の応答にテキストがありません");
  return text;
}

/** ------------------------------------------------------------------ */
/*  Parsing & validation                                                */
/** ------------------------------------------------------------------ */

/** Strip markdown code fences and isolate the outermost JSON object. */
function extractJson(text: string): string {
  let t = text.trim();
  // Remove ```json ... ``` or ``` ... ``` fences.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // Isolate from the first "{" to the last "}".
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    t = t.slice(first, last + 1);
  }
  return t;
}

function parseAndValidate(rawText: string): DashboardTemplate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(rawText));
  } catch {
    throw new Error("生成結果のJSONを解析できませんでした");
  }

  const result = dashboardTemplateSchema.safeParse(parsed);
  if (result.success) return result.data;

  // One light repair pass: ensure a "ai-" prefixed key + sane category so the
  // most common minor mismatches don't force a full fallback.
  if (parsed && typeof parsed === "object") {
    const repaired = repairTemplate(parsed as Record<string, unknown>);
    const retry = dashboardTemplateSchema.safeParse(repaired);
    if (retry.success) return retry.data;
  }

  throw new Error("生成結果がスキーマに一致しませんでした");
}

// Derived from the gallery's category list rather than hard-coded, so an
// AI-generated dashboard can land in any category the gallery gains (小売・EC,
// 製造, 建設… ) instead of silently falling back to 「オペレーション」.
const VALID_CATEGORIES = new Set(CATEGORIES.map((c) => c.id));

function repairTemplate(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...obj };
  if (typeof out.key !== "string" || !out.key) {
    out.key = `ai-${Date.now().toString(36)}`;
  } else if (!(out.key as string).startsWith("ai-")) {
    out.key = `ai-${out.key as string}`;
  }
  if (typeof out.category !== "string" || !VALID_CATEGORIES.has(out.category as string)) {
    out.category = "operations";
  }
  return out;
}

/** ------------------------------------------------------------------ */
/*  Heuristic fallback                                                  */
/** ------------------------------------------------------------------ */

/**
 * Pick the closest built-in template by keyword-matching the description.
 * When only a file (no description) is available, default to a sensible
 * general dashboard (support-inquiries, else the first available template).
 */
export function pickHeuristicTemplate(input: GenerateInput): DashboardTemplate {
  const all = getAllTemplates();
  if (all.length === 0) {
    // Extremely defensive: gallery should never be empty in practice.
    throw new Error("利用可能なテンプレートがありません");
  }

  const description = (input.description ?? "").toLowerCase();

  if (description.trim()) {
    let best: DashboardTemplate | null = null;
    let bestScore = 0;
    for (const t of all) {
      const score = scoreTemplate(t, description);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best && bestScore > 0) return withAiKey(best);
  }

  // No usable description (or no keyword hit): sensible default.
  const preferred =
    all.find((t) => t.key === "support-inquiries") ??
    all.find((t) => t.category === "executive") ??
    all[0];
  return withAiKey(preferred);
}

/** Give the reused template a distinct "ai-" key so its origin is clear. */
function withAiKey(t: DashboardTemplate): DashboardTemplate {
  if (t.key.startsWith("ai-")) return t;
  return { ...t, key: `ai-${t.key}` };
}

/** Japanese + English keyword buckets → template categories / keys. */
const KEYWORD_HINTS: Array<{ words: string[]; match: (t: DashboardTemplate) => boolean }> = [
  { words: ["売上", "粗利", "受注", "パイプライン", "商談", "sales", "revenue", "pipeline", "deal"], match: (t) => t.category === "sales" },
  { words: ["問い合わせ", "サポート", "チケット", "満足度", "csat", "support", "ticket", "inquiry"], match: (t) => t.category === "support" },
  { words: ["請求", "入金", "支払", "課金", "invoice", "billing", "payment"], match: (t) => t.category === "billing" },
  { words: ["財務", "予算", "経費", "コスト", "finance", "budget", "expense", "cost"], match: (t) => t.category === "finance" },
  { words: ["人事", "採用", "従業員", "勤怠", "離職", "hr", "hiring", "employee", "headcount"], match: (t) => t.category === "hr" },
  { words: ["マーケ", "広告", "リード", "キャンペーン", "流入", "marketing", "campaign", "lead", "ad"], match: (t) => t.category === "marketing" },
  { words: ["在庫", "オペレーション", "製造", "物流", "運用", "operations", "inventory", "logistics"], match: (t) => t.category === "operations" },
  { words: ["経営", "サマリー", "kpi", "全社", "executive", "summary", "overview"], match: (t) => t.category === "executive" },
];

function scoreTemplate(t: DashboardTemplate, description: string): number {
  let score = 0;

  // Category-level keyword buckets (strong signal).
  for (const hint of KEYWORD_HINTS) {
    if (hint.match(t) && hint.words.some((w) => description.includes(w.toLowerCase()))) {
      score += 3;
    }
  }

  // Direct token overlap against the template's own text.
  const haystack = `${t.name} ${t.description} ${t.collections
    .flatMap((c) => c.fields.map((f) => f.name))
    .join(" ")}`.toLowerCase();
  for (const token of tokenize(description)) {
    if (token.length >= 2 && haystack.includes(token)) score += 1;
  }

  return score;
}

function tokenize(text: string): string[] {
  return text
    .split(/[\s、。,.\/・:;：；()（）\[\]「」【】]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** ------------------------------------------------------------------ */
/*  Utilities                                                           */
/** ------------------------------------------------------------------ */

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("AI生成がタイムアウトしました");
    }
    throw new Error("AIプロバイダーへの接続に失敗しました");
  } finally {
    clearTimeout(timer);
  }
}

/** Log a provider failure WITHOUT ever exposing the API key. */
function logProviderFailure(provider: string, err: unknown): void {
  const message = err instanceof Error ? err.message : "unknown error";
  console.warn(`AI generation via ${provider} failed: ${message}`);
}
