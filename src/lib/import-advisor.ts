/**
 * 取り込み前の下見 —「このシートを、この項目名で入れますが良いですか？」
 *
 * Excel を置いた直後に、中身を見て提案を返す層。利用者の言葉:
 *   「この列はこの項目名にしますけど良いか？とデータの内容と名前を見て
 *     レコメンドしてほしい。一意のものにしていくイメージだね」
 *   「どのシートを入れますかとかもね。セル結合とかも、シートの文脈を読み取って
 *     レコメンド、ないしはユーザがちゃんと指摘できるような質問も返すと良い」
 *
 * 三つを返す:
 *   1. sheets   — どのシートを入れるか（入れない理由つき）
 *   2. columns  — 各列の項目名・型の提案（名前もキーも一意に整えたもの）
 *   3. questions — 人にしか答えられないことへの質問（結合セル、見出し行のずれ、
 *                  名前の無い列など）。黙って推測せず、聞く。
 *
 * AI は「あると良くなる」層であって、前提ではない。キーが無くても、API が落ちても、
 * 返事が壊れていても、決定的なルールで組み立てた提案を必ず返す（`via` で区別できる）。
 * サーバー専用。APIキーはログに出さない。
 */
import { z } from "zod";
import { env } from "./env";
import { toFieldKey, uniqueName } from "./utils";
import { FIELD_TYPES, isFieldType, type FieldType } from "./field-types";
import type { SheetParse } from "./excel";

export type AdviceVia = "anthropic" | "heuristic";

export interface SheetAdvice {
  sheetName: string;
  /** 既定で取り込むか。利用者は画面で変えられる。 */
  include: boolean;
  /** なぜそう判断したか（1文・日本語）。 */
  reason: string;
}

export interface ColumnAdvice {
  /** ファイル上の列名。突き合わせの鍵なので絶対に書き換えない。 */
  sourceHeader: string;
  /** 提案する項目名。 */
  name: string;
  /** 提案するフィールドキー（シート内で一意）。 */
  key: string;
  type: FieldType;
  /** 元の列名から変える場合の理由。変えないなら空文字。 */
  reason: string;
}

export interface ImportQuestion {
  /** 対象シート。ファイル全体の話なら null。 */
  sheetName: string | null;
  /** 何を見つけたか。 */
  message: string;
  /** 利用者に確認したいこと。 */
  question: string;
}

export interface ImportAdvice {
  sheets: SheetAdvice[];
  /** シート名 → 列の提案。 */
  columns: Record<string, ColumnAdvice[]>;
  questions: ImportQuestion[];
}

export interface AdviceResult {
  advice: ImportAdvice;
  via: AdviceVia;
}

const REQUEST_TIMEOUT_MS = 30_000;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
/** モデルに渡すサンプル値の数（1列あたり）。多すぎても判断は良くならない。 */
const SAMPLES_PER_COLUMN = 6;
/** モデルに渡すシート数の上限。 */
const MAX_SHEETS_TO_MODEL = 20;
/** モデルに渡す列数の上限（1シートあたり）。 */
const MAX_COLUMNS_TO_MODEL = 40;

/* -------------------------------------------------------------------------- */
/* 決定的な下見（AIなしで必ず動く層）                                          */
/* -------------------------------------------------------------------------- */

/** 1列しかないシートを「データ表」と見なすのに必要な行数。 */
const TABLE_MIN_ROWS_FOR_SINGLE_COLUMN = 5;

/** パーサが名前の無い列に付ける仮の名前（例 "列3"）。 */
const PLACEHOLDER_HEADER = /^列\d+$/;

/**
 * ファイルの構造から、人にしか答えられない点を質問として組み立てる。
 *
 * ここは AI の有無に関わらず必ず出す。結合セルや見出し行のずれは「事実」であって
 * 推測ではないので、モデルの機嫌に左右されてはいけない。
 */
