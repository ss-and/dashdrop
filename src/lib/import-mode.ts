/**
 * 同名ファイルをどう扱うか（置き換える / 追加する）の共通定義。
 *
 * 【なぜ切り出したか】
 * 「Excelを取り込む」入口はこの製品に2つある——ホームのドロップゾーン
 * （/api/import/analyze → ImportReview）と /import の画面（/api/import/preview
 * → ImportWizard）。ところが同名ファイルの置き換えはホーム側にしか無く、
 * /import から入った人は毎月「売上台帳」が1つずつ増えていた。しかも設定ガイド
 * （src/lib/onboarding.ts）が案内するのは /import の方なので、新しく入った人ほど
 * 機能の欠けた側に流れていた。
 *
 * 揃えるにあたって、**形と文言をここに1つだけ置く**。2つの画面で別々に
 * 組み立てると、片方だけ直して食い違う（着地先が片方だけダッシュボードに
 * なっていた件と同じ轍）。
 *
 * 【client component から読むので db を持ち込まないこと】
 * ImportWizard は "use client"。ここに @/lib/db や @/lib/env を import すると
 * Prisma や秘密の入った env がブラウザのバンドルに入る。DB を引く側は
 * src/lib/existing-workbook.ts（サーバ専用）に分けてある。
 * ImportChoiceOption だけは import type で借りる（型は消えるので安全）。
 */
import type { ImportChoiceOption } from "./import-advisor";

/** 既に入っているファイルの中の1シート。 */
export interface ExistingWorkbookSheet {
  name: string;
  slug: string;
  rowCount: number;
}

/**
 * 同じ名前で既に入っているファイル。無ければ null。
 *
 * この形は /api/import/analyze が返しているものと**同じ**にしてある。
 * 2つの入口で別々の形を返すと、画面側が分岐だらけになるため。
 * （analyze 側は別の担当分なのでここを import してはいないが、形を変えるときは
 * 必ず両方そろえること。）
 */
export interface ExistingWorkbook {
  workbookId: string;
  name: string;
  importedAt: string;
  sheets: ExistingWorkbookSheet[];
}

/** 同名ファイルの扱い。/api/import の `mode` にそのまま渡る値。 */
export type ImportMode = "replace" | "add";

/**
 * 選択肢の文言。**src/components/home/ImportReview.tsx と一字一句同じ**にする。
 * 同じ判断を2か所で別の言い回しで聞かれると、利用者は「別のことを聞かれている」
 * と読む。hint（選んだ結果の1行）を必ず添えるのはこのリポジトリの方針
 * （src/lib/import-advisor.ts の ImportChoiceOption）。
 */
export const IMPORT_MODE_OPTIONS: readonly (ImportChoiceOption & {
  value: ImportMode;
})[] = [
  {
    value: "replace",
    label: "上書きして更新する",
    hint: "同じ名前のシートは中身を入れ替えます。ダッシュボードとURLはそのまま使えます。",
  },
  {
    value: "add",
    label: "別のファイルとして追加する",
    hint: "今あるものは残したまま、新しく増やします。名前には (2) が付きます。",
  },
];

/**
 * 既定の選択。
 *
 * 同名が有るときは "replace"。毎月同じ台帳を入れ直すのが普通の使い方で、
 * 既定を "add" にすると黙って同名のファイルが増え続ける——それが今回直した
 * 不具合そのもの。ホーム側（ImportReview.tsx）の既定と合わせてあるので、
 * 片方だけ変えないこと。
 */
export function defaultImportMode(existing: unknown): ImportMode {
  return existing ? "replace" : "add";
}

/**
 * ファイル名から拡張子を落とした、ブック名として使われる部分。
 * /api/import が付ける名前（route.ts の fileBase）と同じ規則にしてある。
 * ここがずれると「同名あり」と言いながら別の名前で作る、が起きる。
 */
export function workbookBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim();
}
