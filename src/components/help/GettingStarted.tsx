import Link from "next/link";
import { NavIcon } from "@/components/app/icons";
import { buttonStyles } from "@/components/ui/Button";

/**
 * はじめかた — 1つの動作だけを提示するブロック。
 *
 * ---------------------------------------------------------------------------
 * 「文字や見る機能が多すぎて、わかりづらくなっている気がするし、結局Excelを
 * もっと複雑化したみたいな印象かな」——この指摘を受けて作り直した。
 *
 * 以前は「顧客データベースから作る」と「スプレッドシートから作る」を左右に
 * 並べ、どちらにも見出し・説明文・ボタンを持たせていた。始めたばかりの人に
 * 二択を出すと、選ぶこと自体が最初の仕事になってしまう。DashDrop の約束は
 * 「Excelを置けば分析になる」の一点なので、主役はそれだけにして、残りは
 * 下の細い行に逃がす。ここに 2 つ目の大きな導線を戻さないこと。
 * ---------------------------------------------------------------------------
 */
export function GettingStarted({
  crmHref = null,
  compact = false,
  crmAction,
}: {
  /** Link to the 顧客 object when it exists, so it can be offered as a side door. */
  crmHref?: string | null;
  /** Drops the heading for use inside a panel that already has one. */
  compact?: boolean;
  /**
   * Replaces the 顧客データベース link when the database does not exist yet —
   * the caller passes the button that actually creates it.
   */
  crmAction?: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      {!compact && <h2 className="section-title">はじめかた</h2>}
      <div className="rounded-md border border-ink-line bg-paper-raised p-5">
        <div className="flex items-center gap-2">
          <NavIcon name="upload" className="h-4 w-4 shrink-0 text-khaki-600" />
          <h3 className="text-base font-semibold text-ink">Excelを置くところから</h3>
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          お手元のExcel・CSVをそのまま取り込むと、表とグラフになります。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/import" className={buttonStyles({ size: "sm" })}>
            Excelを取り込む
          </Link>
          {/* 副次的な入口。文章は付けない（迷ったときに押す行）。 */}
          <Link
            href="/samples"
            className="text-sm font-medium text-khaki-700 hover:underline"
          >
            参考シートから選ぶ
          </Link>
          {crmAction ??
            (crmHref && (
              <Link
                href={crmHref}
                className="text-sm font-medium text-khaki-700 hover:underline"
              >
                顧客データベースを開く
              </Link>
            ))}
        </div>
      </div>
    </section>
  );
}
