import type { Metadata } from "next";
import Link from "next/link";
import { PLANS, PLAN_ORDER, formatPrice, getPlan } from "@/lib/plans";
import { billingEnabled } from "@/lib/env";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "料金プラン",
  description:
    "DashDrop の料金プラン。個人から本格運用まで、わかりやすい3プラン。",
};

/** Small khaki check used in each feature list. */
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-4 w-4 flex-none text-khaki-600"
      aria-hidden="true"
    >
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

const CTA: Record<string, { label: string; href: string }> = {
  free: { label: "無料で始める", href: "/signup" },
  pro: { label: "Proで始める", href: "/signup?plan=pro" },
  business: { label: "Businessで始める", href: "/signup?plan=business" },
};

const FAQ = [
  {
    q: "支払い方法は何がありますか？",
    a: "クレジットカードでのお支払いに対応予定です（Stripe を利用）。現在はベータ提供中のため、有料プランの決済は順次開始します。",
  },
  {
    q: "途中でプランを変更できますか？",
    a: "はい。いつでもアップグレード・ダウングレードが可能です。変更は次回の請求サイクルから反映されます。",
  },
  {
    q: "解約はできますか？",
    a: "いつでも解約できます。最低利用期間の縛りはありません。解約後も、期間終了まではご利用いただけます。",
  },
  {
    q: "データのエクスポートはできますか？",
    a: "すべてのプランで、テーブルを Excel / CSV にエクスポートできます。データの所有権はお客様にあり、いつでも持ち出せます。",
  },
];

export default function PricingPage() {
  return (
    <div className="animate-fade-in">
      {/* Header */}
      <section className="mx-auto max-w-content px-4 pb-10 pt-16 text-center sm:px-6 sm:pt-20 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          シンプルで、わかりやすい料金
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-soft">
          小さく始めて、必要になったら広げる。すべてのプランに Excel / CSV
          連携と週間ダッシュボードが含まれます。
        </p>
      </section>

      {/* Plan grid */}
      <section className="mx-auto max-w-content px-4 pb-8 sm:px-6 lg:px-8">
        <div className="grid gap-5 md:grid-cols-3">
          {PLAN_ORDER.map((id) => {
            const plan = getPlan(id);
            const cta = CTA[id] ?? CTA.free;
            const highlighted = Boolean(PLANS[id].highlighted);
            return (
              <Card
                key={id}
                className={cn(
                  "relative flex h-full flex-col",
                  highlighted &&
                    "border-khaki-400 shadow-raised ring-1 ring-khaki-300 md:-translate-y-1",
                )}
              >
                {highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge tone="khaki" variant="soft">
                      おすすめ
                    </Badge>
                  </div>
                )}
                <CardBody className="flex flex-1 flex-col">
                  <h2 className="text-lg font-semibold text-ink">
                    {plan.name}
                  </h2>
                  <p className="mt-1 text-sm text-ink-muted">{plan.tagline}</p>

                  <div className="mt-5 flex items-baseline gap-1">
                    <span className="text-3xl font-semibold tracking-tight text-ink">
                      {formatPrice(plan)}
                    </span>
                    {plan.priceMonthly !== null && (
                      <span className="text-sm text-ink-muted">/ 月</span>
                    )}
                  </div>

                  <ul className="mt-6 flex flex-1 flex-col gap-2.5">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className="flex gap-2 text-sm leading-relaxed text-ink-soft"
                      >
                        <CheckIcon />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8">
                    <Link href={cta.href} className="block">
                      <Button
                        variant={highlighted ? "primary" : "outline"}
                        size="lg"
                        className="w-full"
                      >
                        {cta.label}
                      </Button>
                    </Link>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>

        {/* Beta / billing note */}
        {!billingEnabled && (
          <p className="mt-6 text-center text-sm text-ink-muted">
            現在はベータ提供中です。決済は順次開始予定（Stripe対応予定）。
          </p>
        )}
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-content px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            よくあるご質問
          </h2>
          <dl className="mt-10 divide-y divide-ink-line border-y border-ink-line">
            {FAQ.map((item) => (
              <div key={item.q} className="py-5">
                <dt className="text-base font-semibold text-ink">{item.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-ink-soft">
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 text-center">
            <p className="text-sm text-ink-soft">
              まずは無料で、DashDrop を試してみませんか？
            </p>
            <div className="mt-4">
              <Link href="/signup">
                <Button size="lg">無料で始める</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
