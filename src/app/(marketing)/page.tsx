import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CollectionIcon, NavIcon } from "@/components/app/icons";

/**
 * DashDrop landing page (site root "/"). Public, server component.
 * No stock imagery — the "product mock" is built entirely from CSS/SVG.
 */

/* --- Faux product screenshot: spreadsheet grid + KPI row + sparkline --- */
function ProductMock() {
  const rows = [
    { c: "田中商事", s: "対応済", n: "¥128,000", tone: "success" as const },
    { c: "山田工業", s: "対応中", n: "¥86,400", tone: "warning" as const },
    { c: "佐藤フーズ", s: "新規", n: "¥54,200", tone: "info" as const },
    { c: "鈴木物流", s: "対応済", n: "¥212,900", tone: "success" as const },
  ];
  // Weekly bars (relative heights, earthy khaki)
  const bars = [42, 58, 47, 71, 63, 88, 76];

  return (
    <div className="rounded-lg border border-ink-line bg-paper-raised p-2 shadow-raised">
      {/* window chrome */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-ink-line" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink-line" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink-line" />
        <span className="ml-3 flex items-center gap-1.5 text-2xs text-ink-faint">
          <NavIcon name="table" className="h-3 w-3" />
          問い合わせ管理.xlsx
        </span>
      </div>

      <div className="grid gap-2 rounded-md bg-paper p-2.5 sm:grid-cols-5">
        {/* KPI row */}
        <div className="grid grid-cols-3 gap-2 sm:col-span-5">
          {[
            { label: "今週の問い合わせ", value: "34", delta: "+12%" },
            { label: "対応完了率", value: "82%", delta: "+5%" },
            { label: "平均対応時間", value: "3.2h", delta: "-8%" },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-md border border-ink-line bg-paper-raised px-3 py-2"
            >
              <p className="truncate text-2xs text-ink-muted">{k.label}</p>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-lg font-semibold text-ink">
                  {k.value}
                </span>
                <span className="text-2xs font-medium text-success">
                  {k.delta}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Spreadsheet grid */}
        <div className="overflow-hidden rounded-md border border-ink-line bg-paper-raised sm:col-span-3">
          <div className="grid grid-cols-[1.4fr_0.9fr_1fr] border-b border-ink-line bg-paper-sunken text-2xs font-medium text-ink-muted">
            <div className="px-2.5 py-1.5">顧客</div>
            <div className="px-2.5 py-1.5">状態</div>
            <div className="px-2.5 py-1.5 text-right">金額</div>
          </div>
          {rows.map((r, i) => (
            <div
              key={r.c}
              className={`grid grid-cols-[1.4fr_0.9fr_1fr] items-center text-2xs ${
                i % 2 ? "bg-paper" : "bg-paper-raised"
              }`}
            >
              <div className="truncate px-2.5 py-1.5 text-ink">{r.c}</div>
              <div className="px-2.5 py-1.5">
                <Badge tone={r.tone} variant="soft" className="px-1.5 py-0">
                  {r.s}
                </Badge>
              </div>
              <div className="px-2.5 py-1.5 text-right font-mono text-ink-soft">
                {r.n}
              </div>
            </div>
          ))}
        </div>

        {/* Weekly performance sparkline (bars + area) */}
        <div className="rounded-md border border-ink-line bg-paper-raised p-2.5 sm:col-span-2">
          <p className="text-2xs text-ink-muted">週間パフォーマンス</p>
          <div className="mt-2 flex h-20 items-end gap-1.5">
            {bars.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm bg-khaki-400"
                style={{ height: `${h}%`, opacity: 0.55 + i * 0.06 }}
              />
            ))}
          </div>
          {/* thin area line under the bars */}
          <svg
            viewBox="0 0 100 20"
            preserveAspectRatio="none"
            className="mt-1 h-5 w-full"
            aria-hidden="true"
          >
            <polyline
              points="0,14 16,10 33,12 50,6 66,8 83,3 100,5"
              fill="none"
              className="stroke-khaki-600"
              strokeWidth="1.4"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: "upload",
    title: "Excel / CSV 連携",
    body: "手元のファイルをアップロードするだけで即テーブル化。整えたデータはいつでもエクスポートできます。",
  },
  {
    icon: "table",
    title: "メタデータ・データベース",
    body: "型付きフィールドで、表計算がそのまま構造化データベースに。列ごとの意味をシステムが理解します。",
  },
  {
    icon: "dashboard",
    title: "週間パフォーマンス・ダッシュボード",
    body: "問い合わせやタスクの動きをひと目で可視化。今週どう動いたかが数字でわかります。",
  },
  {
    icon: "inbox",
    title: "顧客問い合わせ & タスク管理",
    body: "問い合わせ・タスク用のテンプレートを用意。ゼロから設計せず、すぐに運用を始められます。",
  },
];

