import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/marketing/ContactForm";
import { Aurora } from "@/components/marketing/Aurora";
import { CONTACT_EMAIL } from "@/lib/legal";

/**
 * お問い合わせ。
 *
 * サイトに窓口が1つも無かった。試したい人も、詰まった人も、
 * 「聞く先が無い」だけで黙って離れる——しかもこちらには何も残らないので、
 * 何人逃したかすら分からない。
 *
 * フォームだけを置かず、**メールアドレスも並べて出す**。フォームが動かない
 * ときに連絡手段が消えるのは本末転倒だし、フォームに書きたくない人もいる。
 */
export const metadata: Metadata = {
  title: "お問い合わせ",
  description:
    "DashDrop の導入相談・料金・不具合の報告・機能のご要望はこちらから。2営業日以内にご返信します。",
};

export default function ContactPage() {
  return (
    <div className="animate-fade-in">
      <div className="relative overflow-hidden">
        <Aurora
          tone="calm"
          className="-right-[26%] -top-[55%] h-[190%] w-[86%] sm:-right-[12%] sm:w-[56%]"
          opacity={0.75}
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
          <div className="grid gap-12 pb-20 pt-20 sm:pb-28 sm:pt-28 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-16">
            <div>
              <h1 className="max-w-[16ch] font-display text-[2.25rem] font-light leading-[1.3] tracking-[-0.03em] text-ink sm:text-[3rem]">
                まず、聞いてください。
              </h1>
              <p className="mt-7 max-w-[38ch] text-base font-light leading-[1.95] text-ink">
                導入の相談も、うまくいかないことの報告も、こちらへ。
                <span className="text-ink-faint">
                  　2営業日以内に、担当（境野）から直接ご返信します。
                  営業の電話はしません。
                </span>
              </p>

              <dl className="mt-10 flex flex-col divide-y divide-ink-line border-y border-ink-line">
                <div className="grid gap-1 py-4 sm:grid-cols-[6.5rem_1fr] sm:gap-4">
                  <dt className="text-sm text-ink">メール</dt>
                  <dd className="text-sm text-ink-faint">
                    <a
                      href={`mailto:${CONTACT_EMAIL}`}
                      className="font-mono text-khaki-700 underline underline-offset-2 hover:text-khaki-600"
                    >
                      {CONTACT_EMAIL}
                    </a>
                    <span className="mt-1 block">
                      フォームが使えないときは、こちらへ直接どうぞ。
                    </span>
                  </dd>
                </div>
                <div className="grid gap-1 py-4 sm:grid-cols-[6.5rem_1fr] sm:gap-4">
                  <dt className="text-sm text-ink">運営</dt>
                  <dd className="text-sm text-ink-faint">
                    S&amp;S合同会社
                    <span className="mt-1 block">
                      所在地などは
                      <Link
                        href="/legal"
                        className="mx-0.5 text-khaki-700 underline underline-offset-2 hover:text-khaki-600"
                      >
                        事業者情報
                      </Link>
                      に記載しています。
                    </span>
                  </dd>
                </div>
                <div className="grid gap-1 py-4 sm:grid-cols-[6.5rem_1fr] sm:gap-4">
                  <dt className="text-sm text-ink">先に試す</dt>
                  <dd className="text-sm text-ink-faint">
                    <Link
                      href="/"
                      className="text-khaki-700 underline underline-offset-2 hover:text-khaki-600"
                    >
                      トップページ
                    </Link>
                    に、お手元の Excel をそのまま置いて試せる画面があります。
                    登録もアップロードも不要です。
                  </dd>
                </div>
              </dl>
            </div>

            <div className="lg:pt-2">
              <ContactForm contactEmail={CONTACT_EMAIL} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