export function structuralQuestions(sheets: SheetParse[]): ImportQuestion[] {
  const out: ImportQuestion[] = [];

  for (const s of sheets) {
    if (s.empty) continue;

    if (s.merges.count > 0) {
      const where =
        s.merges.inHeaderRow > 0
          ? "見出しの行にも結合があります"
          : s.merges.aboveHeaderRow > 0
            ? "見出しより上に結合があります"
            : "表の中に結合があります";
      out.push({
        sheetName: s.sheetName,
        message: `結合されたセルが ${s.merges.count} か所あります（${where}／例: ${s.merges.examples.join(", ")}）。結合された見出しは片方のセルにしか値が無いため、列名が空欄になったり、意味が欠けたまま取り込まれます。`,
        question:
          "結合を解除して「1行＝1件・1列＝1項目」の形にしてから取り込みますか？ このまま進める場合、空欄になった列名はこの画面で直せます。",
      });
    }

    if (s.headerRowIndex > 0) {
      out.push({
        sheetName: s.sheetName,
        message: `1行目は見出しではないと判断し、${s.headerRowIndex + 1}行目を見出しとして読みました（上の行は表題や注記に見えます）。`,
        question: "この行を見出しとして扱って合っていますか？",
      });
    }

    const blanks = s.headers.filter((h) => PLACEHOLDER_HEADER.test(h));
    if (blanks.length > 0) {
      out.push({
        sheetName: s.sheetName,
        message: `列名が空欄の列が ${blanks.length} 列あります（${blanks.join("・")}）。`,
        question:
          "それぞれ何の項目ですか？ 空欄のままでも取り込めますが、名前が無いと後で意味が分からなくなります。",
      });
    }

    /*
     * 重複列。パーサが既に「金額」「金額-2」へ開いた後なので、素朴に比べても
     * 見つからない。連番を落とした形が他の列と一致するものを、元は同名だったと見る。
     */
    const bare = (h: string) => h.replace(/-\d+$/, "");
    const counts = new Map<string, number>();
    for (const h of s.headers) {
      counts.set(bare(h), (counts.get(bare(h)) ?? 0) + 1);
    }
    const dupes = new Set(
      [...counts.entries()].filter(([, n]) => n > 1).map(([h]) => h),
    );
    if (dupes.size > 0) {
      out.push({
        sheetName: s.sheetName,
        message: `同じ列名が複数あります（${[...dupes].join("・")}）。`,
        question:
          "どちらが何なのか、区別できる名前に変えますか？ このまま進める場合は自動で連番を付けて区別します。",
      });
    }

    for (const w of s.warnings) {
      out.push({
        sheetName: s.sheetName,
        message: w,
        question: "この状態で取り込んで良いですか？",
      });
    }
  }

  return out;
}

/** 名前とキーを、シート内で必ず一意にする。モデルの出力もここを必ず通す。 */
function uniquify(
  columns: Array<Omit<ColumnAdvice, "key"> & { key?: string }>,
): ColumnAdvice[] {
  const takenNames = new Set<string>();
  const takenKeys = new Set<string>();
  return columns.map((c) => {
    const name = uniqueName(c.name.trim() || c.sourceHeader, takenNames);
    takenNames.add(name);
    const key = uniqueName(toFieldKey(c.key?.trim() || name), takenKeys);
    takenKeys.add(key);
    return { ...c, name, key };
  });
}

/**
 * AI を使わない提案。列名はファイルのまま、型は推定済みのものを使う。
 * 「余計なことをしない」提案なので、AI が失敗しても利用者は困らない。
 */
export function heuristicAdvice(sheets: SheetParse[]): ImportAdvice {
  const columns: Record<string, ColumnAdvice[]> = {};
  const sheetAdvice: SheetAdvice[] = [];

  for (const s of sheets) {
    if (s.empty) {
      sheetAdvice.push({
        sheetName: s.sheetName,
        include: false,
        reason: "表として読める中身がありません。",
      });
      continue;
    }

    /*
     * 列の提案は、取り込みを勧めるかどうかとは別に、必ず作る。
     *
     * 以前は「取り込む」と判断したシートにだけ作っていた。取捨は**提案**で
     * あって決定ではないので、利用者が非表示シートにチェックを入れると、
     * 確認画面に列が1本も出ず、項目名も型も直せないまま取り込むことになる
     * （列の中身は同じように読めているのに、ただ渡していなかった）。
     */
    columns[s.sheetName] = uniquify(
      s.inferredFields.map((f) => ({
        sourceHeader: f.name,
        name: f.name,
        key: f.key,
        type: f.type,
        reason: "",
      })),
    );

    if (s.hidden) {
      sheetAdvice.push({
        sheetName: s.sheetName,
        include: false,
        reason: "Excel 上で非表示のシートです。作業用の可能性があります。",
      });
      continue;
    }
    /*
     * 表紙・目次・注記の判定。列が1本しかなく行も少ないシートは、1行1件の
     * データではなく人向けの文章であることがほとんど（「2026年度 売上管理表」
     * 「作成: 経理部」…）。取り込むと1列だけの意味の無い表が増える。
     */
    if (s.headers.length < 2 && s.rowCount < TABLE_MIN_ROWS_FOR_SINGLE_COLUMN) {
      sheetAdvice.push({
        sheetName: s.sheetName,
        include: false,
        reason: "列が1本しかなく行も少ないため、表紙や注記に見えます。",
      });
      continue;
    }

    // 行数・列数は画面が別に出しているので、ここでは繰り返さない。
    // AI が使えるときは、この欄に「なぜ取り込むと判断したか」が入る。
    sheetAdvice.push({ sheetName: s.sheetName, include: true, reason: "" });
  }

  return {
    sheets: sheetAdvice,
    columns,
    questions: structuralQuestions(sheets),
  };
}

