/**
 * 事業者情報。**売り始めた瞬間に法律上の義務になる**ところを固定する。
 *
 * 特定商取引法に基づく表示の義務は「通信販売」——有料で売ったときに生じる。
 * 無償の間は義務が無い。だから DashDrop では、表示を出すかどうかを
 * 「何か1つでも買えるプランがあるか」（anyPlanPurchasable）で切り替える。
 * 料金ページの「お申し込み」導線と**同じ判定**なので、
 *
 *   売っているのに表記が無い     → ここで落ちる
 *   売っていないのに未完成表示が出る → 出し分けで起きない
 *
 * の両方が同時に成立しなくなる。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  COMMERCE_ENTRIES,
  SELLER_ENTRIES,
  CONTACT_EMAIL,
  missingCommerceEntries,
} from "@/lib/legal";
import { anyPlanPurchasable } from "@/lib/plans";

describe("売り始めたら、表記が揃っていること", () => {
  /**
   * これが本命。`available: true` を立てた瞬間にこのテストが落ち、
   * 未記入のまま課金を始められない。落ちたら src/lib/legal.ts を埋める。
   */
  it("買えるプランがあるなら、必須項目に空欄が無い", () => {
    if (!anyPlanPurchasable) {
      // まだ無償提供。義務が無いので、空欄があってよい。
      expect(anyPlanPurchasable).toBe(false);
      return;
    }
    expect(missingCommerceEntries()).toEqual([]);
  });
});

describe("無償で提供している間も、運営者は名乗る", () => {
  /**
   * 名前も宛先も無いサービスに、自社の売上や顧客の一覧を預ける人はいない。
   * 義務の有無とは別に、ここは常に埋まっている必要がある。
   */
  it("運営者と連絡先が埋まっている", () => {
    for (const e of SELLER_ENTRIES) {
      expect(e.value.trim(), e.label).not.toBe("");
    }
    expect(SELLER_ENTRIES.map((e) => e.label)).toEqual([
      "販売事業者",
      "運営統括責任者",
      "メールアドレス",
    ]);
  });

  it("問い合わせ先が空でない（規約・ポリシーの末尾に出る）", () => {
    expect(CONTACT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });

  it("運営者の項目は、全体の表と同じ値を指している（二重管理しない）", () => {
    for (const e of SELLER_ENTRIES) {
      expect(COMMERCE_ENTRIES).toContain(e);
    }
  });
});

describe("公開ページに内部の事情を書かない", () => {
  const page = readFileSync("src/app/(marketing)/legal/page.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  /**
   * 【回帰】未記入の警告に `src/lib/legal.ts` と書いていた。読むのは利用者で、
   * ソースの置き場所を知らされてもできることは何も無い。運営の未完成ぶりだけが
   * 伝わる。
   */
  it("利用者に見える文面にソースのパスが出ない", () => {
    expect(page).not.toContain("src/lib");
    expect(page).not.toContain(".ts</code>");
  });

  /**
   * 判定そのものを見る。`toContain("anyPlanPurchasable")` だけだと、
   * 条件を `if (false)` に潰しても **import に名前が残るので通ってしまう**
   * （実際にその変異を素通しした）。分岐の形で確かめる。
   */
  it("売っているかどうかで出し分けている", () => {
    expect(page).toMatch(/if\s*\(\s*!anyPlanPurchasable\s*\)/);
  });
});
