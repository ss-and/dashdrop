"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Card, CardBody } from "@/components/ui/Card";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          // Omit when blank so the schema's optional handling applies.
          ...(workspaceName.trim() ? { workspaceName } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "登録に失敗しました");
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

  return (
    <Card className="animate-fade-in">
      <CardBody className="p-6">
        <h1 className="text-lg font-semibold text-ink">アカウント作成</h1>
        <p className="mt-1 text-sm text-ink-muted">
          無料で始められます。クレジットカードは不要です。
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
            <Label htmlFor="name">お名前</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="山田 太郎"
            />
          </div>

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
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8文字以上"
            />
            <p className="mt-1 text-xs text-ink-faint">8文字以上で設定してください</p>
          </div>

          <div>
            <Label htmlFor="workspaceName">
              会社名 / ワークスペース名{" "}
              <span className="font-normal text-ink-faint">(任意)</span>
            </Label>
            <Input
              id="workspaceName"
              name="workspaceName"
              autoComplete="organization"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="株式会社サンプル"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "作成中…" : "アカウントを作成"}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-muted">
          すでにアカウントをお持ちの方は{" "}
          <Link
            href="/login"
            className="font-medium text-khaki-700 hover:text-khaki-800 hover:underline"
          >
            ログイン
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
