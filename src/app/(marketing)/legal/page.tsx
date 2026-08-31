/**
 * 特定商取引法に基づく表記。
 *
 * ## いつ出すべきページなのか
 *
 * この表示の義務は「通信販売」——つまり**有料で売ったとき**に生じる。
 * 無償で提供している間は義務が無い。にもかかわらず、以前はいつでも全項目を
 * 並べ、埋まっていない必須項目を赤い枠で「未記入です」と出していた。しかも
 * その文面に `src/lib/legal.ts` という**内部のファイル名**が入っていた。
 *
 * つまり無償公開の初日から、誰でも開けるページで
 *   「このページは未完成です」＋ソースの置き場所
 * を掲げることになる。義務が無い表示のせいで、信用だけが落ちる形だった。
 *
 * そこで、有料販売が始まっているか（`anyPlanPurchasable`）で出し分ける。
 * これは料金ページの「お申し込み」導線を出すかどうかと**同じ判定**なので、
 * 「売っているのに表記が無い」も「売っていないのに未完成表示が出る」も
 * 同時に起きなくなる。売り始めたのに未記入が残っていたら、
 * tests/legal.test.ts が落ちる。
 */
import type { Metadata } from "next";
import { LegalPage, Unfilled } from "@/components/legal/LegalPage";
import { COMMERCE_ENTRIES, missingCommerceEntries, SELLER_ENTRIES } from "@/lib/legal";
import { anyPlanPurchasable } from "@/lib/plans";

export const metadata: Metadata = {
  title: "特定商取引法に基づく表記 | DashDrop",
};

function Table({ entries }: { entries: typeof COMMERCE_ENTRIES }) {
  return (
    <dl className="divide-y divide-ink-line rounded-md border border-ink-line">
      {entries.map((e) => (
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
  );
}

export default function CommercePage() {
  /*
   * 売っていないとき。義務は無いが、**誰が運営しているか**は出す。
   * 名前も連絡先も無いサービスに会社のデータを預ける人はいない。
   */
  if (!anyPlanPurchasable) {
    return (
      <LegalPage title="特定商取引法に基づく表記">
        <p className="text-sm leading-relaxed text-ink-soft">
          DashDrop は現在、無償でご提供しています。特定商取引法に基づく表示は
          有料でのご提供を開始する際に、この場所に掲出します。
        </p>
        <p className="text-sm leading-relaxed text-ink-soft">
          運営者は次のとおりです。
        </p>
        <Table entries={SELLER_ENTRIES} />
      </LegalPage>
    );
  }

  const missing = missingCommerceEntries();

  return (
    <LegalPage title="特定商取引法に基づく表記">
      {missing.length > 0 && (
        /*
         * ここに来るのは、テストをすり抜けて売り始めてしまった場合だけ。
         * 内部のファイル名は出さない（読むのは利用者なので、できることが無い）。
         */
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-soft p-4 text-sm text-danger"
        >
          <p className="font-semibold">この表記は準備中です</p>
          <p className="mt-1 leading-relaxed">
            記載が整うまで、お手数ですが上記のメールアドレスまでお問い合わせください。
          </p>
        </div>
      )}
      <Table entries={COMMERCE_ENTRIES} />
    </LegalPage>
  );
}
