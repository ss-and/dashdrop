import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { LiveDemo } from "@/components/marketing/LiveDemo";
import { demoSheet } from "@/lib/demo-sample";
import { buildDemoDashboard } from "@/lib/demo-pipeline";
import { WIDGET_TYPES } from "@/lib/widget-builder";

/**
 * トップページ（サイトのルート "/"）。公開・サーバーコンポーネント。
 *
 * ## 何を変えたのか、なぜか
 *
 * 前の版は、SaaS のLPとして完全に定型だった:
 *
 *   バッジ → 見出しの末尾だけ色付き → 段落 → ボタン2つ →「クレジットカード不要」
 *   → 手描きの製品モック → アイコン付き4機能グリッド → 番号付き3ステップ
 *   → 中央寄せのCTA帯 → アイコン付き安心材料3つ
 *
 * どれも中身とは無関係の器で、**どの製品にも貼り替えられる**。実際、
 * 利用者からの指摘は「AI感が強すぎる」だった。正しい。
 *
 * 直し方は、飾りを別の飾りに替えることではない。**製品そのものを前に出す**。
 * この製品の約束は1つ「Excelを置いたらダッシュボードが出る」なので、
 * それを絵ではなく**動かして**置く。手描きのモックは消した——数字が固定で、
 * 中身が変われば必ず実物と食い違い、しかも見た人は結局ためさないと
 * 確かめられなかった。
 *
 * 見本の組み立ては**このサーバーコンポーネントの中で**行う。JavaScript が
 * 動く前から図表が出るし、`xlsx`（900KB）は最初の読み込みに入らない。
 * 置かれたファイルを読むときだけ、ブラウザ側で動的に読み込む。
 */
export default function LandingPage() {
  // 製品と同じ関数で組み立てる。ここで見えるものは、登録後に見えるものと同じ。
  const demo = buildDemoDashboard(demoSheet());

  return (
    <div className="animate-fade-in">
      {/* ───────────────── 冒頭 ＋ 実物 ───────────────── */}
      <section className="mx-auto max-w-content px-4 pb-14 pt-14 sm:px-6 sm:pt-16 lg:px-8">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold leading-[1.3] tracking-tight text-ink sm:text-4xl">
            その Excel を、そのまま置いてください。
          </h1>
          <p className="mt-5 text-base leading-relaxed text-ink-soft sm:text-lg">
            列の意味を読み取って、ダッシュボードにします。設定も、学習も、
            テンプレート選びも要りません。
            <span className="text-ink">
              　下の画面は説明用の絵ではなく、いま動いている本物です。
            </span>
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link href="/signup">
              <Button size="lg">無料で始める</Button>
            </Link>
            <span className="text-sm text-ink-muted">
              クレジットカード不要・
              <Link
                href="/pricing"
                className="text-khaki-700 underline underline-offset-2 hover:text-khaki-600"
              >
                料金を見る
              </Link>
            </span>
          </div>
        </div>

        <div className="mt-9">
          <LiveDemo
            initial={demo.computed}
            initialRowCount={demo.rowCount}
            initialFieldCount={demo.fieldCount}
          />
        </div>
      </section>

      {/* ───────────────── 何が起きているのか ───────────────── */}
      <section className="border-t border-ink-line bg-paper-raised">
        <div className="mx-auto max-w-content px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-tight text-ink">
                置いたあと、何をしているか
              </h2>
              <div className="mt-4 flex flex-col gap-4 text-base leading-relaxed text-ink-soft">
                <p>
                  まず1列ずつ中身を読みます。「受注日」は日付、「金額」は通貨、
                  「担当」は繰り返しの少ない分類。
                  列名だけで決めると、<span className="text-ink">案件IDでドーナツを描いて全部1件のスライスにしたり、空の数式列を合計してゼロを並べたり</span>
                  します。1行読めば分かることを、読まずに推測しないようにしています。
                </p>
                <p>
                  そのうえで、この表で意味を持つ図表だけを選びます。
                  {WIDGET_TYPES.length}種類ありますが、全部は出しません。
                  日付が無ければ推移は描かないし、
                  <span className="text-ink">当たらない図表は枠ごと出しません</span>
                  ——空の枠は、無いより悪いからです。
                </p>
                <p>
                  同じファイルなら、何度置いても同じ画面になります。
                  生成のたびに答えが変わる道具は、経営の判断には使えません。
                </p>
              </div>
            </div>

            <div className="lg:pt-1">
              <h3 className="font-mono text-2xs uppercase tracking-wider text-ink-faint">
                できること / できないこと
              </h3>
              <dl className="mt-4 divide-y divide-ink-line border-y border-ink-line">
                {[
                  ["取り込み", "Excel（.xlsx / .xls）と CSV。1ファイル 4MB まで"],
                  ["書き出し", "Excel（.xlsx）。取り込んだデータは持ち出し自由"],
                  ["共有", "ログイン不要の公開リンク。社外の方にそのまま渡せます"],
                  ["通知", "しきい値を超えたら Slack かアプリ内へ"],
                  ["定期の集計", "15分ごとに自動で評価"],
                ].map(([k, v]) => (
                  <div key={k} className="grid gap-1 py-3 sm:grid-cols-[7rem_1fr] sm:gap-3">
                    <dt className="text-sm font-medium text-ink">{k}</dt>
                    <dd className="text-sm leading-relaxed text-ink-soft">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-sm leading-relaxed text-ink-muted">
                リアルタイム連携、権限の細かい設計、BIツール並みの自由なグラフ作成は
                ありません。そこが必要な規模になったら、データを持ち出して
                別の道具へ移ってください。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────── 外に出さない ───────────────── */}
      <section className="mx-auto max-w-content px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">
            表を、外に出さずに済ませる
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink-soft">
            売上や取引先の一覧をチャットに貼るのが気持ち悪い、というのは正しい
            感覚です。
            <span className="text-ink">
              上のデモに置いたファイルは、実際にどこにも送っていません
            </span>
            ——読み取りも集計も、すべてお使いの端末の中で終わっています。
            ページの読み込み後は通信も発生していないので、
            開発者ツールの通信欄で確かめられます。
          </p>
          <p className="mt-4 text-base leading-relaxed text-ink-soft">
            登録して使う場合は、取り込んだデータを保管します。所有権はお客様のもので、
            いつでも Excel に書き出せます。囲い込みません。
          </p>
        </div>
      </section>

      {/* ───────────────── 締め ───────────────── */}
      <section className="border-t border-ink-line bg-paper-raised">
        <div className="mx-auto max-w-content px-4 py-14 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold tracking-tight text-ink">
                今の管理表のまま、はじめられます
              </h2>
              <p className="mt-3 text-base leading-relaxed text-ink-soft">
                作り直しも、移行作業もありません。いつも開いているファイルを
                1つ置くところからです。
              </p>
            </div>
            <div className="flex flex-none flex-wrap gap-3">
              <Link href="/signup">
                <Button size="lg">無料で始める</Button>
              </Link>
              <Link href="/pricing">
                <Button variant="outline" size="lg">
                  料金を見る
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
