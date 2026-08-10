import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6 text-center">
      <div className="max-w-md space-y-4">
        <Logo className="mx-auto" />
        <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
          404
        </p>
        <h1 className="text-xl font-semibold text-ink">
          ページが見つかりません
        </h1>
        <p className="text-sm text-ink-muted">
          お探しのページは移動または削除された可能性があります。
        </p>
        <div className="pt-1">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center rounded bg-khaki-500 px-4 text-sm font-medium text-white hover:bg-khaki-600"
          >
            ダッシュボードへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
