import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { MobileNav } from "@/components/marketing/MobileNav";

/**
 * Public marketing chrome (landing + pricing). No auth guard, no app sidebar —
 * a sticky top nav on paper, then the page, then a calm footer.
 * Server component.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      {/* Sticky top nav */}
      <header className="sticky top-0 z-40 border-b border-ink-line bg-paper-raised/90 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-content items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <Link href="/" aria-label="DashDrop ホーム">
              <Logo />
            </Link>
            <div className="hidden items-center gap-6 md:flex">
              <Link
                href="/#features"
                className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
              >
                機能
              </Link>
              <Link
                href="/pricing"
                className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
              >
                料金
              </Link>
              <Link
                href="/contact"
                className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
              >
                お問い合わせ
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden text-sm font-medium text-ink-soft transition-colors hover:text-ink sm:inline"
            >
              ログイン
            </Link>
            {/* 狭い画面では「無料で始める」を出さない。メニューの中に置く。 */}
            <Link href="/signup" className="hidden sm:block">
              <Button size="sm">無料で始める</Button>
            </Link>
            {/*
             * 768px 未満では上の並びが `hidden md:flex` で**1つも出ていなかった**。
             * スマートフォンで開いた人は最下部まで送らないと何も選べない。
             * 日本の中小企業では、最初にスマートフォンで開かれるほうが多い。
             */}
            <MobileNav />
          </div>
        </nav>
      </header>

      {/* Page content */}
      <div className="flex-1">{children}</div>

      {/* Footer */}
      <footer className="border-t border-ink-line bg-paper-raised">
        <div className="mx-auto max-w-content px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <Logo />
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                スプレッドシート感覚で、経営の数字とお客様対応をひとつに。中小企業のためのExcel連携ダッシュボード。
              </p>
            </div>
            <nav className="flex gap-8">
              <div className="flex flex-col gap-2">
                <Link
                  href="/#features"
                  className="text-sm text-ink-soft transition-colors hover:text-ink"
                >
                  機能
                </Link>
                <Link
                  href="/pricing"
                  className="text-sm text-ink-soft transition-colors hover:text-ink"
                >
                  料金
                </Link>
                <Link
                  href="/contact"
                  className="text-sm text-ink-soft transition-colors hover:text-ink"
                >
                  お問い合わせ
                </Link>
                <Link
                  href="/login"
                  className="text-sm text-ink-soft transition-colors hover:text-ink"
                >
                  ログイン
                </Link>
              </div>
              {/*
                規約・ポリシー・特商法は、フッターから常に辿れる場所に置く。
                有料で提供する以上、探さないと見つからない場所ではいけない。
              */}
              <div className="flex flex-col gap-2">
                <Link
                  href="/terms"
                  className="text-sm text-ink-soft transition-colors hover:text-ink"
                >
                  利用規約
                </Link>
                <Link
                  href="/privacy"
                  className="text-sm text-ink-soft transition-colors hover:text-ink"
                >
                  プライバシーポリシー
                </Link>
                <Link
                  href="/legal"
                  className="text-sm text-ink-soft transition-colors hover:text-ink"
                >
                  特定商取引法に基づく表記
                </Link>
              </div>
            </nav>
          </div>
          <div className="mt-8 border-t border-ink-line pt-6">
            <p className="text-xs text-ink-faint">© 2026 DashDrop</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
