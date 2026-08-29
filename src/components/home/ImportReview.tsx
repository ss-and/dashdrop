"use client";

import { useMemo, useState } from "react";
import { NavIcon } from "@/components/app/icons";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  FIELD_TYPES,
  FIELD_TYPE_META,
  isFieldType,
  type FieldType,
} from "@/lib/field-types";
import { DashboardIntentPicker } from "./DashboardIntentPicker";
import { DEFAULT_INTENT, type DashboardIntent } from "@/lib/dashboard-intent";

/**
 * 取り込む前の確認画面 —「この内容で入れますが、良いですか？」
 *
 * 置いたら即取り込む挙動は速いが、中身が想定と違ったときに気づけない。
 * 実際に壊れたのは「複数タブのうち1枚しか入らない」「結合セルで列名が欠ける」
 * のように、**取り込んだ後では分からない**類のものだった。
 *
 * ここでは、事実（何行・何列・結合セル・見出し行）と提案（シートの取捨、項目名）を
 * 並べて見せ、人にしか答えられないことは質問として上に出す。全部そのままでも
 * 1クリックで進めるので、確認したい人だけが立ち止まれる。
 */

export interface AdviceColumn {
  sourceHeader: string;
  name: string;
  key: string;
  type: string;
  reason: string;
}

export interface AdviceSheet {
  sheetName: string;
  include: boolean;
  reason: string;
}

export interface AdviceQuestion {
  sheetName: string | null;
  message: string;
  question: string;
}

export interface AnalyzedSheet {
  sheetName: string;
  headers: string[];
  rowCount: number;
  empty: boolean;
  hidden: boolean;
  headerRowIndex: number;
  merges: { count: number };
}

/** 同じ名前で既に入っているファイル。無ければ null。 */
export interface ExistingWorkbook {
  workbookId: string;
  name: string;
  importedAt: string;
  sheets: Array<{ name: string; slug: string; rowCount: number }>;
}

export interface AnalyzeResult {
  fileName: string;
  fileBase: string;
  sheets: AnalyzedSheet[];
  advice: {
    sheets: AdviceSheet[];
    columns: Record<string, AdviceColumn[]>;
    questions: AdviceQuestion[];
  };
  via: "anthropic" | "heuristic";
  existing: ExistingWorkbook | null;
}

/** 同名ファイルの扱い。 */
export type ImportMode = "replace" | "add";

/** 画面が /api/import に送る形。 */
export interface SheetSelection {
  sheetName: string;
  collectionName: string;
  fields: Array<{
    name: string;
    key: string;
    type: FieldType;
    sourceHeader: string;
  }>;
}

interface SheetState {
  include: boolean;
  collectionName: string;
  columns: AdviceColumn[];
}

