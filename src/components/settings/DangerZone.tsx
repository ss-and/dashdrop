"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
// 画面とAPIで同じ文字列でなければ、打っても押せない詰まり方をする。
import { ACCOUNT_DELETE_PHRASE as CONFIRM_PHRASE } from "@/lib/account";

/**
 * 退会。
 *
 * 「消してくれ」に応えられる経路が無いまま公開はできない。ただし押し間違いで
 * 会社のデータが消えるのは論外なので、
 *   - 何が消えて何が残るのかを先に出す
 *   - 決まった文字列を打たないと押せない
 * の2つを必ず通す。書き出しの導線も同じ場所に置く。
 */

export function DangerZone({
  email,
  ownedWorkspaces,
  sharedWorkspaces,
  totalRows,
}: {
  email: string;
  /** 自分だけが所有者＝一緒に消えるワークスペース名。 */
  ownedWorkspaces: string[];
  /** 他にも所有者がいる＝残るワークスペース名。 */
  sharedWorkspaces: string[];
  /** 一緒に消える行数。 */
  totalRows: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const armed = typed.trim() === CONFIRM_PHRASE;

  async function remove() {
    if (!armed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: typed.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "削除に失敗しました");
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setBusy(false);
    }
  }

  return (
    <Card className="border-danger/30">
      <CardHeader>
        <CardTitle>アカウントの削除</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm leading-relaxed text-ink-soft">
          {email} のアカウントと、
          <span className="font-medium text-danger">
            あなたが唯一の所有者であるワークスペースのデータ
          </span>
          を削除します。元に戻すことはできません。
        </p>

        <ul className="space-y-1 rounded-md border border-ink-line bg-paper-sunken px-3 py-2 text-xs text-ink-soft">
          <li>
            一緒に消えるワークスペース:{" "}
            <span className="font-medium text-ink">
              {ownedWorkspaces.length > 0 ? ownedWorkspaces.join("、") : "なし"}
            </span>
          </li>
          <li>
            消える行数:{" "}
            <span className="tabular-nums font-medium text-ink">
              {totalRows.toLocaleString()} 行
            </span>
          </li>
          {sharedWorkspaces.length > 0 && (
            /* 他にも所有者がいる場所は残す。一人が辞めた拍子に、他の人が
               使っている場所ごと消えるのは事故でしかない。 */
            <li>
              残るワークスペース（あなたが抜けるだけ）:{" "}
              <span className="font-medium text-ink">
                {sharedWorkspaces.join("、")}
              </span>
            </li>
          )}
        </ul>

        {!open ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-danger hover:bg-danger-soft"
            onClick={() => setOpen(true)}
          >
            アカウントを削除する
          </Button>
        ) : (
          <div className="space-y-2">
            <label htmlFor="account-confirm" className="block text-xs text-ink-soft">
              消してよければ、
              <span className="font-medium text-ink">{CONFIRM_PHRASE}</span>{" "}
              と入力してください
            </label>
            <Input
              id="account-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="h-8 text-sm"
              placeholder={CONFIRM_PHRASE}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={remove}
                disabled={!armed || busy}
                className="bg-danger text-white hover:bg-danger/90 active:bg-danger"
              >
                {busy ? "削除中…" : "完全に削除する"}
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
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
