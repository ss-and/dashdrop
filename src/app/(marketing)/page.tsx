import Link from "next/link";
import { LiveDemo } from "@/components/marketing/LiveDemo";
import { Aurora } from "@/components/marketing/Aurora";
import { Highlights } from "@/components/marketing/Highlights";
import { Reveal } from "@/components/marketing/Reveal";
import { demoSheet } from "@/lib/demo-sample";
import { buildDemoDashboard } from "@/lib/demo-pipeline";

/**
 * トップページ（サイトのルート "/"）。公開・サーバーコンポーネント。
 *
 * ## 何を直したのか
 *
 * 最初の版は SaaS のLPとして完全に定型だった（バッジ → 色付き見出し →
 * ボタン2つ → 手描きの製品モック → アイコン4機能 → 番号付き3ステップ）。
 * 指摘は「AI感が強すぎる」で、正しかった。
 *
 * 2度目は製品を前に出したが、**参考にすると言った Stripe を実際には見ずに
 * 書いた**。結果、構造は直っても見た目は事務的なままだった。実物を見て
 * 分かった違いは、色でも飾りでもなく次の5つ:
 *
 *   1. 見出しが **44px でウェイト300**（極細）・字間 -0.88px。こちらは 36px の
 *      semibold で、同じ言葉でも「管理画面の見出し」に見えていた
 *   2. ヒーローだけで約700px。左半分しか使わず、残りは全部余白
 *   3. 文章が2階調。1文目が濃く、続きが淡い。1段落の中で強弱がつく
 *   4. 見出しの上に**実測の数字**が置いてある（「GDP比 1.70728210%」）。
 *      主張ではなく計測値を先に出す
 *   5. カラムの左右に**縦の細罫**が最後まで通っている
 *
 * このうち色と素材（紫のグラデーション・大きな角丸）は**持ち込まない**。
 * この製品の決まりは「角丸は小さく、影はほぼ無く、1px の罫線で支える。
 * 玩具ではなく業務の道具」（tailwind.config.ts）で、そちらが優先する。
 * 縦罫だけは、表計算の製品にとって元から自分の語彙なので採る。
 *
 * 彩度は**ダッシュボードそのもの**から出す。この画面で一番色が付いているのが
 * 製品の中身である、という状態が正しい。
 *
 * `revalidate` を入れているのは、見本の日付が今月まで伸びるため。
 * 静的に焼くと、半年後に開いた人には半年前の台帳が出る。
 */
export const revalidate = 3600;

