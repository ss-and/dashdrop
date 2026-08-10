"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * App-wide error boundary. Shows a calm, honest message with a retry, and
 * surfaces the actual reason (in a collapsible) so a stuck user — or the person
 * helping them — can see WHY it failed instead of a blank screen.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6 text-center">
      <div className="max-w-md space-y-4">
        <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
          エラー
        </p>
        <h1 className="text-xl font-semibold text-ink">
          問題が発生しました
        </h1>
        <p className="text-sm text-ink-muted">
          操作を完了できませんでした。もう一度お試しください。何度も発生する場合は、
          少し時間をおくか、下の詳細をサポートにお知らせください。
        </p>

        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            onClick={reset}
            className="inline-flex h-10 items-center rounded bg-khaki-500 px-4 text-sm font-medium text-white hover:bg-khaki-600"
          >
            もう一度試す
          </button>
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center rounded border border-ink-line bg-paper-raised px-4 text-sm font-medium text-ink-soft hover:bg-paper-sunken"
          >
            ダッシュボードへ
          </Link>
        </div>

        {(error?.message || error?.digest) && (
          <details className="mt-2 text-left">
            <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink-muted">
              技術的な詳細
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-md border border-ink-line bg-paper-sunken p-3 text-2xs text-ink-soft">
              {error.message}
              {error.digest ? `\n(ref: ${error.digest})` : ""}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
