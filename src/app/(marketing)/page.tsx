import Link from "next/link";
import { LiveDemo } from "@/components/marketing/LiveDemo";
import { demoSheet } from "@/lib/demo-sample";
import { buildDemoDashboard } from "@/lib/demo-pipeline";
import { WIDGET_TYPES } from "@/lib/widget-builder";

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
      {/* カラムの左右に通す細罫。この製品は表の道具なので、罫線は借り物ではない。 */}
      <div className="mx-auto max-w-content border-ink-line px-5 sm:border-x sm:px-10 lg:px-14">
        {/* ───────────────────── 冒頭 ───────────────────── */}
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

      {/* ───────────────────── 実物 ───────────────────── */}
      <div className="border-y border-ink-line bg-paper-raised">
        <div className="mx-auto max-w-content border-ink-line px-5 py-12 sm:border-x sm:px-10 sm:py-16 lg:px-14">
          <LiveDemo
            initial={demo.computed}
            initialRowCount={demo.rowCount}
            initialFieldCount={demo.fieldCount}
          />
        </div>
      </div>

      {/* ───────────────────── 実測の数字 ───────────────────── */}
      <div className="mx-auto max-w-content border-ink-line px-5 sm:border-x sm:px-10 lg:px-14">
        <section className="grid gap-10 py-16 sm:grid-cols-2 sm:py-20 lg:grid-cols-4">
          {[
            ["5万行", "1つのシートに取り込める行数"],
            [`${WIDGET_TYPES.length}種類`, "選べる図表。当たらないものは出しません"],
            ["15分", "しきい値の確認の間隔"],
            ["0件", "デモでファイルを置いたときの通信"],
          ].map(([n, note]) => (
            <div key={note} className="flex flex-col gap-2">
              <span className="text-[2rem] font-light leading-none tracking-[-0.02em] text-ink">
                {n}
              </span>
              <span className="max-w-[22ch] text-sm leading-relaxed text-ink-faint">
                {note}
              </span>
            </div>
          ))}
        </section>
      </div>

      {/* ───────────────────── 何をしているか ───────────────────── */}
      <div className="border-y border-ink-line bg-paper-raised">
        <div className="mx-auto max-w-content border-ink-line px-5 py-16 sm:border-x sm:px-10 sm:py-24 lg:px-14">
          <h2 className="max-w-[24ch] text-[1.875rem] font-light leading-[1.45] tracking-[-0.02em] text-ink sm:text-[2.25rem]">
            置いたあと、何をしているか
          </h2>

          <div className="mt-10 grid gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="flex max-w-[52ch] flex-col gap-6 text-base font-light leading-[2] text-ink">
              <p>
                まず1列ずつ中身を読みます。
                <span className="text-ink-faint">
                  「受注日」は日付、「金額」は通貨、「担当」は繰り返しの少ない分類。
                  列名だけで決めると、案件IDでドーナツを描いて全部1件のスライスにしたり、
                  空の数式列を合計してゼロを並べたりします。1行読めば分かることを、
                  読まずに推測しないようにしています。
                </span>
              </p>
              <p>
                そのうえで、この表で意味を持つ図表だけを選びます。
                <span className="text-ink-faint">
                  {WIDGET_TYPES.length}種類ありますが、全部は出しません。日付が無ければ
                  推移は描かないし、当たらない図表は枠ごと出しません——空の枠は、
                  無いより悪いからです。
                </span>
              </p>
              <p>
                同じファイルなら、何度置いても同じ画面になります。
                <span className="text-ink-faint">
                  生成のたびに答えが変わる道具は、経営の判断には使えません。
                </span>
              </p>
            </div>

            <div className="lg:pt-2">
              <h3 className="font-mono text-2xs uppercase tracking-wider text-ink-faint">
                できること / できないこと
              </h3>
              <dl className="mt-5 flex flex-col">
                {[
                  ["取り込み", "Excel（.xlsx / .xls）と CSV。1ファイル 4MB まで"],
                  ["書き出し", "Excel（.xlsx）。取り込んだデータは持ち出し自由"],
                  ["共有", "ログイン不要の公開リンク。社外の方にそのまま渡せます"],
                  ["通知", "しきい値を超えたら Slack かアプリ内へ"],
                  ["定期の集計", "15分ごとに自動で評価"],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="grid gap-1 border-t border-ink-line py-4 sm:grid-cols-[7.5rem_1fr] sm:gap-4"
                  >
                    <dt className="text-sm text-ink">{k}</dt>
                    <dd className="text-sm leading-relaxed text-ink-faint">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6 max-w-[34ch] text-sm leading-relaxed text-ink-faint">
                リアルタイム連携、権限の細かい設計、BIツール並みの自由なグラフ作成は
                ありません。そこが必要な規模になったら、データを持ち出して
                別の道具へ移ってください。
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ───────────────────── 外に出さない ───────────────────── */}
      <div className="mx-auto max-w-content border-ink-line px-5 sm:border-x sm:px-10 lg:px-14">
        <section className="py-16 sm:py-24">
          <h2 className="max-w-[24ch] text-[1.875rem] font-light leading-[1.45] tracking-[-0.02em] text-ink sm:text-[2.25rem]">
            表を、外に出さずに済ませる
          </h2>
          <div className="mt-8 flex max-w-[52ch] flex-col gap-6 text-base font-light leading-[2] text-ink">
            <p>
              売上や取引先の一覧をチャットに貼るのが気持ち悪い、というのは正しい感覚です。
              <span className="text-ink-faint">
                　上のデモに置いたファイルは、実際にどこにも送っていません。読み取りも
                集計も、すべてお使いの端末の中で終わっています。ページの読み込み後は
                通信も発生していないので、開発者ツールの通信欄で確かめられます。
              </span>
            </p>
            <p>
              登録して使う場合は、取り込んだデータを保管します。
              <span className="text-ink-faint">
                　所有権はお客様のもので、いつでも Excel に書き出せます。囲い込みません。
              </span>
            </p>
          </div>
        </section>
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
