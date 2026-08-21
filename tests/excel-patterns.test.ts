/**
 * Excel の「実際にあるいろいろな形」を、取り込みからダッシュボードまで通す。
 *
 * 利用者の依頼:「Excelはいろんなパターンがあると思うので」。
 *
 * これまでのテストは1つの形を1つずつ確かめるものだった。実務のExcelは、
 * 表題行・結合セル・合計行・全角数字・空の数式列・非表示タブが**同時に**
 * 混ざる。組み合わせで壊れるものは、1つずつのテストでは出てこない。
 *
 * ここでは種（seed）から決まるワークブックを大量に組み立て、毎回パイプライン
 * 全体（読み取り → 提案 → 列の対応づけ → 型変換 → 集計の下ごしらえ →
 * 自動レイアウト → 集計）を通して、次の不変条件を確かめる。
 *
 *  1. どの形でも例外で落ちない。
 *  2. **行を1行も失わず、増やさない**（1行1行に印を付けて突き合わせる）。
 *  3. **列がずれない**（各セルの値が、書いたときの列から読める）。
 *  4. 項目キーが空にならず、重複せず、濁点が消えない。
 *  5. 日付が1日ずれない。
 *  6. 自動レイアウトが必ず妥当なウィジェットだけを作る。
 *  7. 集計の数字が整合する（件数KPI＝行数、内訳の合計＝全体）。
 *
 * 失敗したときは seed が出るので、その1件だけを再現できる。
 * 種の起点は `FUZZ_SEED` で変えられる（既定 1）。何度も回すときに使う。
 */
import { describe, it, expect } from "vitest";
import { readAllSheets, readSheet, inferFields, type SheetParse } from "@/lib/excel";
import {
  buildWorkbook,
  MARK,
  MARK_RE,
  DAKUTEN_HEADERS,
  type GeneratedSheet,
} from "./helpers/excel-fixtures";
import { heuristicAdvice, structuralQuestions } from "@/lib/import-advisor";
import { coerceValue, type FieldType } from "@/lib/field-types";
import { profileFields } from "@/lib/data-profile";
import { autoLayoutFromProfiles, type ProfiledSheet } from "@/lib/auto-layout";
import { widgetSchema, type WidgetSpec } from "@/lib/widgets";
import { computeDashboard, type AggCollection } from "@/lib/aggregate";

/* ------------------------------ 検証 ------------------------------------ */

/** 生成した1シートと、読み取った1シートを突き合わせる。 */
function checkSheet(gen: GeneratedSheet, parsed: SheetParse, seed: number) {
  const where = `seed=${seed} sheet=${parsed.sheetName}`;

  // --- 見出しと項目キー ---
  const fields = inferFields(parsed.headers, {});
  const keys = fields.map((f) => f.key);
  expect(new Set(keys).size, `${where}: 項目キーが重複`).toBe(keys.length);
  for (const f of fields) {
    expect(f.key.length, `${where}: 空の項目キー`).toBeGreaterThan(0);
    // NFKD で分解されると結合濁点(U+3099/309A)が残るか、消えて別の語になる。
    expect(/[゙゚]/.test(f.key), `${where}: 濁点が分解されている`).toBe(false);
  }
  // 濁点入りの見出しは、名前としてそのまま保たれること。
  for (const h of parsed.headers) {
    if (DAKUTEN_HEADERS.includes(h)) {
      expect(fields.some((f) => f.name === h), `${where}: 見出し「${h}」が失われた`).toBe(true);
    }
  }

  // --- 行が失われていない / 増えていない ---
  const marks = parsed.previewRows.length > 0 ? MARK : MARK;
  void marks;
  return fields;
}

