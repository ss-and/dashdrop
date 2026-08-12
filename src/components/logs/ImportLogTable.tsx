/**
 * 「取り込み履歴」 — one row per completed import.
 *
 * Answers "何を・いつ取り込んだか" at a glance: 日時、ファイル名（ブックが残って
 * いればリンク）、取り込み元、シート数、行数。変換できなかったセルがあれば、
 * その件数を控えめに添える。
 *
 * Pure presentation: the page normalises the Activity rows and hands over
 * ready-to-render values.
 */
import Link from "next/link";
import { NavIcon } from "@/components/app/icons";

export interface ImportLogRow {
  id: string;
  /** 表示用の日時（YYYY/MM/DD HH:mm）。 */
  at: string;
  fileName: string;
  /** ブックがまだ存在するときだけリンク先が入る。 */
  href: string | null;
  /** Excel / CSV / Google スプレッドシート。 */
  sourceLabel: string;
  sheetCount: number | null;
  rowCount: number | null;
  /** 変換できなかったセル数（0 のときは出さない）。 */
  skipped: number;
  sheetNames: string[];
}

function num(v: number | null): string {
  return v === null ? "—" : v.toLocaleString();
}

export function ImportLogTable({ rows }: { rows: ImportLogRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10">
        <p className="text-sm text-ink-faint">まだ取り込み履歴がありません</p>
        <Link
          href="/import"
          className="inline-flex items-center gap-1 text-xs font-medium text-khaki-700 hover:text-khaki-800 hover:underline"
        >
          <NavIcon name="upload" className="h-3 w-3" />
          Excelを取り込む
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-paper-sunken text-2xs uppercase tracking-wider text-ink-faint">
            <th className="whitespace-nowrap px-4 py-2 text-left font-semibold">
              日時
            </th>
            <th className="px-4 py-2 text-left font-semibold">ファイル名</th>
            <th className="whitespace-nowrap px-4 py-2 text-left font-semibold">
              取り込み元
            </th>
            <th className="whitespace-nowrap px-4 py-2 text-right font-semibold">
              シート数
            </th>
            <th className="whitespace-nowrap px-4 py-2 text-right font-semibold">
              行数
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-line">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-paper-sunken/60">
              <td className="whitespace-nowrap px-4 py-2.5 align-top tabular-nums text-ink-soft">
                {r.at}
              </td>
              <td className="px-4 py-2.5 align-top">
                {r.href ? (
                  <Link
                    href={r.href}
                    className="font-medium text-khaki-700 hover:text-khaki-800 hover:underline"
                  >
                    {r.fileName}
                  </Link>
                ) : (
                  <span className="font-medium text-ink">{r.fileName}</span>
                )}
                {r.sheetNames.length > 0 && (
                  <p className="mt-0.5 text-2xs text-ink-muted">
                    {r.sheetNames.join(" / ")}
                  </p>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 align-top text-ink-soft">
                {r.sourceLabel}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right align-top tabular-nums text-ink">
                {num(r.sheetCount)}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right align-top tabular-nums text-ink">
                {num(r.rowCount)}
                {r.skipped > 0 && (
                  <span className="ml-2 text-2xs text-ink-muted">
                    未変換 {r.skipped.toLocaleString()} セル
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