export default function LandingPage() {
  // 組み立てにかかった時間を実測する。主張ではなく計測値を先に出すため。
  const t0 = performance.now();
  const demo = buildDemoDashboard(demoSheet());
  const ms = Math.max(1, Math.round(performance.now() - t0));

  return (
    <div className="animate-fade-in">
      {/* ───────────────────── 冒頭 ───────────────────── */}
      <div className="relative overflow-hidden">
        {/*
         * 色の面。紙面の右側を大きく覆い、上下に食み出させる。
         * 使っているのは製品が実際に配っている配色（夕景・葡萄）なので、
         * 借り物ではない。src/components/marketing/Aurora.tsx を参照。
         */}
        <Aurora
          tone="warm"
          className="-right-[26%] -top-[45%] h-[180%] w-[92%] sm:-right-[10%] sm:w-[58%]"
          opacity={0.85}
        />
        {/*
         * 本文の側に紙の膜を掛ける。色の面をここまで強くすると、
         * 見出しと段落が帯の上に乗って読みにくくなる（実際にそうなった）。
         * 左から右へ、文字のある範囲だけ紙の色に戻す。
         */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(100deg, var(--paper,#f4f4f2) 0%, var(--paper,#f4f4f2) 34%, rgba(244,244,242,0.86) 46%, rgba(244,244,242,0.35) 58%, transparent 72%)",
          }}
        />
        {/* カラムの左右に通す細罫。この製品は表の道具なので、罫線は借り物ではない。 */}
        <div className="relative mx-auto max-w-content border-ink-line px-5 sm:border-x sm:px-10 lg:px-14">
        <section className="pb-20 pt-24 sm:pb-32 sm:pt-40">
          <p className="font-mono text-2xs tabular-nums tracking-wide text-ink-faint">
            {demo.rowCount.toLocaleString("ja-JP")} 行を読み、
            {demo.computed.length} 点の図表を選ぶまで： {ms} ミリ秒
          </p>

          {/*
           * 右側の余白を、飾りではなく**文字**で埋める。Stripe はここに
           * 大きなグラデーションを置いているが、それを持ち込むと
           * 「AI感が強い」と言われた元の問題（中身と無関係の器）に戻る。
           * 見出しの級数を上げて、字そのものに面を持たせる。
           */}
          <h1 className="mt-8 text-[2.5rem] font-light leading-[1.24] tracking-[-0.035em] text-ink sm:text-[3.5rem] lg:text-[4.25rem]">
            その Excel を、
            <br />
            そのまま置いてください。
          </h1>

          <p className="mt-9 max-w-[54ch] text-lg font-light leading-[1.95] text-ink">
            列の意味を読み取って、ダッシュボードにします。
            <span className="text-ink-faint">
              　設定も、学習も、テンプレート選びも要りません。下にあるのは
              説明用の絵ではなく、いま組み立てた実物です。
            </span>
          </p>

          <div className="mt-12 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded bg-khaki-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-khaki-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki-500"
            >
              無料で始める
              <span aria-hidden="true" className="text-ink-line">
                ›
              </span>
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 rounded border border-ink-rule bg-paper-raised px-5 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki-500"
            >
              料金を見る
              <span aria-hidden="true" className="text-ink-faint">
                ›
              </span>
            </Link>
          </div>
        </section>
        </div>
      </div>

      {/* ───────────────────── 実物 ───────────────────── */}
      <div className="relative overflow-hidden border-y border-ink-line bg-paper-sunken">
        <Aurora
          tone="calm"
          className="-left-[22%] -top-[45%] h-[175%] w-[75%] rounded-[50%]"
          opacity={0.6}
        />
        <div className="relative mx-auto max-w-content border-ink-line px-5 py-12 sm:border-x sm:px-10 sm:py-16 lg:px-14">
          <LiveDemo
            initial={demo.computed}
            initialRowCount={demo.rowCount}
            initialFieldCount={demo.fieldCount}
          />
        </div>
      </div>

      {/* ───────────────────── 外に出さない（暗い帯） ───────────────────── */}
      {/*
       * ここを暗くする。紙面に明暗の動きが要る——ずっと同じ明るさだと
       * 1枚の長い文書に見えて、どこが節目か分からなくなる。
       *
       * 数字の段は消した。5万行・23種類・15分は下のハイライトに移したので、
       * 残しておくと同じ数字が2回出て、どちらを読めばよいのか分からなくなる。
       */}
      <div className="relative overflow-hidden bg-ink">
        <Aurora
          tone="deep"
          className="-right-[16%] -top-[85%] h-[250%] w-[78%]"
          opacity={0.7}
        />
        <div className="relative mx-auto max-w-content border-white/10 px-5 sm:border-x sm:px-10 lg:px-14">
          <section className="py-16 sm:py-28">
            <Reveal>
              <h2 className="max-w-[22ch] text-[1.875rem] font-light leading-[1.4] tracking-[-0.025em] text-paper sm:text-[2.5rem]">
                表を、外に出さずに済ませる
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <p className="mt-8 max-w-[30ch] text-[1.3125rem] font-semibold leading-[1.6] text-paper">
                置いたファイルは、どこにも送っていません。
              </p>
            </Reveal>
            <Reveal delay={180}>
              <div className="mt-7 grid max-w-3xl gap-8 sm:grid-cols-2">
                <p className="max-w-[26ch] text-sm leading-[1.9] text-paper/60">
                  読み取りも集計も、すべてお使いの端末の中で終わっています。
                  ページの読み込み後は通信も発生していないので、開発者ツールの
                  通信欄で確かめられます。
                </p>
                <p className="max-w-[26ch] text-sm leading-[1.9] text-paper/60">
                  登録して使う場合は取り込んだデータを保管しますが、所有権は
                  お客様のもので、いつでも Excel に書き出せます。囲い込みません。
                </p>
              </div>
            </Reveal>
          </section>
        </div>
      </div>

      {/* ───────────────────── 機能（ハイライト） ───────────────────── */}
      {/*
       * ここには3段落の地の文と「できること／できないこと」の一覧表が
       * 入っていた。指摘は「機能とかだいぶわかりづらい」で、正しかった——
       * 原因は文章量。読むのに気力が要る形だった。
       *
       * apple.com を計測したら、機能の見せ方は「1つの札に考えは1つ、
       * 主張は太字で1文、本文の幅は最大232px」だった。同じ形にする。
       * できないことは下に短く残す（書かないと約束が膨らむ）。
       */}
      <div id="features" className="scroll-mt-16 border-y border-ink-line bg-paper-sunken">
        <div className="mx-auto max-w-content border-ink-line px-5 py-16 sm:border-x sm:px-10 sm:py-24 lg:px-14">
          <Reveal>
            <h2 className="max-w-[20ch] text-[1.875rem] font-light leading-[1.4] tracking-[-0.025em] text-ink sm:text-[2.5rem]">
              置いたあと、何が起きるか
            </h2>
          </Reveal>
          <div className="mt-10 sm:mt-12">
            <Highlights />
          </div>

          {/*
           * できないことは、隠さず短く置く。書かないと約束が勝手に膨らみ、
           * 期待した機能が無いと分かった時点で信用ごと落ちる。
           */}
          <Reveal delay={120}>
            <p className="mt-10 max-w-[46ch] text-sm leading-[1.9] text-ink-faint">
              <span className="text-ink">ありません：</span>
              リアルタイム連携、権限の細かい設計、BIツール並みの自由なグラフ作成。
              そこが必要な規模になったら、データを持ち出して別の道具へ移ってください。
              書き出しは Excel（.xlsx）で、いつでも自由です。
            </p>
          </Reveal>
        </div>
      </div>

      {/* ───────────────────── 締め ───────────────────── */}
      <div className="border-t border-ink-line bg-paper-raised">
        <div className="mx-auto max-w-content border-ink-line px-5 py-16 sm:border-x sm:px-10 sm:py-20 lg:px-14">
          <h2 className="max-w-[20ch] text-[1.875rem] font-light leading-[1.45] tracking-[-0.02em] text-ink sm:text-[2.25rem]">
            今の管理表のまま、はじめられます
          </h2>
          <p className="mt-5 max-w-[44ch] text-base font-light leading-[1.95] text-ink-faint">
            作り直しも、移行作業もありません。いつも開いているファイルを1つ置く
            ところからです。
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded bg-khaki-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-khaki-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki-500"
            >
              無料で始める
              <span aria-hidden="true" className="text-ink-line">
                ›
              </span>
            </Link>
            <span className="text-sm text-ink-faint">クレジットカード不要</span>
          </div>
        </div>
      </div>
    </div>
  );
}