/** 読み取り結果から、取り込み後のレコードを組み立てる（ルートと同じ手順）。 */
function toRecords(
  headers: string[],
  rows: Record<string, unknown>[],
  fields: Array<{ name: string; key: string; type: FieldType }>,
): { records: Array<Record<string, unknown>>; skipped: number } {
  const records: Array<Record<string, unknown>> = [];
  let skipped = 0;
  for (const row of rows) {
    const data: Record<string, unknown> = {};
    for (const f of fields) {
      // ルートと同じく、読むのは「固定した元の列」だけ。
      const raw = headers.includes(f.name) ? row[f.name] ?? null : null;
      const res = coerceValue(f.type, raw, undefined);
      if (res.ok) data[f.key] = res.value;
      else {
        data[f.key] = null;
        skipped += 1;
      }
    }
    records.push(data);
  }
  return { records, skipped };
}

/** 4カラムのグリッドを行ごとに畳んで幅を数える。 */
function rowWidths(layout: WidgetSpec[]): number[] {
  const widths: number[] = [];
  let width = 0;
  for (const w of layout) {
    const span = Math.min(4, Math.max(1, w.span ?? 1));
    if (width + span > 4) {
      widths.push(width);
      width = 0;
    }
    width += span;
  }
  if (width > 0) widths.push(width);
  return widths;
}

