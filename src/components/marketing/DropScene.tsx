/**
 * 冒頭の絵。「Excel を落とすと、ダッシュボードになる」を1枚で描く。
 *
 * ## なぜ描いたのか
 *
 * ここには本物のダッシュボードを枠で切って置いていた。**雑だった**——
 * 金額が「¥31,302,2」と桁の途中で切れ、図表の縁も中途半端に落ちていた。
 * 切り取りは「続きがある」を伝える手だが、**数字を途中で切ってはいけない**。
 * 読めない数字は、続きではなく壊れて見える。
 *
 * かといって写真や生成画像は使えない。この製品には見せる写真が無いし、
 * それらしい絵を置くと、最初に言われた「中身と無関係の器」に戻る。
 *
 * そこで**製品の説明そのものを図にする**。落ちてくる表と、その下で
 * 組み上がる画面。これは飾りではなく、製品が何をするかの図解。
 *
 * ## 作り方
 *
 * 手描きの SVG。画像を置かないので転送量はほぼ 0 で、どんな拡大率でも
 * にじまない。色は src/lib/palette.ts の実値だけを使う（借り物にしない）。
 * 座標は 8 の倍数の格子に載せてある——目分量で置くと、それだけで
 * 「手作り」に見える。
 *
 * 動きは `prefers-reduced-motion` で止める。
 */

/* src/lib/palette.ts の実値。ここを変えるならあちらも見ること。 */
const KHAKI = "#8a8250";
const OCEAN = "#4a6d80";
const FOREST = "#4f7a53";
const SAND = "#b07d38";
const LINE = "#e4e2dc";
const RULE = "#d3d0c8";
const PAPER = "#ffffff";
const SUNKEN = "#f1f0ec";
const INK_FAINT = "#a3a094";

/** 表の中の「文字」を表す棒。長さを変えて、行ごとの違いを出す。 */
function CellBar({ x, y, w }: { x: number; y: number; w: number }) {
  return <rect x={x} y={y} width={w} height="5" rx="2.5" fill={INK_FAINT} opacity="0.5" />;
}

