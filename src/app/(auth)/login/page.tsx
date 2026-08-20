"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Card, CardBody } from "@/components/ui/Card";

/**
 * デモアカウントの案内は、開発中だけ出す。
 *
 * 本番のログイン画面に生の認証情報を印刷していると、`npm run setup` が
 * seed まで走る既定の手順で作られたデモ口座に、誰でもそのまま入れてしまう。
 * 「デモを見る」導線のために置いていたものだが、公開環境で出す理由はない。
 */
const SHOW_DEMO = process.env.NODE_ENV !== "production";
const DEMO_EMAIL = "owner@demo.dashdrop";
const DEMO_PASSWORD = "demo1234";

/**
 * ログイン後の戻り先。
 *
 * ミドルウェアは保護されたURLへ来た未ログイン利用者を
 * `/login?next=<元のパス>` へ送っているのに、この画面がその値を読んでおらず、
 * どこから来ても /home に着地していた。共有された深いリンクを開いた人が
 * 毎回ホームに飛ばされる。
 *
 * 受け取ってよいのは自サイト内の絶対パスだけ。`//evil.example.com` のような
 * 値をそのまま渡すと、ログイン直後に外部サイトへ飛ばせてしまう。
 *
 * useSearchParams() ではなく送信時に location から読むのは、この画面が
 * 静的に事前生成されるため（フックを使うと Suspense 境界が必須になる）。
 */
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.startsWith("/login") || raw.startsWith("/signup")) return null;
  return raw;
}

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
      const next = safeNext(
        new URLSearchParams(window.location.search).get("next"),
      );
      router.push(next ?? body.data?.redirect ?? "/home");
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
            <div className="flex items-baseline justify-between">
              <Label htmlFor="password">パスワード</Label>
              {/* 忘れた人の逃げ道は、入力欄の隣に置く。探させない。 */}
              <Link
                href="/forgot"
                className="text-xs text-khaki-700 hover:underline"
              >
                お忘れですか？
              </Link>
            </div>
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

        {SHOW_DEMO && (
          <button
            type="button"
            onClick={fillDemo}
            className="mt-4 w-full rounded border border-khaki-200 bg-khaki-50 px-3 py-2.5 text-left text-xs text-khaki-800 transition-colors hover:bg-khaki-100"
          >
            <span className="font-semibold">デモアカウント（開発環境のみ）</span>
            <span className="mt-0.5 block text-khaki-700">
              {DEMO_EMAIL} / {DEMO_PASSWORD}
            </span>
            <span className="mt-0.5 block text-khaki-600">
              クリックで自動入力
            </span>
          </button>
        )}

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
