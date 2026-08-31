/**
 * 機能の見せ方。「ハイライト」の並び。
 *
 * ## なぜ書き直したのか
 *
 * 指摘は「機能とかだいぶわかりづらい」。原因は文章量だった。
 * ここには**3段落の地の文と一覧表**が入っていて、読むのに気力が要る。
 *
 * 参考にした apple.com/jp/macbook-air を計測したところ、機能の見せ方は
 * こうなっていた:
 *
 *   カテゴリ名   24px w600            デザイン／パフォーマンス／AI／macOS
 *   主張         21px w600 行間30px   「2つの魅力的なポータブルサイズ。」
 *   本文         17px w400 **最大幅 232px**
 *
 * 効いているのは3つ:
 *
 *   ① **1つの札に、考えは1つだけ。** 段落を並べない
 *   ② **主張は太字で短く言い切る。** 細い長文ではなく、太い2〜3行
 *   ③ **本文の幅を極端に狭くする。** 1行が短いと、目が滑らない
 *
 * ここでも同じ形にする。数字は実装から数える（手で書くと必ずずれる）。
 */
import { WIDGET_TYPES } from "@/lib/widget-builder";
import { LENS_META } from "@/lib/dashboard-intent";
import { MAX_IMPORT_ROWS } from "@/lib/excel";
import { Reveal } from "./Reveal";

interface Highlight {
  /** カテゴリ。1語。何の話が始まるかだけを示す。 */
  tag: string;
  /** 主張。**1文**で言い切る。句点で終える。 */
  claim: string;
  /** 補足。1文まで。ここが2文になったら、それは別の札。 */
  note: string;
  /** 目に留まる値。無ければ省く。 */
  figure?: string;
}

const HIGHLIGHTS: Highlight[] = [
  {
    tag: "取り込み",
    claim: "Excel を置くだけ。",
    note: "列の型は、中身を読んでこちらで決めます。指定する画面はありません。",
    figure: `${(MAX_IMPORT_ROWS / 10000).toLocaleString("ja-JP")}万行`,
  },
  {
    tag: "図表",
    claim: "この表に、意味のあるものだけ。",
    note: "日付が無ければ推移は描きません。当たらない図表は枠ごと出しません。",
    figure: `${WIDGET_TYPES.length}種類`,
  },
  {
    tag: "見せ方",
    claim: "同じ表を、押すたびに組み直す。",
    note: "実績・進み具合・内訳・ばらつき。見たいものに合わせて切り替わります。",
    figure: `${LENS_META.length}通り`,
  },
  {
    tag: "共有",
    claim: "社外の方に、そのまま渡せる。",
    note: "ログイン不要の閲覧専用リンク。相手にアカウントを作らせません。",
  },
  {
    tag: "通知",
    claim: "超えたときだけ、届く。",
    note: "しきい値を自動で確認して、Slack かアプリ内に知らせます。",
    figure: "15分ごと",
  },
  {
    tag: "手元から出さない",
    claim: "この端末の中で終わる。",
    note: "トップのデモは、読み取りも集計もブラウザで行い、送信しません。",
    figure: "通信 0 件",
  },
];

export function Highlights() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {HIGHLIGHTS.map((h, i) => (
        <Reveal key={h.tag} delay={i * 70} className="h-full">
          <article className="flex h-full flex-col gap-4 rounded-xl border border-ink-line bg-paper-raised p-6 sm:p-7">
            <p className="font-mono text-2xs tracking-wider text-ink-faint">{h.tag}</p>

            {/*
             * 主張は**太く短く**。細い長文にすると、同じ内容でも
             * 「読まなければ分からないもの」になる。
             */}
            <p className="max-w-[13ch] text-[1.3125rem] font-semibold leading-[1.45] tracking-[-0.01em] text-ink">
              {h.claim}
            </p>

            {/* 幅を狭くして、1行を短く保つ。目が滑らないための措置。 */}
            <p className="max-w-[24ch] flex-1 text-sm leading-[1.85] text-ink-faint">
              {h.note}
            </p>

            {h.figure && (
              <p className="mt-1 font-mono text-[1.375rem] tabular-nums tracking-[-0.02em] text-khaki-600">
                {h.figure}
              </p>
            )}
          </article>
        </Reveal>
      ))}
    </div>
  );
}
