"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Card, CardBody } from "@/components/ui/Card";

/**
 * パスワードを忘れたとき。
 *
 * 送信後の文面は、登録の有無に関わらず同じにする。「そのメールアドレスは
 * 登録されていません」と出すと、ログインせずに利用者名簿を総当たりで
 * 調べられてしまう。
 */
export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "処理に失敗しました");
      }
      setSent(json.data.message as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "処理に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardBody className="space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-ink">パスワードの再設定</h1>
          <p className="mt-1 text-sm text-ink-muted">
            ご登録のメールアドレスに、再設定用のリンクをお送りします。
          </p>
        </div>

        {sent ? (
          <>
            <p
              role="status"
              className="rounded border border-success/30 bg-success-soft px-3 py-2 text-sm text-ink-soft"
            >
              {sent}
            </p>
            <Link href="/login" className="text-sm text-khaki-700 hover:underline">
              ログイン画面へ戻る
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy || !email} className="w-full">
              {busy ? "送信中…" : "再設定リンクを送る"}
            </Button>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Link href="/login" className="block text-sm text-khaki-700 hover:underline">
              ログイン画面へ戻る
            </Link>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
