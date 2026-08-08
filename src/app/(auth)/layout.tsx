import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

/**
 * Public, centered shell for the authentication pages (login / signup).
 * No sidebar, no auth guard — the paper background with a single narrow card.
 * Server component.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex justify-center">
          <Link href="/" aria-label="DashDrop ホーム">
            <Logo />
          </Link>
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-ink-faint">
          スプレッドシート発想の経営ダッシュボード
        </p>
      </div>
    </div>
  );
}
