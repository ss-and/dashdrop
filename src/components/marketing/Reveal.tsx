"use client";

/**
 * 画面に入ったときに、そっと現れる。
 *
 * 参考にした Apple の頁は、この仕掛けを34か所で使っていた（計測値）。
 * 一度に全部見えている紙面は「長い文書」に見えるが、読み進める先で
 * 順に現れると「読まされている」感じが減る。派手さのためではなく、
 * **どこを読む番か**を体が分かるための仕掛け。
 *
 * 気をつけたこと:
 *
 * - **`prefers-reduced-motion` を必ず見る。** 動きで具合が悪くなる人がいる。
 *   その設定のときは、最初から表示済みにして一切動かさない。
 * - **JavaScript が動かなくても読める。** 初期状態を透明にすると、
 *   何かの理由でこの部品が動かなかったときに**本文ごと消える**。
 *   だから初期値は「見えている」で、監視できたときだけ隠してから出す。
 * - **一度出したら監視をやめる。** 上下にスクロールするたびに明滅すると、
 *   読んでいる最中に気が散る。
 */
import { useEffect, useRef, useState } from "react";

export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  /** ずらして出すときのミリ秒。並んだ札を順に出すのに使う。 */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /*
   * 初期値は true（見えている）。JS が動かない・古い・失敗した場合でも、
   * 本文が消えないようにするため。監視を張れたときだけ false に落とす。
   */
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") return;

    setShown(false);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          // 一度出したら監視をやめる。往復するたびに明滅させない。
          io.disconnect();
          window.setTimeout(() => setShown(true), delay);
        }
      },
      // 下端に少し入った時点で出す。画面の真ん中まで待つと遅れて見える。
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);

  return (
    <div
      ref={ref}
      className={`motion-safe:transition-[opacity,transform] motion-safe:duration-[700ms] motion-safe:ease-out ${
        shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
      } ${className}`}
    >
      {children}
    </div>
  );
}
