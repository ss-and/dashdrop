/**
 * 色の面。Stripe のトップにある大きなグラデーションに当たるもの。
 *
 * ## なぜ要るのか、なぜこの色なのか
 *
 * 最初に作った版には**彩度が1つも無かった**。罫線と墨と khaki だけで、
 * 「管理画面を1枚貼っただけ」に見えていた。参考にした Stripe は、
 * 紙面のほぼ全部を大きなグラデーションが支えていて、その上に製品の実画面が
 * 乗っている。色は飾りではなく、**製品を載せるための地**だった。
 *
 * ただし紫は持ち込まない。借りると、借りたことが分かる。
 * ここで使うのは**この製品が実際に配っている配色**——`src/lib/palette.ts` の
 * 「夕景」「葡萄」「藍」から取った実際の値。お客さまのダッシュボードに
 * 出るのと同じ色でページを染めるなら、それは借り物ではなく自前の材料になる。
 *
 * ## 作り方
 *
 * 大きくぼかした円を数枚重ねる。SVG の長いパスを手で書くより、
 * ブラウザに任せたほうが軽いし、拡大しても破綻しない。
 * `blur` は合成が重いので枚数は5枚まで。
 */

/** src/lib/palette.ts の実際の値。ここを変えるならあちらも見ること。 */
const SUNSET = ["#a8452f", "#c9772f", "#96773a"] as const;
const BERRY = ["#6b3a6b", "#a34a7a", "#8a5aa8"] as const;
const OCEAN = ["#1f4e6b", "#3f9aa8", "#6b7fae", "#2f7d6b"] as const;
/** 「標準」の配色から。ブランド色（khaki）と同系で、地とボタンを結ぶ。 */
const STANDARD = ["#8a8250", "#4a6d80", "#6b6a8c"] as const;

type Tone = "warm" | "deep" | "calm" | "cool";

const TONES: Record<Tone, readonly string[]> = {
  /*
   * 冒頭。指摘は「赤色なのも（微妙）」で、正しかった。錆びた赤橙は
   * 温かいが**古く**見える。ここは藍・青緑・藤へ寄せる。
   * どれも src/lib/palette.ts の「藍」の実値で、借り物ではない。
   */
  /*
   * 冷たい側を主にしつつ、khaki と同系の1色（#8a8250）を混ぜる。
   * 全部を青にすると、ブランド色のボタンだけが地から浮いて見えた。
   */
  cool: [OCEAN[1], OCEAN[2], STANDARD[0], OCEAN[3], STANDARD[2]],
  // 暖色。いまは使っていないが、季節の差し替え用に残す。
  warm: [SUNSET[1], SUNSET[0], BERRY[1], SUNSET[2], BERRY[2]],
  // 濃い帯の上。暗い地に沈まない明度のものだけ。
  deep: [OCEAN[1], BERRY[2], OCEAN[2], OCEAN[3]],
  // 淡い地。
  calm: [OCEAN[1], OCEAN[2], OCEAN[0]],
};

/**
 * ぼかした色面。`className` で置き場所と大きさを決める。
 *
 * `aria-hidden` を付けるのは、読み上げに意味を持たない純粋な装飾だから。
 */
export function Aurora({
  tone = "warm",
  className = "",
  opacity = 1,
}: {
  tone?: Tone;
  className?: string;
  /** 地の明るさに合わせて全体を薄める。 */
  opacity?: number;
}) {
  const colors = TONES[tone];

  // 位置と大きさ。手で置いて、重なりが単調にならない配置にしてある。
  const blobs = [
    { x: "18%", y: "22%", w: "62%", h: "72%" },
    { x: "58%", y: "8%", w: "56%", h: "66%" },
    { x: "40%", y: "58%", w: "70%", h: "60%" },
    { x: "78%", y: "40%", w: "48%", h: "78%" },
    { x: "6%", y: "62%", w: "44%", h: "52%" },
  ];

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute ${className}`}
      /*
       * 縁を溶かす。円をそのまま置くと**硬い楕円の輪郭**が出て、
       * 「光の面」ではなく「置かれた図形」に見えた（実際にそうなった）。
       * 参考にした紙面の帯は、どこにも縁が無い。
       * マスクで外周を落とし、全体にもぼかしを掛ける。
       */
      style={{
        opacity,
        WebkitMaskImage:
          "radial-gradient(closest-side at 55% 50%, #000 42%, rgba(0,0,0,0.55) 68%, transparent 100%)",
        maskImage:
          "radial-gradient(closest-side at 55% 50%, #000 42%, rgba(0,0,0,0.55) 68%, transparent 100%)",
        filter: "blur(18px)",
      }}
    >
      {/*
       * まず地を1枚敷く。円を重ねるだけだと、隙間から下地の白が抜けて
       * 「白い紙に色のシミ」に見えた（実際にそうなった）。参考にした紙面は
       * 面そのものが色で、白は残っていない。
       */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 45%, ${colors[colors.length - 1]} 100%)`,
        }}
      />
      {colors.map((c, i) => {
        const b = blobs[i % blobs.length];
        return (
          <div
            key={c + i}
            className="absolute rounded-full mix-blend-screen"
            style={{
              left: b.x,
              top: b.y,
              width: b.w,
              height: b.h,
              transform: "translate(-50%, -50%)",
              background: `radial-gradient(closest-side, ${c}, transparent 72%)`,
              filter: "blur(44px)",
              opacity: 0.9 - i * 0.06,
            }}
          />
        );
      })}
    </div>
  );
}