/* -------------------------------------------------------------------------- */
/* モデルに渡す材料                                                            */
/* -------------------------------------------------------------------------- */

/**
 * スキャン結果を、モデルが読める最小限の JSON にする。
 * 行データそのものは送らない（送る意味が薄いうえ、量も個人情報の量も増える）。
 * 判断に要るのは「列名・型の当たり・数件のサンプル・構造の癖」だけ。
 */
export function buildAdvisorPayload(sheets: SheetParse[]) {
  return sheets.slice(0, MAX_SHEETS_TO_MODEL).map((s) => ({
    シート名: s.sheetName,
    行数: s.rowCount,
    非表示: s.hidden,
    空: s.empty,
    見出し行: s.headerRowIndex + 1,
    結合セル: s.merges.count,
    列: s.inferredFields.slice(0, MAX_COLUMNS_TO_MODEL).map((f) => ({
      列名: f.name,
      推定型: f.type,
      サンプル: s.previewRows
        .map((r) => r[f.name])
        .filter((v) => v !== null && v !== undefined && v !== "")
        .slice(0, SAMPLES_PER_COLUMN)
        .map((v) => String(v).slice(0, 40)),
    })),
  }));
}

const SYSTEM_PROMPT = `あなたは日本企業の業務データを扱う、取り込み設計のアシスタントです。
Excel/CSV の下見結果を受け取り、「どのシートを取り込むか」「各列をどんな項目名にするか」「人に確認すべきこと」を提案します。

# 判断の原則
- 列名は**むやみに変えない**。元の名前で意味が通るなら、そのまま使う。
- 変えるのは次の場合だけ: 名前が空欄／「列3」等の仮名／同じ名前が重複している／
  表記ゆれで意味が取りづらい（例「金額(税込)」「金額（税込）」）。
- 項目名は**シート内で一意**にする。同じ意味の列が2つあるなら、区別できる名前にする。
- サンプル値と列名の**両方**を見る。列名が「日付」でも中身が金額なら、それを質問に出す。
- 明細・台帳・一覧など、1行1件のデータ表は取り込む。表紙・目次・凡例・メモ・
  集計だけのシートは取り込まない（include: false）。
- 推測で埋めない。分からないことは questions に回し、人に聞く。
- 出力の日本語は、事実を短く述べる。あいまいな褒め言葉や前置きは書かない。

# 出力
下記スキーマに厳密に一致する JSON を1つだけ出力。前置き・後書き・コードフェンス禁止。

{
  "sheets": [{ "sheetName": string, "include": boolean, "reason": string }],
  "columns": { "<シート名>": [{ "sourceHeader": string, "name": string, "key": string, "type": string, "reason": string }] },
  "questions": [{ "sheetName": string|null, "message": string, "question": string }]
}

- sourceHeader は入力の「列名」をそのまま写す（突き合わせの鍵。絶対に変えない）。
- name は提案する項目名。変えないなら列名と同じ値。
- key は英小文字・数字・アンダースコアのみ。
- type は次のいずれか: ${FIELD_TYPES.join(" | ")}
- reason は name を変えた理由。変えないなら空文字 ""。
- columns は include: true のシートについてのみ、入力の列すべてを同じ順で並べる。
- questions は「人にしか答えられないこと」だけ。無ければ空配列。`;

/* -------------------------------------------------------------------------- */
/* 応答の検証                                                                  */
/* -------------------------------------------------------------------------- */

