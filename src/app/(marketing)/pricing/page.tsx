import type { Metadata } from "next";
import Link from "next/link";
import {
  PLANS,
  PLAN_ORDER,
  formatPrice,
  getPlan,
  plansEnforced,
} from "@/lib/plans";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { Aurora } from "@/components/marketing/Aurora";

/**
 * 料金ページ。
 *
 * 前提: このアプリに有料プランへ移る手段は無い（決済も、Webhookも、
 * アップグレードのAPIも、管理画面からの変更も存在しない。`Workspace.plan` を
 * 書くのはサインアップの "free" だけ）。以前はここに「Proで始める」→
 * `/signup?plan=pro` というボタンが並んでいたが、サインアップ画面は
 * `searchParams` を一切読まないため、押した人は黙って Free のワークスペースを
 * 受け取っていた。「次回の請求サイクルから反映されます」と書かれた請求
 * サイクルも存在しない。
 *
 * そこで、価格表は残しつつ（値付けは伝える価値がある）、今使えるものと
 * 準備中のものを `Plan.available` / `features` / `planned` で厳密に分ける。
 */

export const metadata: Metadata = {
  title: "料金プラン",
  description:
    "DashDrop の料金プラン。現在ご利用いただけるのは無料の Free プランです。",
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

/** 予定の項目に添える印。チェックと同じ形にすると「使える」と誤読される。 */
function PlannedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-4 w-4 flex-none text-ink-faint"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2.5" />
    </svg>
  );
}

const FAQ = [
  {
    q: "今すぐ使えるのはどのプランですか？",
    a: "Free プランのみです。サインアップすると必ず Free のワークスペースが作られ、料金は一切かかりません。Pro・Business は準備中で、まだお申し込みいただけません。",
  },
  {
    q: "支払い方法は何がありますか？",
    a: "現在、有料プランの提供とお支払いの受付は行っていません。決済の仕組み自体がまだ実装されていないため、ご請求が発生することはありません。",
  },
  {
    q: "途中でプランを変更できますか？",
    a: "現時点では変更できません。アップグレード・ダウングレードの機能も、請求サイクルもまだありません。提供を開始する際は、このページでご案内します。",
  },
  {
    q: "Free プランの上限はどれくらいですか？",
    /*
     * 数はプランから引く。ここに直接書くと、値付けを変えたときに
     * 「カードには12と書いてあるのに、下のQ&Aには10と書いてある」
     * という状態が普通に起きる（実際に起きた）。
     */
    a:
      `Excel は ${PLANS.free.limits.workbooks} ファイルまで、` +
      `1ファイルにつき ${PLANS.free.limits.collections} シートまで、` +
      `1シートあたり ${PLANS.free.limits.recordsPerCollection.toLocaleString("ja-JP")} 行までです。` +
      `連携・数式・通知ルール・定期レポート・顧客/人事データベースは Pro 以上の機能です。` +
      `上限を超える取り込みは、その場で理由を表示してお断りします。` +
      `なお、この上限は Pro の提供開始に合わせて適用します。それまでは上限なくお使いいただけます。`,
  },
  {
    q: "複数人で使えますか？",
    a: "現在は1ワークスペースにつきお一人でのご利用です。メンバーの招待と権限管理は提供予定で、まだ実装されていません。",
  },
  {
    q: "データのエクスポートはできますか？",
    a: "はい。すべてのシートを Excel（.xlsx）ファイルとして書き出せます。データの所有権はお客様にあり、いつでも持ち出せます。",
  },
];