export function ImportReview({
  result,
  busy,
  onConfirm,
  onCancel,
}: {
  result: AnalyzeResult;
  busy: boolean;
  onConfirm: (
    selection: SheetSelection[],
    mode: ImportMode,
    intent: DashboardIntent,
  ) => void;
  onCancel: () => void;
}) {
  /*
   * 欲しい画面の指定。既定（おまかせ／チームで見る／標準）のままなら、
   * これまでと同じダッシュボードが出る。
   */
  const [intent, setIntent] = useState<DashboardIntent>(DEFAULT_INTENT);
  /*
   * 同名ファイルがあるときの既定は「上書き」。
   *
   * 毎月同じ台帳を入れ直すのが普通の使い方で、そのたびに増えていくと
   * サイドバーに同じ名前が並んで、どれが最新か分からなくなる。ただし
   * 消える側の中身は戻せないので、何が置き換わるのかを必ず先に見せる。
   */
  const [mode, setMode] = useState<ImportMode>(
    result.existing ? "replace" : "add",
  );
  const importable = useMemo(
    () => result.sheets.filter((s) => !s.empty),
    [result.sheets],
  );

  const [state, setState] = useState<Record<string, SheetState>>(() => {
    const initial: Record<string, SheetState> = {};
    for (const s of importable) {
      const advice = result.advice.sheets.find(
        (a) => a.sheetName === s.sheetName,
      );
      initial[s.sheetName] = {
        include: advice?.include ?? true,
        // タブが1枚だけのファイル（CSVなど）は、ファイル名の方が中身を表す。
        collectionName:
          importable.length === 1 && result.fileBase
            ? result.fileBase
            : s.sheetName,
        columns: result.advice.columns[s.sheetName] ?? [],
      };
    }
    return initial;
  });

  const chosen = importable.filter((s) => state[s.sheetName]?.include);
  const renamed = chosen.reduce(
    (n, s) =>
      n + (state[s.sheetName]?.columns.filter((c) => c.reason).length ?? 0),
    0,
  );

  function patchSheet(sheetName: string, patch: Partial<SheetState>) {
    setState((prev) => ({
      ...prev,
      [sheetName]: { ...prev[sheetName], ...patch },
    }));
  }

  function patchColumn(
    sheetName: string,
    sourceHeader: string,
    patch: Partial<AdviceColumn>,
  ) {
    setState((prev) => ({
      ...prev,
      [sheetName]: {
        ...prev[sheetName],
        columns: prev[sheetName].columns.map((c) =>
          c.sourceHeader === sourceHeader ? { ...c, ...patch } : c,
        ),
      },
    }));
  }

  function confirmMapping() {
    onConfirm(
      chosen.map((s) => {
        const st = state[s.sheetName];
        return {
          sheetName: s.sheetName,
          collectionName: st.collectionName.trim() || s.sheetName,
          fields: st.columns.map((c) => ({
            name: c.name.trim() || c.sourceHeader,
            key: c.key,
            type: isFieldType(c.type) ? c.type : "text",
            sourceHeader: c.sourceHeader,
          })),
        };
      }),
      result.existing ? mode : "add",
      intent,
    );
  }

  return (
    <section className="space-y-5">
      {/* 見出し */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">取り込む内容の確認</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {result.fileName} — {importable.length} シート
            {renamed > 0 && `／項目名の変更提案 ${renamed} 件`}
          </p>
        </div>
        <Badge tone={result.via === "anthropic" ? "khaki" : "neutral"} variant="soft">
          {result.via === "anthropic" ? "AIが提案" : "標準の推定"}
        </Badge>
      </div>

      {/* 質問 — 人にしか答えられないこと */}
      {result.advice.questions.length > 0 && (
        <div className="space-y-2 rounded-md border border-warning/30 bg-warning-soft/50 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <NavIcon name="sparkles" className="h-4 w-4 shrink-0 text-warning" />
            確認したいこと
          </h3>
          <ul className="space-y-2.5">
            {result.advice.questions.map((q, i) => (
              <li key={i} className="text-sm">
                {q.sheetName && (
                  <span className="mr-1.5 font-medium text-ink">
                    {q.sheetName}:
                  </span>
                )}
                <span className="text-ink-soft">{q.message}</span>
                {q.question && (
                  <span className="mt-0.5 block font-medium text-ink">
                    {q.question}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 同名ファイルがある場合の選択 */}
      {result.existing && (
        <div className="space-y-3 rounded-md border border-ink-line bg-paper-raised p-4">
          <h3 className="text-sm font-semibold text-ink">
            同じ名前のファイルが既にあります
          </h3>
          <p className="text-sm text-ink-soft">
            「{result.existing.name}」（
            {result.existing.sheets.length.toLocaleString()} シート・
            {result.existing.sheets
              .reduce((n, s) => n + s.rowCount, 0)
              .toLocaleString()}
            行）
          </p>

          <div className="space-y-2">
            {(
              [
                {
                  value: "replace" as const,
                  label: "上書きして更新する",
                  hint: "同じ名前のシートは中身を入れ替えます。ダッシュボードとURLはそのまま使えます。",
                },
                {
                  value: "add" as const,
                  label: "別のファイルとして追加する",
                  hint: "今あるものは残したまま、新しく増やします。名前には (2) が付きます。",
                },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-start gap-2.5 rounded px-2 py-1.5 transition-colors duration-fast hover:bg-paper-sunken"
              >
                <input
                  type="radio"
                  name="import-mode"
                  value={opt.value}
                  checked={mode === opt.value}
                  onChange={() => setMode(opt.value)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-khaki-500"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">
                    {opt.label}
                  </span>
                  <span className="block text-xs text-ink-muted">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {mode === "replace" && (
            /* 何が消えるのかを、押す前に名前と行数で見せる。 */
            <ul className="space-y-0.5 border-t border-ink-line pt-2 text-xs text-ink-muted">
              {result.existing.sheets.map((s) => {
                const willReplace = chosen.some(
                  (c) =>
                    state[c.sheetName]?.collectionName.trim() === s.name ||
                    c.sheetName === s.name,
                );
                return (
                  <li key={s.slug}>
                    {s.name}（{s.rowCount.toLocaleString()}行）—{" "}
                    {willReplace ? "入れ替え" : "そのまま残ります"}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/*
        欲しい画面の指定は、列の一覧より**上**に置く。
        下に置いていたときは、シートの列テーブルが縦に長いせいで画面外に
        追いやられ、そこに何かがあること自体が分からなかった。列名を直すのは
        必要な人だけがやる作業なので、全員が通る道の側に出す。
      */}
      <DashboardIntentPicker value={intent} onChange={setIntent} />

      {/* シートごと */}
      <div className="space-y-4">
        {importable.map((s) => {
          const st = state[s.sheetName];
          if (!st) return null;
          const advice = result.advice.sheets.find(
            (a) => a.sheetName === s.sheetName,
          );
          return (
            <div
              key={s.sheetName}
              className="overflow-hidden rounded-md border border-ink-line bg-paper-raised"
            >
              <div className="flex flex-wrap items-center gap-3 border-b border-ink-line px-4 py-3">
                <label className="flex min-w-0 flex-1 items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={st.include}
                    onChange={(e) =>
                      patchSheet(s.sheetName, { include: e.target.checked })
                    }
                    className="h-4 w-4 shrink-0 accent-khaki-500"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {s.sheetName}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {s.rowCount.toLocaleString()}行 × {s.headers.length}列
                      {s.hidden && "・非表示シート"}
                      {s.merges.count > 0 && `・結合セル ${s.merges.count}`}
                      {advice?.reason ? `　${advice.reason}` : ""}
                    </span>
                  </span>
                </label>

                {st.include && (
                  <label className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
                    名前
                    <input
                      value={st.collectionName}
                      onChange={(e) =>
                        patchSheet(s.sheetName, {
                          collectionName: e.target.value,
                        })
                      }
                      className="input-base w-44 text-sm"
                    />
                  </label>
                )}
              </div>

              {st.include && st.columns.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-paper-sunken text-left">
                        <th className="border-b border-ink-rule px-3 py-2 font-medium text-ink-muted">
                          ファイルの列名
                        </th>
                        <th className="border-b border-ink-rule px-3 py-2 font-medium text-ink-muted">
                          項目名
                        </th>
                        <th className="border-b border-ink-rule px-3 py-2 font-medium text-ink-muted">
                          型
                        </th>
                        <th className="border-b border-ink-rule px-3 py-2 font-medium text-ink-muted">
                          変更の理由
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {st.columns.map((c) => (
                        <tr key={c.sourceHeader} className="border-b border-ink-line">
                          <td className="px-3 py-1.5 align-middle text-ink-soft">
                            <span className="block max-w-[14rem] truncate" title={c.sourceHeader}>
                              {c.sourceHeader}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 align-middle">
                            <input
                              value={c.name}
                              onChange={(e) =>
                                patchColumn(s.sheetName, c.sourceHeader, {
                                  name: e.target.value,
                                })
                              }
                              className="input-base w-48 text-sm"
                            />
                          </td>
                          <td className="px-3 py-1.5 align-middle">
                            <select
                              value={c.type}
                              onChange={(e) =>
                                patchColumn(s.sheetName, c.sourceHeader, {
                                  type: e.target.value,
                                })
                              }
                              className="input-base w-36 text-sm"
                            >
                              {FIELD_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {FIELD_TYPE_META[t].label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-1.5 align-middle text-xs text-ink-muted">
                            {c.reason || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={confirmMapping} disabled={busy || chosen.length === 0}>
          {busy
            ? "取り込み中…"
            : `この内容で取り込む（${chosen.length} シート）`}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          やめる
        </Button>
        {chosen.length === 0 && (
          <span className="text-sm text-ink-muted">
            取り込むシートを1つ以上選んでください。
          </span>
        )}
      </div>
    </section>
  );
}
