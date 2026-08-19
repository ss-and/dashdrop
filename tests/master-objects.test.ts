/**
 * 組み込みマスターDB（顧客・人事）のプラン上限まわり。
 *
 * 実際に起きた不具合の回帰テスト: Free プランは 10 シートで、CRM 5 + HR 5 を
 * 入れるとちょうど使い切ってしまい、「人事データベースを作成」が必ず
 * 上限エラーになっていた。マスターは枠を消費しない、が正。
 */
import { describe, it, expect } from "vitest";
import { CRM_SLUGS } from "@/lib/crm-objects";
import { HR_SLUGS } from "@/lib/hr-objects";
import {
  MASTER_SLUGS,
  isMasterSlug,
  countBillableCollections,
} from "@/lib/master-objects";
import { getPlan } from "@/lib/plans";

describe("master-objects", () => {
  it("CRM と HR の slug をすべて含む", () => {
    for (const s of [...CRM_SLUGS, ...HR_SLUGS]) {
      expect(MASTER_SLUGS).toContain(s);
      expect(isMasterSlug(s)).toBe(true);
    }
  });

  it("CRM と HR の slug は重複しない", () => {
    expect(new Set(MASTER_SLUGS).size).toBe(MASTER_SLUGS.length);
  });

  it("ユーザーのシートはマスター扱いしない", () => {
    expect(isMasterSlug("uriage-2026")).toBe(false);
    expect(isMasterSlug("")).toBe(false);
    expect(isMasterSlug("employees")).toBe(false); // 参考シート側の slug
  });

  it("マスターは上限に数えない", () => {
    const collections = [
      ...MASTER_SLUGS.map((slug) => ({ slug })),
      { slug: "uriage" },
      { slug: "keihi" },
    ];
    expect(countBillableCollections(collections)).toBe(2);
  });

  it("空配列は 0", () => {
    expect(countBillableCollections([])).toBe(0);
  });

  it("Free プランでも CRM+HR を入れた上でシートを作る余地が残る", () => {
    const free = getPlan("free");
    const afterInstall = MASTER_SLUGS.map((slug) => ({ slug }));
    expect(countBillableCollections(afterInstall)).toBe(0);
    expect(free.limits.collections).toBeGreaterThan(0);
  });
});