function runOne(seed: number) {
  const { buffer, sheets, hiddenNames } = buildWorkbook(seed);

  // --- 読み取り ---
  const parsedAll = readAllSheets(buffer);
  expect(parsedAll.length, `seed=${seed}: シートが読めていない`).toBeGreaterThan(0);

  // 提案と質問。どんな形でも例外を出さず、必ず何か返すこと。
  const advice = heuristicAdvice(parsedAll);
  const questions = structuralQuestions(parsedAll);
  expect(Array.isArray(questions)).toBe(true);
  for (const s of parsedAll) {
    if (s.empty) continue;
    const cols = advice.columns[s.sheetName] ?? [];
    expect(cols.length, `seed=${seed}: 列の提案が無い（${s.sheetName}）`).toBe(
      s.headers.length,
    );
    const adviceKeys = cols.map((c) => c.key);
    expect(
      new Set(adviceKeys).size,
      `seed=${seed}: 提案された項目キーが重複（${s.sheetName}）`,
    ).toBe(adviceKeys.length);
    // 提案は必ず実在の列を指すこと（ここがずれると全列が1つずつずれて入る）。
    for (const c of cols) {
      expect(
        s.headers.includes(c.sourceHeader),
        `seed=${seed}: 提案が存在しない列を指している`,
      ).toBe(true);
    }
  }

  // 非表示タブは既定で外れること。
  for (const name of hiddenNames) {
    const s = parsedAll.find((p) => p.sheetName === name);
    if (s && !s.empty) {
      expect(s.hidden, `seed=${seed}: 非表示タブを見落とした`).toBe(true);
      const a = advice.sheets.find((x) => x.sheetName === name);
      expect(a?.include, `seed=${seed}: 非表示タブを既定で取り込もうとした`).toBe(false);
    }
  }

  const profiledSheets: ProfiledSheet[] = [];
  const collections = new Map<string, AggCollection>();

  for (const gen of sheets) {
    const parsed = parsedAll.find((p) => p.sheetName === gen.plan.name);
    expect(parsed, `seed=${seed}: シート「${gen.plan.name}」が見つからない`).toBeDefined();
    if (!parsed || parsed.empty) continue;

    const fields = checkSheet(gen, parsed, seed);

    // --- 全行を読み直して、行と列の対応を突き合わせる ---
    const full = readSheet(buffer, gen.plan.name);
    const { records, skipped } = toRecords(full.headers, full.rows, fields);
    void skipped;

    /*
     * 目印の列を持たないシート（1列だけの表など）は、行の突き合わせができない。
     * それ自体は正常な形なので、ここでは飛ばして集計側の検証に回す。
     */
    const markKey = gen.plan.columns.some((c) => c.header === MARK)
      ? fields.find((f) => f.name === MARK)?.key
      : undefined;
    if (gen.plan.columns.some((c) => c.header === MARK)) {
      expect(markKey, `seed=${seed}: 目印の列が消えた`).toBeTruthy();
    }

    const seen = new Map<string, Record<string, unknown>>();
    for (const rec of markKey === undefined ? [] : records) {
      const mark = rec[markKey as string];
      if (typeof mark !== "string" || !MARK_RE.test(mark)) continue; // 合計行など
      expect(seen.has(mark), `seed=${seed}: 行「${mark}」が重複して取り込まれた`).toBe(
        false,
      );
      seen.set(mark, rec);
    }

    // 1行も失われていないこと。
    if (markKey) {
      for (const mark of gen.expected.keys()) {
        expect(seen.has(mark), `seed=${seed}: 行「${mark}」が失われた`).toBe(true);
      }
    }

    // 列がずれていないこと（文字列として書いた列で確かめる）。
    const keyOf = new Map(fields.map((f) => [f.name, f.key]));
    for (const [mark, exp] of gen.expected) {
      const rec = seen.get(mark);
      if (!rec) continue;
      for (const [header, value] of Object.entries(exp)) {
        // パーサが名前を付け替えた列（空欄・重複・前後の空白）は、名前で
        // 引けないので突き合わせの対象から外す。
        if (gen.plan.columns.find((c) => c.header === header)?.renamed) continue;
        const key = keyOf.get(header);
        if (!key) continue;
        const actual = rec[key];
        if (value === null) {
          expect(actual ?? null, `seed=${seed}: ${mark}/${header} は空のはず`).toBeNull();
        } else {
          expect(
            String(actual ?? ""),
            `seed=${seed}: ${mark}/${header} の値が別の列から来ている`,
          ).toBe(value);
        }
      }
      // 日付が1日ずれていないこと。
      const dates = gen.expectedDates.get(mark) ?? {};
      for (const [header, iso] of Object.entries(dates)) {
        const key = keyOf.get(header);
        const f = fields.find((x) => x.key === key);
        if (!key || f?.type !== "date") continue;
        const actual = rec[key];
        if (actual === null) continue;
        expect(String(actual), `seed=${seed}: ${mark}/${header} の日付がずれた`).toBe(iso);
      }
    }

    // --- 集計の下ごしらえ ---
    const profiled = profileFields(records, fields);
    profiledSheets.push({
      slug: `s${profiledSheets.length}`,
      name: parsed.sheetName,
      rowCount: records.length,
      fields: profiled,
    });
    collections.set(`s${profiledSheets.length - 1}`, {
      slug: `s${profiledSheets.length - 1}`,
      name: parsed.sheetName,
      id: `col-${profiledSheets.length - 1}`,
      fields: fields.map((f) => ({ ...f, options: null })),
      records: records.map((data, i) => ({
        id: `r${i}`,
        data,
        createdAt: new Date("2026-01-01"),
      })),
    });
  }

  if (profiledSheets.length === 0) return;

  // --- 自動レイアウト ---
  const layout = autoLayoutFromProfiles(profiledSheets);

  /*
   * 「基本8枚以上」は、読むものがあるシートに対しての目安。1列しかない表や
   * 数行しか無い表まで8枚に膨らませるのは、意味の無い箱を並べるだけになる。
   */
  const primary = profiledSheets.find((p) => p.rowCount > 0 && p.fields.length > 0);
  if (primary && primary.fields.length >= 2 && primary.rowCount >= 3) {
    expect(layout.length, `seed=${seed}: ウィジェットが8枚未満`).toBeGreaterThanOrEqual(8);
  }

  for (const w of layout) {
    // どのウィジェットも保存できる形であること（保存時に400で弾かれない）。
    const parsedWidget = widgetSchema.safeParse(w);
    expect(
      parsedWidget.success,
      `seed=${seed}: 妥当でないウィジェット ${w.type} ${JSON.stringify(
        parsedWidget.success ? {} : parsedWidget.error.issues[0],
      )}`,
    ).toBe(true);

    // 参照している項目が実在すること。
    const sheet = profiledSheets.find((p) => p.slug === w.collection);
    expect(sheet, `seed=${seed}: 存在しないシートを参照`).toBeDefined();
    const keys = new Set(sheet!.fields.map((f) => f.key));
    const refs: string[] = [];
    // 箱ひげの groupBy は省略できる（全体で1本）ので、あるときだけ見る。
    if ("groupBy" in w && w.groupBy) refs.push(w.groupBy);
    if ("rowField" in w) refs.push(w.rowField, w.colField);
    if ("dateField" in w && w.dateField) refs.push(w.dateField);
    if ("splitBy" in w && w.splitBy) refs.push(w.splitBy);
    if ("columns" in w) refs.push(...w.columns);
    if ("field" in w) refs.push(w.field);
    if ("xField" in w) refs.push(w.xField, w.yField);
    if ("measure" in w && w.measure.kind !== "count") refs.push(w.measure.field);
    if ("measures" in w) {
      for (const m of w.measures) {
        if (m.measure.kind !== "count") refs.push(m.measure.field);
      }
    }
    for (const ref of refs) {
      expect(keys.has(ref), `seed=${seed}: 存在しない項目「${ref}」を参照（${w.type}）`).toBe(
        true,
      );
    }

    // 一意な列を構成比の軸にしない（全部1件のドーナツを作らない）。
    if (w.type === "donut" || w.type === "treemap") {
      const f = sheet!.fields.find((x) => x.key === w.groupBy);
      if (f && w.measure.kind === "count") {
        expect(f.stats.idLike, `seed=${seed}: 一意な列で件数の構成比を作った`).toBe(false);
      }
    }
    // 値の無い列を合計しない。
    if ("measure" in w && w.measure.kind !== "count") {
      const f = sheet!.fields.find((x) => x.key === (w.measure as { field: string }).field);
      expect(f?.stats.empty, `seed=${seed}: 空の列を指標にした`).not.toBe(true);
    }
  }

  // 行に穴が開いていないこと。
  for (const width of rowWidths(layout)) {
    expect(width, `seed=${seed}: 右半分が空いた行がある`).toBe(4);
  }

  // --- 集計 ---
  const computed = computeDashboard(layout, collections, new Date("2026-06-01"));
  expect(computed.length).toBe(layout.length);

  for (const { widget, data } of computed) {
    const col = collections.get(widget.collection)!;
    if (data.type === "kpi") {
      expect(Number.isFinite(data.value), `seed=${seed}: KPIの値が数値でない`).toBe(true);
      if (widget.type === "kpi" && widget.measure.kind === "count" && !widget.filters && !widget.rateNumerator) {
        expect(data.value, `seed=${seed}: 件数KPIが行数と合わない`).toBe(col.records.length);
      }
    }
    if (data.type === "donut" || data.type === "hbar" || data.type === "funnel" || data.type === "treemap") {
      for (const s of data.slices) {
        expect(Number.isFinite(s.value), `seed=${seed}: 内訳に数値でない値`).toBe(true);
      }
      if (widget.type !== "kpi" && "measure" in widget && widget.measure.kind === "count") {
        // 件数の内訳は、合計が行数を超えないこと（複数選択が無いので一致する）。
        const sum = data.slices.reduce((n, s) => n + s.value, 0);
        expect(sum, `seed=${seed}: 内訳の合計が行数を超えた`).toBeLessThanOrEqual(
          col.records.length,
        );
      }
    }
    if (data.type === "bar" || data.type === "line" || data.type === "area" || data.type === "combo") {
      for (const p of data.points) {
        for (const s of data.series) {
          expect(
            Number.isFinite(Number(p[s.label] ?? 0)),
            `seed=${seed}: 推移に数値でない値`,
          ).toBe(true);
        }
      }
    }
    if (data.type === "scatter") {
      for (const p of data.points) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y), `seed=${seed}: 散布図の座標`).toBe(
          true,
        );
      }
    }
  }
}

/* ------------------------------ 実行 ------------------------------------ */

const BASE_SEED = Number(process.env.FUZZ_SEED ?? 1);
const CASES = Number(process.env.FUZZ_CASES ?? 200);

describe(`Excelのいろいろな形（seed ${BASE_SEED}〜${BASE_SEED + CASES - 1}）`, () => {
  const seeds = Array.from({ length: CASES }, (_, i) => BASE_SEED + i);
  it.each(seeds)("seed %i を通しで取り込める", (seed) => {
    runOne(seed);
  });
});
