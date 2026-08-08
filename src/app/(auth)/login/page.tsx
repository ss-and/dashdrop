"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Card, CardBody } from "@/components/ui/Card";

const DEMO_EMAIL = "owner@demo.dashdrop";
const DEMO_PASSWORD = "demo1234";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "ログインに失敗しました");
        return;
      }
      router.push(body.data?.redirect ?? "/dashboard");
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。しばらくして再度お試しください。");
    } finally {
      setLoading(false);
    }
  }

  function fillDemo() {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <Card className="animate-fade-in">
      <CardBody className="p-6">
        <h1 className="text-lg font-semibold text-ink">ログイン</h1>
        <p className="mt-1 text-sm text-ink-muted">
          アカウントにサインインして続行
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              {error}
            </div>
          )}

          <div>
            <Label htmlFor="email">メールアドレス</Label>
            <Input
              id="email"
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <Label htmlFor="password">パスワード</Label>
            <Input
              id="password"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "サインイン中…" : "ログイン"}
          </Button>
        </form>

        <button
          type="button"
          onClick={fillDemo}
          className="mt-4 w-full rounded border border-khaki-200 bg-khaki-50 px-3 py-2.5 text-left text-xs text-khaki-800 transition-colors hover:bg-khaki-100"
        >
          <span className="font-semibold">デモアカウント</span>
          <span className="mt-0.5 block text-khaki-700">
            {DEMO_EMAIL} / {DEMO_PASSWORD}
          </span>
          <span className="mt-0.5 block text-khaki-600">
            クリックで自動入力
          </span>
        </button>

        <p className="mt-5 text-center text-sm text-ink-muted">
          アカウントをお持ちでない方は{" "}
          <Link
            href="/signup"
            className="font-medium text-khaki-700 hover:text-khaki-800 hover:underline"
          >
            新規登録
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
