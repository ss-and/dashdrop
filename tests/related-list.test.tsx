/**
 * 関連リストの件数表示が「打ち切りを黙って行わない」ことを確かめる。
 *
 * この画面は、子コレクションの行を**新しい順に200件だけ**読んで JS で
 * 突き合わせている（src/app/(app)/r/[collectionId]/[recordId]/page.tsx の
 * MAX_RELATED_SCAN）。にもかかわらず、その中で数えた一致数を「全12件」と
 * 総数のように出していた。走査の外に一致があっても数にも表示にも現れず、
 * 利用者には切り捨てが起きたことすら分からない——DataGrid（読み込み済みの
 * 件数を断る）や検索API（`more` / `scope` を返す）で徹底してきた方針から、
 * ここだけが漏れていた。
 *
 * そこで確かめるのは次の2点。
 *  1. 走査上限に達していないときは、これまでどおり「12件 / 全12件」と言い切る。
 *  2. 達しているときは「全〜件」と名乗らず、何件を見たうえでの数なのかを出す。
 *
 * 2 は打ち切り判定（isScanLimited / scanLimited）を反転させると必ず落ちる
 * ようにしてある（1 の「全」表記と 2 の「直近」表記が排他なので、どちらへ
 * 倒れても検出される）。
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  RelatedList,
  isScanLimited,
  relatedCountLabel,
  type RelatedListData,
} from "@/components/record/RelatedList";
import type { RecordFieldDef } from "@/components/record/RecordValue";

const columns: RecordFieldDef[] = [
  { key: "name", name: "件名", type: "text" },
  { key: "amount", name: "金額", type: "number" },
];

/** 表示する行（画面は最大8行しか並べない）。 */
function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `rec-${i}`,
    data: { name: `案件${i}`, amount: i * 100 },
    computed: {},
  }));
}

function makeList(over: Partial<RelatedListData> = {}): RelatedListData {
  return {
    key: "child:owner",
    collectionId: "col-child",
    title: "商談",
    total: 12,
    scanLimited: false,
    scanLimit: 200,
    columns,
    rows: rows(8),
    relationLabels: {},
    ...over,
  };
}

describe("isScanLimited — 走査を打ち切ったかの判定", () => {
  it("上限より少なければ打ち切っていない（総数として出してよい）", () => {
    expect(isScanLimited(199, 200)).toBe(false);
    expect(isScanLimited(0, 200)).toBe(false);
  });

  it("上限ちょうど・それ以上なら打ち切り扱い", () => {
    // ちょうど200件で終わっている場合と、201件目がある場合を読んだ側からは
    // 区別できない。区別が付かないなら、多めに断るほうへ倒す。
    expect(isScanLimited(200, 200)).toBe(true);
    expect(isScanLimited(201, 200)).toBe(true);
  });
});

describe("relatedCountLabel — 件数の見出し", () => {
  it("打ち切っていなければ件数だけ", () => {
    expect(
      relatedCountLabel({ total: 12, scanLimited: false, scanLimit: 200 }),
    ).toBe("12件");
  });

  it("打ち切っていれば、何件を見たうえでの数かを添える", () => {
    expect(
      relatedCountLabel({ total: 12, scanLimited: true, scanLimit: 200 }),
    ).toBe("直近200件のうち12件");
  });
});

describe("RelatedList の件数表示", () => {
  it("走査が上限に達していなければ、総数として言い切る", () => {
    render(<RelatedList list={makeList()} />);

    expect(screen.getByText("12件")).toBeInTheDocument();
    expect(screen.getByText(/8件を表示中（全12件）/)).toBeInTheDocument();
    // 打ち切っていないのに打ち切りの注記を出してはいけない。
    expect(screen.queryByText(/直近/)).not.toBeInTheDocument();
  });

  it("走査が上限に達していたら「全N件」と名乗らない", () => {
    render(<RelatedList list={makeList({ scanLimited: true })} />);

    // 見出しは「12件」でも「全12件」でもなく、母数を明示した形になる。
    expect(screen.getByText("直近200件のうち12件")).toBeInTheDocument();
    expect(screen.queryByText("12件")).not.toBeInTheDocument();

    // 脚注も「全12件」とは書かず、何を見ていないのかまで書く。
    const note = screen.getByText(/8件を表示中/);
    expect(note.textContent).toContain("直近200件のうち12件");
    expect(note.textContent).toContain("新しい順 200件");
    expect(note.textContent).not.toContain("全12件");
  });

  it("表示件数と一致数が同じでも、打ち切っていれば黙らない", () => {
    // 「8件見つかって8件出した」ように見えるが、走査の外にまだあるかもしれない。
    // ここで脚注を省くと、利用者には「これで全部」としか読めない。
    render(
      <RelatedList list={makeList({ total: 8, scanLimited: true })} />,
    );

    expect(screen.getByText("直近200件のうち8件")).toBeInTheDocument();
    expect(screen.getByText(/8件を表示中/)).toBeInTheDocument();
  });

  it("打ち切っておらず全行を出しきったときは、脚注を出さない", () => {
    render(
      <RelatedList list={makeList({ total: 8, scanLimited: false })} />,
    );

    expect(screen.getByText("8件")).toBeInTheDocument();
    expect(screen.queryByText(/件を表示中/)).not.toBeInTheDocument();
  });
});
