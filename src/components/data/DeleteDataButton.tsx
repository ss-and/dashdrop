"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { NavIcon } from "@/components/app/icons";

/**
 * データを消す。
 *
 * ダッシュボードは消せるのに、取り込んだデータは消せなかった——間違えて
 * 入れたExcelが、一覧に残り続ける状態だった。
 *
 * ここで気をつけているのは3つ。
 *
 *  1. **押す前に、何が消えて何が壊れるかを見せる。** 行数と、中身が空になる
 *     ダッシュボード名を出す。どちらも消した後では分からない。
 *  2. **行が入っているものは、名前を打たないと消せない。** 元に戻す手段が
 *     無いので、確認ダイアログ1枚では軽すぎる。空のシートは1押しで消せる。
 *  3. **消す前に書き出せる導線を置く。** 「消したいが、念のため取っておきたい」
 *     が普通の気持ちなので、そこで手を止めさせない。
 */

export type DeleteTargetKind = "sheet" | "file";

const LABEL: Record<DeleteTargetKind, { noun: string; button: string }> = {
  sheet: { noun: "スプレッドシート", button: "このシートを削除" },
  file: { noun: "ファイル", button: "このファイルを削除" },
};

export function DeleteDataButton({
  kind,
  id,
  name,
  rowCount,
  sheetNames = [],
  affectedDashboards = [],
  emptiedDashboards = [],
  exportHref,
  redirectTo,
}: {
  kind: DeleteTargetKind;
  id: string;
  name: string;
  /** 消える行数。 */
  rowCount: number;
  /** ファイルのとき、中のシート名。 */
  sheetNames?: string[];
  /** 中身が一部でも欠けるダッシュボード名（残る）。 */
  affectedDashboards?: string[];
  /** 見るものが1つも無くなるダッシュボード。一緒に片付けられる。 */
  emptiedDashboards?: Array<{ id: string; name: string }>;
  /** 先に書き出すためのリンク（シートのみ）。 */
  exportHref?: string;
  /** 消した後の行き先。 */
  redirectTo: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  /*
   * 空になるダッシュボードを一緒に消すか。既定は「消す」——データ元が全部
   * 無くなる以上、残しても空の枠が並ぶだけで、片付けにもう一手かかる。
   * 消したくない人のために外せるようにはしておく。
   */
  const [alsoDashboards, setAlsoDashboards] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = LABEL[kind];
  // 行が1件でも入っていれば、名前を打つまで消せない。
  const needsTyping = rowCount > 0;
  const armed = !needsTyping || typed.trim() === name.trim();

  async function remove() {
    if (!armed) return;
    setBusy(true);
    setError(null);
    try {
      const base = kind === "file" ? `/api/workbooks/${id}` : `/api/collections/${id}`;
      const path =
        alsoDashboards && emptiedDashboards.length > 0
          ? `${base}?dashboards=delete`
          : base;
      const res = await fetch(path, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "削除に失敗しました");
      }
      router.push(redirectTo);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="text-danger hover:bg-danger-soft"
      >
        <NavIcon name="trash" className="h-4 w-4" />
        削除
      </Button>
    );
  }

  return (
    <div className="w-full max-w-md space-y-3 rounded-md border border-danger/30 bg-danger-soft/40 p-4 text-left">
      <div>
        <h3 className="text-sm font-semibold text-ink">
          「{name}」を削除します
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          この{label.noun}と、その中のデータをすべて消します。
          <span className="font-medium text-danger">元に戻すことはできません。</span>
        </p>
      </div>

      <ul className="space-y-1 border-t border-danger/20 pt-2 text-xs text-ink-soft">
        <li>
          消える行数
          <span className="ml-2 tabular-nums font-medium text-ink">
            {rowCount.toLocaleString()} 行
          </span>
        </li>
        {sheetNames.length > 0 && (
          <li>
            消えるシート
            <span className="ml-2 text-ink">
              {sheetNames.join("、")}（{sheetNames.length}枚）
            </span>
          </li>
        )}
        {affectedDashboards.length > 0 && (
          /*
           * ダッシュボードは既定では残す（利用者が作ったもの）。ただし中身は
           * 欠けるので、どれが影響を受けるかは必ず名指しで伝える。
           */
          <li className="text-danger">
            中身が欠けるダッシュボード:{" "}
            <span className="font-medium">{affectedDashboards.join("、")}</span>
          </li>
        )}
      </ul>

      {emptiedDashboards.length > 0 && (
        <label className="flex cursor-pointer items-start gap-2 border-t border-danger/20 pt-2 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={alsoDashboards}
            onChange={(e) => setAlsoDashboards(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-danger"
          />
          <span>
            見るものが無くなる{" "}
            <span className="font-medium text-ink">
              {emptiedDashboards.map((d) => d.name).join("、")}
            </span>{" "}
            も一緒に削除する
          </span>
        </label>
      )}

      {exportHref && rowCount > 0 && (
        <a
          href={exportHref}
          className="inline-flex items-center gap-1.5 text-xs text-khaki-700 hover:underline"
        >
          <NavIcon name="download" className="h-3.5 w-3.5" />
          先にExcelで書き出しておく
        </a>
      )}

      {needsTyping && (
        <div>
          <label
            htmlFor={`confirm-${id}`}
            className="block text-xs text-ink-soft"
          >
            消してよければ、名前を入力してください:{" "}
            <span className="font-medium text-ink">{name}</span>
          </label>
          <input
            id={`confirm-${id}`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="input-base mt-1 h-8 w-full text-sm"
            placeholder={name}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={remove}
          disabled={!armed || busy}
          className="bg-danger text-white hover:bg-danger/90 active:bg-danger"
        >
          {busy ? "削除中…" : label.button}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
          disabled={busy}
        >
          やめる
        </Button>
      </div>

      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
