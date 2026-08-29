"use client";

import { createContext, useContext } from "react";

/**
 * 「このグラフはどのダッシュボードのものか」を、中のウィジェット全部に配る。
 *
 * ドリルダウンは「ダッシュボード → グラフのひと切れ → その裏の行」という
 * 一続きの動きなのに、着いた先に**帰る手段が無かった**。ブラウザの戻るは効くが、
 * 押した本人はもう表を触っていて（並べ替え・列の編集・別の行を開く）、
 * 戻るを何回押せば元のダッシュボードに帰れるのか分からない。行き先のURLに
 * 「どこから来たか」を載せて、着いた先にその場所の名前で戻り道を出す。
 *
 * PaletteContext と同じ形で配るのは同じ理由——リンクを組み立てるのは
 * ウィジェット本体ではなく、その中の小さなヘルパの中だからで、そこまで
 * prop を引き回すと呼び出し側の見通しが悪くなる。
 *
 * 既定は null。**包み忘れても壊れない**——戻り道が出ないだけで、遷移も
 * 絞り込みも今までどおり動く。共有リンク（未認証で見る画面）やレポートの
 * 印刷ページのように、そもそも戻り先が無い場所ではこれが正しい。
 */
const DrillOriginContext = createContext<string | null>(null);

export function DrillOriginProvider({
  dashboardId,
  children,
}: {
  dashboardId?: string | null;
  children: React.ReactNode;
}) {
  return (
    <DrillOriginContext.Provider value={dashboardId ?? null}>
      {children}
    </DrillOriginContext.Provider>
  );
}

/** 戻り先のダッシュボードid。無ければ null（戻り道を出さない）。 */
export function useDrillOrigin(): string | null {
  return useContext(DrillOriginContext);
}
