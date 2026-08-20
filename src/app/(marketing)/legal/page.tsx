/**
 * 特定商取引法に基づく表記。
 *
 * 有料で提供する場合、この表示は**法律上の義務**であり、内容は実在の事業者の
 * ものでなければならない。コードで埋められるのは器だけなので、未記入の項目は
 * 画面上ではっきり分かる形で出す（空欄のまま公開されるのを防ぐため）。
 */
import type { Metadata } from "next";
import { LegalPage, Unfilled } from "@/components/legal/LegalPage";
import { COMMERCE_ENTRIES, missingCommerceEntries } from "@/lib/legal";

export const metadata: Metadata = {
  title: "特定商取引法に基づく表記 | DashDrop",
};

export default function CommercePage() {
  const missing = missingCommerceEntries();

  return (
    <LegalPage title="特定商取引法に基づく表記">
      {missing.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-soft p-4 text-sm text-danger"
        >
          <p className="font-semibold">
            このページは未完成です（運営者向けの表示）
          </p>
          <p className="mt-1 leading-relaxed">
            次の必須項目が未記入です: {missing.join("、")}。
            有料での提供を開始する前に <code>src/lib/legal.ts</code> を記入してください。
          </p>
        </div>
      )}

      <dl className="divide-y divide-ink-line rounded-md border border-ink-line">
        {COMMERCE_ENTRIES.map((e) => (
          <div
            key={e.label}
            className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4"
          >
            <dt className="text-sm font-medium text-ink">{e.label}</dt>
            <dd className="text-sm text-ink-soft">
              {e.value.trim() ? e.value : <Unfilled label={e.label} />}
              {e.note && (
                <span className="mt-0.5 block text-xs text-ink-muted">{e.note}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </LegalPage>
  );
}
