"use client";

import { useState } from "react";
import { paletteFor } from "@/lib/palette";
import { ThemeSelect } from "@/components/dashboard/ThemeSelect";
import {
  AUDIENCE_META,
  LENS_META,
  type DashboardIntent,
  type Lens,
} from "@/lib/dashboard-intent";
import { cn } from "@/lib/utils";

/**
 * 「どんな画面にしますか？」——取り込みの確認に添える、3つだけの質問。
 *
 * ## なぜここに置くのか
 *
 * 取り込みの確認画面は、すでに「列名を直す」「シートを選ぶ」でそこそこ重い。
 * そこへ設定項目を足すのは本来やりたくないが、**この3つはデータからは
 * 絶対に分からない**（同じ受注明細でも、部長・経理・分析担当で欲しい画面は
 * 違う）。聞かないかぎり、誰が入れても同じ画面が出続ける。
 *
 * ## 代わりに、答えなくても進める
 *
 * 既定は「おまかせ／チームで見る／標準」で、何も触らなければこれまでと
 * 同じ結果になる。押した瞬間に下の見本の色と形が変わるので、**説明を読まなくても
 * 何が変わるのかが見える**。読ませるのではなく、見せて選ばせる。
 *
 * ## 速さ
 *
 * 見本は div と CSS だけで描いてある。グラフ描画ライブラリを持ち込むと、
 * 選ぶたびに再計算が走って「押した→少し待つ→変わる」になる。ここは
 * 迷いながら何度も押す場所なので、待ちが1回でも入ると触るのをやめてしまう。
 */

/** 見本の棒の高さ。視点ごとに形を変えて、選択の違いを目に見せる。 */
const SHAPES: Record<Lens, number[]> = {
  auto: [46, 68, 54, 82, 62, 92],
  performance: [34, 48, 56, 70, 78, 96],
  pipeline: [96, 78, 58, 42, 30, 22],
  composition: [92, 66, 48, 34, 24, 18],
  distribution: [26, 52, 88, 96, 58, 30],
  monitor: [64, 60, 68, 62, 70, 64],
};

function Preview({ intent }: { intent: DashboardIntent }) {
  const palette = paletteFor(intent.theme);
  const bars = SHAPES[intent.lens];
  // 「上に見せる」は枚数が減るぶん、1枚が大きくなる。見本でも太くする。
  const wide = intent.audience === "exec";

  return (
    <div
      className="flex h-16 items-end gap-1.5 rounded-md border border-ink-line bg-paper-raised px-3 py-2.5"
      aria-hidden
    >
      {bars.map((h, i) => (
        <div
          key={i}
          className={cn(
            "rounded-sm transition-all duration-200 ease-out",
            wide ? "flex-1" : "w-3",
          )}
          style={{
            height: `${h}%`,
            backgroundColor: palette.series[i % palette.series.length],
          }}
        />
      ))}
    </div>
  );
}

/** 選択肢1つ。押した瞬間に凹む（80ms）——反応が遅いと「効いたのか」が分からない。 */
function Choice({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "rounded-md border px-3 py-2 text-left transition-all duration-fast",
        "active:scale-[0.97] focus:outline-none focus-visible:shadow-focus",
        selected
          ? "border-khaki-500 bg-khaki-50 text-ink"
          : "border-ink-line bg-paper-raised text-ink-soft hover:border-khaki-300 hover:bg-paper-sunken",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function DashboardIntentPicker({
  value,
  onChange,
}: {
  value: DashboardIntent;
  onChange: (next: DashboardIntent) => void;
}) {
  /*
   * 既定のまま進む人の邪魔をしないよう、畳んだ状態から始める。
   * ただし「おまかせで作ります」と今の色は畳んだまま見えるので、
   * ここに何かがあることは分かる。
   */
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<DashboardIntent>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="rounded-md border border-ink-line bg-paper-raised">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-paper-sunken"
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">
            どんな画面にしますか？
          </h3>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {LENS_META.find((l) => l.key === value.lens)?.label} ／
            {AUDIENCE_META.find((a) => a.key === value.audience)?.label} ／
            {paletteFor(value.theme).name}
          </p>
        </div>
        {/* 畳んでいるときも色だけは見える。開かないと分からない設定にしない。 */}
        <div className="flex shrink-0 gap-1" aria-hidden>
          {paletteFor(value.theme)
            .series.slice(0, 4)
            .map((c) => (
              <span
                key={c}
                className="h-4 w-2 rounded-sm transition-colors duration-200"
                style={{ backgroundColor: c }}
              />
            ))}
        </div>
        <span className="shrink-0 text-xs text-ink-muted">
          {open ? "閉じる" : "変える"}
        </span>
      </button>

      {open && (
        <div className="animate-fade-in space-y-4 border-t border-ink-line px-4 py-4">
          <Preview intent={value} />

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-ink-muted">
              何を知りたいですか
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LENS_META.map((l) => (
                <Choice
                  key={l.key}
                  selected={value.lens === l.key}
                  onClick={() => set({ lens: l.key })}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span aria-hidden className="text-base leading-none">
                      {l.glyph}
                    </span>
                    {l.label}
                  </span>
                  <span className="mt-0.5 block text-2xs leading-snug text-ink-muted">
                    {l.note}
                  </span>
                </Choice>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-ink-muted">
              誰が見ますか
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {AUDIENCE_META.map((a) => (
                <Choice
                  key={a.key}
                  selected={value.audience === a.key}
                  onClick={() => set({ audience: a.key })}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span aria-hidden className="text-base leading-none">
                      {a.glyph}
                    </span>
                    {a.label}
                  </span>
                  <span className="mt-0.5 block text-2xs leading-snug text-ink-muted">
                    {a.note}
                  </span>
                </Choice>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-ink-muted">
              色
            </legend>
            <ThemeSelect
              value={value.theme}
              onChange={(theme) => set({ theme })}
            />
          </fieldset>
        </div>
      )}
    </div>
  );
}
