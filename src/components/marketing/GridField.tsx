/**
 * 細い方眼。冒頭の地に敷く。
 *
 * ## なぜ方眼なのか
 *
 * 指摘は「背景画像が微妙」。ぼかした色の面だけだと、拡大した写真のようで
 * **何の製品の紙面か分からない**。かといって飾りを足すと、最初に言われた
 * 「中身と無関係の器」に戻る。
 *
 * この製品は表計算の道具なので、**方眼は借り物ではない**。同じ理由で
 * カラムの左右に細罫を通してある（page.tsx）。輪郭のはっきりした線が
 * 入ると、ぼかしだけの面より一段「作られたもの」に見える——精度の印象は、
 * 直線からしか出ない。
 *
 * ## 作り方
 *
 * `repeating-linear-gradient` を縦横に重ねるだけ。画像も SVG も要らないので
 * 転送量は 0 で、どんな拡大率でも 1px のまま崩れない。
 * 外周はマスクで溶かす——端で切れると「敷いた板」に見える。
 */
export function GridField({
  className = "",
  /** 目の大きさ（px）。小さすぎると模様が潰れ、大きいと間延びする。 */
  size = 56,
  /** 線の濃さ。地の明るさに合わせる。 */
  color = "rgba(28,27,23,0.055)",
  /** 溶かし方。円形に中心を残すか、上から下へ落とすか。 */
  fade = "radial" as "radial" | "vertical",
}: {
  className?: string;
  size?: number;
  color?: string;
  fade?: "radial" | "vertical";
}) {
  const mask =
    fade === "radial"
      ? "radial-gradient(120% 100% at 50% 0%, #000 20%, rgba(0,0,0,0.5) 55%, transparent 85%)"
      : "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.6) 55%, transparent 100%)";

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute ${className}`}
      style={{
        backgroundImage: `repeating-linear-gradient(to right, ${color} 0 1px, transparent 1px ${size}px), repeating-linear-gradient(to bottom, ${color} 0 1px, transparent 1px ${size}px)`,
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
    />
  );
}