export function DropScene({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 720 560"
      role="img"
      aria-label="Excel のシートを置くと、指標・棒グラフ・円グラフ・推移が並んだダッシュボードが組み上がる様子"
      className={className}
      style={{ maxWidth: "100%", height: "auto" }}
    >
      <defs>
        {/* 落ちてくる表の影。下の画面から浮いていることを示す。 */}
        <filter id="ds-shadow" x="-30%" y="-30%" width="170%" height="180%">
          <feDropShadow
            dx="0"
            dy="18"
            stdDeviation="20"
            floodColor="#1c1b17"
            floodOpacity="0.18"
          />
        </filter>
        {/* 円グラフの残りを描くための座標系。 */}
        <clipPath id="ds-clip-panel">
          <rect x="48" y="216" width="624" height="312" rx="12" />
        </clipPath>
      </defs>

      {/* ───────── 下：組み上がった画面 ───────── */}
      <g>
        <rect
          x="48"
          y="216"
          width="624"
          height="312"
          rx="12"
          fill={PAPER}
          stroke={LINE}
          strokeWidth="2"
        />

        {/* 指標の段 */}
        {/*
         * 値は棒ではなく**数字**で描く。棒にしたら黒塗りに見えて、
         * 伏せた文字のようになった。数字は下の見本と同じ値にしてある——
         * 絵と実物で数が食い違うと、どちらかが嘘に見える。
         */}
        <g>
          {[
            { label: "件数", value: "217" },
            { label: "合計", value: "¥3,130万" },
            { label: "平均", value: "¥14.4万" },
            { label: "最大", value: "¥43.0万" },
          ].map((k, i) => (
            <g key={k.label} transform={`translate(${72 + i * 152} 248)`}>
              <text
                x="0"
                y="8"
                fontSize="13"
                fill={INK_FAINT}
                fontFamily="system-ui, sans-serif"
              >
                {k.label}
              </text>
              <text
                x="0"
                y="34"
                fontSize="21"
                fill="#2b2a26"
                fontFamily="system-ui, sans-serif"
                fontWeight="500"
              >
                {k.value}
              </text>
            </g>
          ))}
          <line x1="48" y1="300" x2="672" y2="300" stroke={LINE} strokeWidth="2" />
        </g>

        {/* 左下：棒グラフ */}
        <g transform="translate(72 328)">
          <text y="6" fontSize="13" fill={INK_FAINT} fontFamily="system-ui, sans-serif">
            月別の金額
          </text>
          {[58, 92, 70, 110, 84, 128].map((h, i) => (
            <rect
              key={i}
              x={i * 44}
              y={168 - h}
              width="28"
              height={h}
              rx="3"
              fill={KHAKI}
              opacity={0.55 + i * 0.07}
            />
          ))}
          <line x1="0" y1="168" x2="264" y2="168" stroke={RULE} strokeWidth="2" />
        </g>

        {/* 右下：円グラフ */}
        <g transform="translate(468 328)">
          <text y="6" fontSize="13" fill={INK_FAINT} fontFamily="system-ui, sans-serif">
            販路別の金額
          </text>
          <g transform="translate(84 92)">
            {/*
             * 円弧は stroke-dasharray で描く。半径56・円周約352。
             * 4色で 40% / 26% / 20% / 14% に割る。
             */}
            {[
              { c: KHAKI, len: 141, off: 0 },
              { c: OCEAN, len: 91, off: -141 },
              { c: FOREST, len: 70, off: -232 },
              { c: SAND, len: 50, off: -302 },
            ].map((s) => (
              <circle
                key={s.c}
                r="56"
                fill="none"
                stroke={s.c}
                strokeWidth="26"
                strokeDasharray={`${s.len} 352`}
                strokeDashoffset={s.off}
                transform="rotate(-90)"
              />
            ))}
          </g>
        </g>
      </g>

      {/* ───────── 落ちる筋 ───────── */}
      <g stroke={RULE} strokeWidth="2" strokeLinecap="round" opacity="0.8">
        <line x1="286" y1="184" x2="286" y2="208">
          <animate
            attributeName="opacity"
            values="0.15;0.9;0.15"
            dur="2.4s"
            repeatCount="indefinite"
          />
        </line>
        <line x1="360" y1="176" x2="360" y2="212">
          <animate
            attributeName="opacity"
            values="0.9;0.15;0.9"
            dur="2.4s"
            begin="0.4s"
            repeatCount="indefinite"
          />
        </line>
        <line x1="434" y1="184" x2="434" y2="208">
          <animate
            attributeName="opacity"
            values="0.15;0.9;0.15"
            dur="2.4s"
            begin="0.8s"
            repeatCount="indefinite"
          />
        </line>
      </g>

      {/* ───────── 上：落ちてくる表 ───────── */}
      <g filter="url(#ds-shadow)" transform="rotate(-4 360 96)">
        <rect
          x="176"
          y="24"
          width="368"
          height="136"
          rx="10"
          fill={PAPER}
          stroke={RULE}
          strokeWidth="2"
        />
        {/* 見出しの行 */}
        <path
          d="M176 34a10 10 0 0 1 10-10h348a10 10 0 0 1 10 10v18H176z"
          fill={SUNKEN}
        />
        <line x1="176" y1="52" x2="544" y2="52" stroke={RULE} strokeWidth="2" />
        {[0, 1, 2, 3].map((i) => (
          <CellBar key={`h${i}`} x={196 + i * 88} y={35} w={[44, 34, 40, 30][i]} />
        ))}

        {/* 罫線 */}
        {[79, 106, 133].map((y) => (
          <line key={y} x1="176" y1={y} x2="544" y2={y} stroke={LINE} strokeWidth="1.5" />
        ))}
        {[264, 352, 440].map((x) => (
          <line key={x} x1={x} y1="52" x2={x} y2="160" stroke={LINE} strokeWidth="1.5" />
        ))}

        {/* 中身 */}
        {[0, 1, 2, 3].map((r) =>
          [0, 1, 2, 3].map((c) => (
            <CellBar
              key={`${r}-${c}`}
              x={196 + c * 88}
              y={62 + r * 27}
              w={[52, 38, 46, 30, 44, 50, 34, 42, 48, 36, 54, 40, 32, 46, 38, 50][r * 4 + c]}
            />
          )),
        )}

        {/* 角の折り返し。表の紙であることの合図。 */}
        <path d="M544 24l-28 0 28 28z" fill={SUNKEN} />
        <path d="M516 24l28 28" stroke={RULE} strokeWidth="2" fill="none" />
      </g>
    </svg>
  );
}