const STEPS = [
  {
    n: "1",
    icon: "upload",
    title: "取り込む",
    body: "Excel / CSV をアップロード。既存の管理表がそのまま出発点になります。",
  },
  {
    n: "2",
    icon: "settings",
    title: "整える",
    body: "フィールドに型を付けて、問い合わせ・タスクのテンプレートで形を整えます。",
  },
  {
    n: "3",
    icon: "dashboard",
    title: "ひと目で把握",
    body: "週間ダッシュボードで、経営の数字とお客様対応の状況をまとめて確認。",
  },
];

const TRUST = [
  {
    icon: "sparkles",
    title: "シンプルな料金",
    body: "わかりやすい3プラン。使う分だけ、無理なく。",
  },
  {
    icon: "check-square",
    title: "データはあなたのもの",
    body: "取り込んだデータの所有権はお客様に。囲い込みません。",
  },
  {
    icon: "download",
    title: "いつでもエクスポート",
    body: "ワンクリックで Excel / CSV に書き出し。持ち出しは自由。",
  },
];

export default function LandingPage() {
  return (
    <div className="animate-fade-in">
      {/* ---------------- HERO ---------------- */}
      <section className="mx-auto max-w-content px-4 pb-16 pt-16 sm:px-6 sm:pt-20 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <Badge tone="khaki" variant="soft" className="mb-5">
              中小企業の経営者向け
            </Badge>
            {/* 44px, not 48: at 48 the first line (12 full-width characters)
                overruns the hero column and strands 「で、」 on its own line. */}
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl lg:text-[2.75rem]">
              スプレッドシート感覚で、
              <br className="hidden sm:block" />
              経営の数字とお客様対応を
              <span className="text-khaki-600">ひとつに。</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
              問い合わせ・タスク・週間パフォーマンスを、使い慣れた Excel
              連携で管理。導入のための特別な準備はいりません。今の管理表のまま、経営の全体像がひと目でわかります。
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/signup">
                <Button size="lg" className="w-full sm:w-auto">
                  無料で始める
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" size="lg" className="w-full sm:w-auto">
                  デモを見る
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-sm text-ink-muted">
              クレジットカード不要・数分でセットアップ
            </p>
          </div>

          <div className="lg:pl-4">
            <ProductMock />
          </div>
        </div>
      </section>

      {/* ---------------- FEATURES ---------------- */}
      <section
        id="features"
        className="scroll-mt-20 border-t border-ink-line bg-paper-raised"
      >
        <div className="mx-auto max-w-content px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              表計算の手軽さ、データベースの確かさ
            </h2>
            <p className="mt-3 text-base leading-relaxed text-ink-soft">
              使い慣れた表の形はそのままに、その裏側をきちんと構造化。経営に必要な数字とお客様対応を、ひとつの画面に集約します。
            </p>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <Card key={f.title} className="h-full">
                <CardBody>
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-khaki-100 text-khaki-700">
                    <CollectionIcon name={f.icon} className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-ink">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    {f.body}
                  </p>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- HOW IT WORKS ---------------- */}
      <section className="mx-auto max-w-content px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            3ステップで動き出す
          </h2>
          <p className="mt-3 text-base leading-relaxed text-ink-soft">
            取り込んで、整えて、把握する。むずかしい初期設定はありません。
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.n} className="relative">
              <Card className="h-full">
                <CardBody>
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-khaki-500 text-sm font-semibold text-white">
                      {s.n}
                    </span>
                    <NavIcon
                      name={s.icon}
                      className="h-5 w-5 text-khaki-600"
                    />
                    <h3 className="text-base font-semibold text-ink">
                      {s.title}
                    </h3>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                    {s.body}
                  </p>
                </CardBody>
              </Card>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-ink-faint md:block"
                >
                  →
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- CLOSING CTA BAND ---------------- */}
      <section className="mx-auto max-w-content px-4 pb-16 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-khaki-200 bg-khaki-50 px-6 py-12 text-center sm:px-12 sm:py-16">
          <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            今の管理表のまま、はじめられます
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-ink-soft">
            無料プランで、経営の数字とお客様対応がひとつになる感覚を試してみてください。
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/signup">
              <Button size="lg" className="w-full sm:w-auto">
                無料で始める
              </Button>
            </Link>
            <Link href="/pricing">
              <Button variant="secondary" size="lg" className="w-full sm:w-auto">
                料金を見る
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------- TRUST SIGNALS ---------------- */}
      <section className="border-t border-ink-line bg-paper-raised">
        <div className="mx-auto max-w-content px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-8 sm:grid-cols-3">
            {TRUST.map((t) => (
              <div key={t.title} className="flex gap-3">
                <div className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-md bg-khaki-100 text-khaki-700">
                  <NavIcon name={t.icon} className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{t.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                    {t.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