const adviceSchema = z.object({
  sheets: z.array(
    z.object({
      sheetName: z.string(),
      include: z.boolean(),
      reason: z.string().default(""),
    }),
  ),
  columns: z.record(
    z.string(),
    z.array(
      z.object({
        sourceHeader: z.string(),
        name: z.string(),
        key: z.string().optional(),
        type: z.string(),
        reason: z.string().default(""),
      }),
    ),
  ),
  questions: z
    .array(
      z.object({
        sheetName: z.string().nullable().default(null),
        message: z.string(),
        question: z.string().default(""),
      }),
    )
    .default([]),
});

/**
 * モデルの返答を、実際のファイルに突き合わせて安全な形に落とす。
 *
 * モデルは列を落とすことも、存在しない列を足すことも、型に嘘を書くこともある。
 * ここで **ファイル側を正** として組み直すので、返答が多少崩れても取り込みは壊れない。
 */
export function reconcileAdvice(
  raw: z.infer<typeof adviceSchema>,
  sheets: SheetParse[],
): ImportAdvice {
  const base = heuristicAdvice(sheets);
  const bySheet = new Map(sheets.map((s) => [s.sheetName, s]));

  const sheetAdvice: SheetAdvice[] = base.sheets.map((fallback) => {
    const parsed = bySheet.get(fallback.sheetName);
    const proposed = raw.sheets.find((x) => x.sheetName === fallback.sheetName);
    // 空・非表示の判断は事実なので、モデルに覆させない。
    if (!proposed || parsed?.empty) return fallback;
    return {
      sheetName: fallback.sheetName,
      include: proposed.include,
      reason: proposed.reason.trim() || fallback.reason,
    };
  });

  const columns: Record<string, ColumnAdvice[]> = {};
  for (const [sheetName, fallbackColumns] of Object.entries(base.columns)) {
    const proposed = raw.columns[sheetName] ?? [];
    const byHeader = new Map(proposed.map((c) => [c.sourceHeader, c]));

    columns[sheetName] = uniquify(
      fallbackColumns.map((fallback) => {
        const p = byHeader.get(fallback.sourceHeader);
        if (!p) return fallback;
        return {
          sourceHeader: fallback.sourceHeader,
          name: p.name.trim() || fallback.name,
          key: p.key,
          // 型はサンプルから推定した方が確かなので、モデルの値が
          // 既知の型でないときは推定を採る。
          type: isFieldType(p.type) ? p.type : fallback.type,
          reason: p.reason.trim(),
        };
      }),
    );
  }

  // 構造の指摘（結合セル等）は事実なので必ず残し、モデルの気づきを足す。
  const structural = base.questions;
  const seen = new Set(structural.map((q) => `${q.sheetName}|${q.message}`));
  const extra = raw.questions
    .filter((q) => q.message.trim().length > 0)
    .filter((q) => !seen.has(`${q.sheetName}|${q.message}`))
    .map((q) => ({
      sheetName: q.sheetName,
      message: q.message,
      question: q.question,
    }));

  return { sheets: sheetAdvice, columns, questions: [...structural, ...extra] };
}

/* -------------------------------------------------------------------------- */
/* 入口                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 下見の提案を返す。APIキーが無ければ即座に決定的な提案を返し、例外は投げない。
 */
export async function adviseImport(sheets: SheetParse[]): Promise<AdviceResult> {
  const usable = sheets.filter((s) => !s.empty);
  if (usable.length === 0 || !env.ANTHROPIC_API_KEY) {
    return { advice: heuristicAdvice(sheets), via: "heuristic" };
  }

  try {
    const payload = buildAdvisorPayload(sheets);
    const res = await fetchWithTimeout(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `次のファイルの下見結果です。提案をJSONで返してください。\n\n${JSON.stringify(payload, null, 1)}`,
          },
        ],
      }),
    });

    if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new Error("empty response");

    const parsed = adviceSchema.parse(JSON.parse(stripFence(text)));
    return { advice: reconcileAdvice(parsed, sheets), via: "anthropic" };
  } catch {
    // 提案が出せないことは、取り込みを止める理由にならない。
    return { advice: heuristicAdvice(sheets), via: "heuristic" };
  }
}

/** モデルが付けがちなコードフェンスを剥がす。 */
export function stripFence(text: string): string {
  const t = text.trim();
  if (!t.startsWith("```")) return t;
  return t.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
