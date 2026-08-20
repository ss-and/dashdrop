"use client";

import { createContext, useContext } from "react";
import { paletteFor, type Palette } from "@/lib/palette";

/**
 * ダッシュボード1枚ぶんの配色を、その中のウィジェット全部に配る。
 *
 * 各ウィジェットに prop で配らないのは、色を使うのがコンポーネント本体では
 * なく `hexFor()` や Recharts に渡す小さな関数の中だからで、そこまで引数を
 * 引き回すと呼び出し側の見通しが悪くなる。
 *
 * 既定値を持たせてあるので、Provider で包まない場所（ビルダーのプレビュー、
 * 単体テスト）でもそのまま描ける——包み忘れが「色が消える」ではなく
 * 「標準の色になる」で済む。
 */
const PaletteContext = createContext<Palette>(paletteFor(null));

export function PaletteProvider({
  theme,
  children,
}: {
  theme?: string | null;
  children: React.ReactNode;
}) {
  return (
    <PaletteContext.Provider value={paletteFor(theme)}>
      {children}
    </PaletteContext.Provider>
  );
}

export function usePalette(): Palette {
  return useContext(PaletteContext);
}
