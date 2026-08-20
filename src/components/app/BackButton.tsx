"use client";

import { useRouter } from "next/navigation";
import { NavIcon } from "./icons";

/**
 * 前のページに戻る。
 *
 * Mac は二本指スワイプで戻れるが、Windows にはその習慣が無い。ブラウザの
 * 戻るボタンは画面のいちばん上にあって、アプリの中身から遠い——結果として
 * 「ドリルダウンで明細を開いたあと、元のダッシュボードへどう帰るのか」が
 * 分からなくなる。押せる形のものを、画面の中に置いておく。
 *
 * 履歴の有無は数えない。アプリに入って最初のページで押すと、ひとつ前は
 * ログイン画面になるが、ログイン済みでそこを開くと middleware がホームへ
 * 送り返す。行き止まりにはならないので、条件付きで出したり消したりするより、
 * いつも同じ場所にある方が手掛かりとして強い。
 */
export function BackButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="前のページに戻る"
      title="前のページに戻る"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-muted transition-colors duration-fast hover:bg-paper-sunken hover:text-ink active:bg-ink-line ${className ?? ""}`}
    >
      <NavIcon name="arrowLeft" className="h-4 w-4" />
    </button>
  );
}
