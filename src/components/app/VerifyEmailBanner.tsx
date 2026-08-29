"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { NavIcon } from "./icons";

/**
 * メールアドレスの確認をうながす帯。
 *
 * 確認が済むまで**中の機能は止めない**。止めるのは公開リンクの作成だけで、
 * それはここに書いておく（何ができないのかが分からない警告は、ただの雑音）。
 * 一度閉じたらその画面では出さない——毎ページ出す帯は読まれなくなる。
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (hidden) return null;

  async function resend() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "送信に失敗しました");
      setNote(
        json.data?.alreadyVerified
          ? "確認は既に完了しています。画面を再読み込みしてください。"
          : "確認メールを再送しました。",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-ink-line bg-warning-soft/60 px-4 py-2 text-xs sm:px-5">
      <NavIcon name="bell" className="hidden h-4 w-4 shrink-0 text-warning sm:block" />
      {/*
        狭い画面では、文章だけで1行を占めさせる。

        `flex-1`（flex-basis: 0）のままだとボタンが先に幅を取り、文章は
        残った隙間に押し込まれる——390px の画面で実際に**1文字ずつ縦に
        折り返り**、バナーだけで画面の3分の1を占めていた。`w-full` にすれば
        `flex-wrap` が効いて、ボタンは次の行へ降りる。
      */}
      <p className="w-full min-w-0 text-ink-soft sm:w-auto sm:flex-1">
        <NavIcon name="bell" className="mr-1 inline-block h-3.5 w-3.5 shrink-0 align-[-2px] text-warning sm:hidden" />
        <span className="font-medium text-ink">{email}</span> の確認が済んでいません。
        確認が済むまで、ダッシュボードの<span className="font-medium text-ink">公開リンク</span>は作成できません。
      </p>
      {note && <span className="text-ink-soft">{note}</span>}
      {error && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
      <Button size="sm" variant="secondary" onClick={resend} disabled={busy}>
        {busy ? "送信中…" : "確認メールを再送"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setHidden(true)}>
        閉じる
      </Button>
    </div>
  );
}
