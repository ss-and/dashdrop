"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Card, CardBody } from "@/components/ui/Card";

/** 新しいパスワードの入力。トークンはURLのクエリで受け取る。 */
function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打ち間違いをそのまま確定させない。片方だけ見て通すと、次に入れなくなる。
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= 8 && password === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "再設定に失敗しました");
      }
      router.push("/home");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "再設定に失敗しました");
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-danger">
          再設定用のリンクが正しくありません。もう一度やり直してください。
        </p>
        <Link href="/forgot" className="text-sm text-khaki-700 hover:underline">
          再設定をやり直す
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="password">新しいパスワード（8文字以上）</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="confirm">確認のため、もう一度</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch}
        />
        {mismatch && (
          <p className="mt-1 text-xs text-danger">パスワードが一致しません。</p>
        )}
      </div>
      <Button type="submit" disabled={busy || !ready} className="w-full">
        {busy ? "設定中…" : "パスワードを設定する"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

export default function ResetPage() {
  return (
    <Card className="w-full max-w-md">
      <CardBody className="space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-ink">新しいパスワードの設定</h1>
          <p className="mt-1 text-sm text-ink-muted">
            設定が終わると、そのままログインします。
          </p>
        </div>
        {/* useSearchParams はビルド時に Suspense 境界を要求する。 */}
        <Suspense fallback={<p className="text-sm text-ink-muted">読み込み中…</p>}>
          <ResetForm />
        </Suspense>
      </CardBody>
    </Card>
  );
}
