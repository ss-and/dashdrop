import type { ReactNode } from "react";
import { LEGAL_UPDATED_AT } from "@/lib/legal";

/**
 * 規約・ポリシーの共通の器。
 *
 * この手のページで読み手が困るのは、文字の詰まり方であって内容ではないことが
 * 多い。1行の長さを抑え、条ごとに間を空け、最終改定日を必ず上に出す。
 */
export function LegalPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-xs text-ink-muted">
        最終改定日: {LEGAL_UPDATED_AT}
      </p>
      {lead && (
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">{lead}</p>
      )}
      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink-soft">
        {children}
      </div>
    </div>
  );
}

export function Article({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-ink">{heading}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

/**
 * まだ埋まっていない項目。
 *
 * 空文字を黙って出すと、公開してから「ここ空欄でしたよ」と外部に指摘される。
 * 画面上ではっきり分かる形にして、気づかず出せないようにする。
 */
export function Unfilled({ label }: { label: string }) {
  return (
    <span className="rounded-sm border border-danger/40 bg-danger-soft px-1.5 py-0.5 text-xs font-medium text-danger">
      未記入（{label}）
    </span>
  );
}