export default function PricingPage() {
  return (
    <div className="animate-fade-in">
      {/* ───────────────────── 冒頭 ───────────────────── */}
      {/*
       * 中央寄せの太い見出しをやめ、トップページと同じ組みにする。
       * サイトの中でここだけ別の言葉づかいだと、同じ製品の続きに見えない。
       */}
      <div className="relative overflow-hidden">
        <Aurora
          tone="calm"
          className="-right-[26%] -top-[55%] h-[190%] w-[86%] sm:-right-[12%] sm:w-[54%]"
          opacity={0.7}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(100deg, var(--paper,#f4f4f2) 0%, var(--paper,#f4f4f2) 38%, rgba(244,244,242,0.86) 50%, rgba(244,244,242,0.3) 62%, transparent 76%)",
          }}
        />
        <div className="relative mx-auto max-w-content border-ink-line px-5 sm:border-x sm:px-10 lg:px-14">
          <section className="pb-14 pt-20 sm:pb-16 sm:pt-28">
            <h1 className="max-w-[16ch] text-[2.25rem] font-light leading-[1.3] tracking-[-0.03em] text-ink sm:text-[3rem]">
              使う分だけ、無理なく。
            </h1>
            <p className="mt-7 max-w-[46ch] text-base font-light leading-[1.95] text-ink">
              いまご利用いただけるのは、無料の Free プランです。
              <span className="text-ink-faint">
                　Pro と Business は準備中で、お申し込みの受付はまだ行っていません。
                値付けだけ先にお伝えします。
              </span>
            </p>
            {/*
              Free の線引きは決まっているが、まだ効かせていない。
              「Pro が必要です」と出したところで申し込む先が無い以上、
              隠すのは行き止まりを作るだけなので、開始日まで開けてある。
              隠すことと、いくらで何ができるかを先に決めて見せることは別。
            */}
            {!plansEnforced && (
              <p className="mt-8 max-w-[52ch] rounded border-l-2 border-khaki-500 bg-paper-raised px-4 py-3.5 text-sm leading-relaxed text-ink-soft">
                <strong className="font-medium text-ink">
                  下の Free の上限は、Pro の提供開始に合わせて適用します。
                </strong>
                <br />
                それまでは、Free のまますべての機能を上限なくお試しいただけます。
                適用の前には必ずご連絡します。
              </p>
            )}
          </section>
        </div>
      </div>

      {/* Plan grid */}
      <section className="mx-auto max-w-content px-4 pb-8 sm:px-6 lg:px-8">
        <div className="grid gap-5 md:grid-cols-3">
          {PLAN_ORDER.map((id) => {
            const plan = getPlan(id);
            const highlighted = Boolean(PLANS[id].highlighted);
            return (
              <Card
                key={id}
                className={cn(
                  "relative flex h-full flex-col",
                  highlighted &&
                    "border-khaki-400 shadow-raised ring-1 ring-khaki-300 md:-translate-y-1",
                  !plan.available && "opacity-95",
                )}
              >
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge
                    tone={plan.available ? "khaki" : "neutral"}
                    variant="soft"
                  >
                    {plan.available ? "提供中" : "準備中"}
                  </Badge>
                </div>
                <CardBody className="flex flex-1 flex-col">
                  <h2 className="text-lg font-semibold text-ink">
                    {plan.name}
                  </h2>
                  <p className="mt-1 text-sm text-ink-muted">{plan.tagline}</p>

                  <div className="mt-5 flex items-baseline gap-1">
                    <span
                      className={cn(
                        "text-3xl font-semibold tracking-tight",
                        plan.available ? "text-ink" : "text-ink-muted",
                      )}
                    >
                      {formatPrice(plan)}
                    </span>
                    {plan.priceMonthly !== null && (
                      <span className="text-sm text-ink-muted">/ 月</span>
                    )}
                    {!plan.available && plan.priceMonthly !== null && (
                      <span className="text-2xs text-ink-faint">（予定価格）</span>
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
                    {plan.planned.map((f) => (
                      <li
                        key={f}
                        className="flex gap-2 text-sm leading-relaxed text-ink-muted"
                      >
                        <PlannedIcon />
                        <span>
                          {f}
                          <span className="ml-1 text-2xs text-ink-faint">
                            （予定）
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8">
                    {plan.available ? (
                      <Link href="/signup" className="block">
                        <Button
                          variant={highlighted ? "primary" : "outline"}
                          size="lg"
                          className="w-full"
                        >
                          無料で始める
                        </Button>
                      </Link>
                    ) : (
                      // 押せるボタンは置かない。申し込みを受け付ける先が
                      // どこにも無いのに、押せば何か起きると思わせないため。
                      <p className="rounded border border-dashed border-ink-line px-3 py-2.5 text-center text-xs leading-relaxed text-ink-muted">
                        現在お申し込みいただけません。
                        <br />
                        提供開始まではFreeプランをご利用ください。
                      </p>
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>

        <p className="mt-6 text-center text-sm text-ink-muted">
          Pro・Business
          の内容と価格は提供開始時に変わる場合があります。現時点で課金が発生することはありません。
        </p>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-content px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="max-w-3xl">
          <h2 className="text-[1.875rem] font-light leading-[1.45] tracking-[-0.02em] text-ink sm:text-[2.25rem]">
            よくあるご質問
          </h2>
          <dl className="mt-10 divide-y divide-ink-line border-y border-ink-line">
            {FAQ.map((item) => (
              <div key={item.q} className="py-5">
                <dt className="text-base font-medium text-ink">{item.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-ink-faint">
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>

          {/*
           * ここを「無料で始める」だけにすると、迷っている人の行き先が
           * 無くなる。値段のページで止まる人は、たいてい聞きたいことがある。
           */}
          <div className="mt-12 flex flex-wrap items-center gap-4">
            <Link href="/signup">
              <Button size="lg">無料で始める</Button>
            </Link>
            <p className="text-sm text-ink-faint">
              判断に迷うところがあれば、
              <Link
                href="/contact"
                className="mx-0.5 text-khaki-700 underline underline-offset-2 hover:text-khaki-600"
              >
                お問い合わせ
              </Link>
              ください。2営業日以内にご返信します。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
