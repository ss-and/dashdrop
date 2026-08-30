import Link from "next/link";
import { Card, CardBody } from "@/components/ui/Card";
import { buttonStyles } from "@/components/ui/Button";

/**
 * メールアドレスの確認が終わったことを伝える画面。
 *
 * ## なぜ専用のページが要るのか
 *
 * 以前は確認のAPIが `/home?verify=done` へ送っていたが、**その `verify` を
 * 読んでいる画面が1つも無かった**。つまり:
 *
 *  - 確認できても「できました」が出ない。帯が消えるだけで、消えた理由が分からない
 *  - 確認に失敗しても理由が出ず、帯だけ残る → もう一度「再送」を押す
 *    → 送信回数の枠を潰す（1時間5通）→ 唯一の出口が閉じる
 *
 * さらに悪いのが**別の端末で開いたとき**。メールをスマホで開く人は多いが、
 * その端末ではログインしていないので、`/home` はミドルウェアに
 * `/login?next=/home` へ弾かれ、`verify` の結果はそこで消える。
 * 確認自体は済んでいるのに、本人は成功も失敗も分からないまま終わる。
 *
 * だからログイン不要のページで結果を出す。ミドルウェアの `matcher` にも
 * `AUTH_PAGES` にも入れていないので、ログイン中でもそうでなくても開ける。
 */
export default async function VerifiedPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const { ok } = await searchParams;
  const done = ok === "1";

  return (
    <Card>
      <CardBody className="space-y-4 text-center">
        <div
          className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full text-xl ${
            done ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
          }`}
          aria-hidden="true"
        >
          {done ? "✓" : "!"}
        </div>

        <div className="space-y-1.5">
          <h1 className="text-base font-semibold text-ink">
            {done
              ? "メールアドレスを確認しました"
              : "このリンクは使えませんでした"}
          </h1>
          <p className="text-sm leading-relaxed text-ink-muted">
            {done
              ? "ダッシュボードを社外の方に見せる公開リンクが作れるようになりました。"
              : /*
                 * 理由（無効・期限切れ・使用済み）は分けない。区別は攻撃側にしか
                 * 役に立たない。代わりに、次にどうすればよいかだけを書く。
                 */
                "リンクの有効期限が切れているか、すでに使われています。ホーム画面の上部から、確認メールをもう一度お送りできます。"}
          </p>
        </div>

        <Link href="/home" className={buttonStyles({ className: "w-full" })}>
          {done ? "DashDrop を開く" : "ホームへ戻る"}
        </Link>
      </CardBody>
    </Card>
  );
}
