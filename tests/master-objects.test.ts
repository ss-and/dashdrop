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
  assertWithinCollectionLimit,
  takenSlugsWithReserved,
} from "@/lib/master-objects";
import { uniqueName, slugify } from "@/lib/utils";
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

describe("assertWithinCollectionLimit", () => {
  const free = getPlan("free");

  /**
   * 回帰テスト: 上限の除外をインストーラだけに入れて取り込み側を直し忘れた結果、
   * Free プランで 顧客DB5 + 人事DB5 + 既定2 = 12 になり、Excel を1枚も
   * 取り込めなくなっていた。数え方は全経路で一致していること。
   */
  it("マスターDBは何個あっても取り込みを妨げない", () => {
    const workspace = [
      ...MASTER_SLUGS.map((slug) => ({ slug })),
      { slug: "inquiries" },
      { slug: "tasks" },
    ];
    expect(() => assertWithinCollectionLimit(free, workspace, 1)).not.toThrow();
    // ユーザーのシートは2件なので、上限10まであと8件入る。
    expect(() =>
      assertWithinCollectionLimit(free, workspace, 8),
    ).not.toThrow();
    expect(() => assertWithinCollectionLimit(free, workspace, 9)).toThrow();
  });

  it("超過時のメッセージに残り枠と、マスターは含まない旨が入る", () => {
    const full = Array.from({ length: 10 }, (_, i) => ({ slug: `sheet-${i}` }));
    try {
      assertWithinCollectionLimit(free, full, 1);
      throw new Error("should have thrown");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("現在 10 件");
      expect(message).toContain("あと 0 件");
      expect(message).toContain("上限に含みません");
    }
  });

  it("空のワークスペースは上限ぶん作れる", () => {
    expect(() => assertWithinCollectionLimit(free, [], 10)).not.toThrow();
    expect(() => assertWithinCollectionLimit(free, [], 11)).toThrow();
  });
});

describe("takenSlugsWithReserved", () => {
  /**
   * 回帰テスト: 「Accounts」という名前のExcelを取り込むと slug が accounts に
   * なり、(1) 上限から除外される枠を只で得られ、(2) 後から顧客データベースを
   * 作ろうとすると「もう有る」と判定されて他のオブジェクトの関連がその
   * シートを向いてしまう、という2つの不具合の入口になっていた。
   */
  it("ユーザーのシートはマスターの slug を取れない", () => {
    const taken = takenSlugsWithReserved([{ slug: "uriage" }]);
    for (const reserved of MASTER_SLUGS) {
      expect(taken.has(reserved)).toBe(true);
    }
    expect(uniqueName(slugify("Accounts"), taken)).toBe("accounts-2");
    expect(uniqueName(slugify("HR Employees"), taken)).toBe("hr-employees-2");
  });

  it("既存のシートとも衝突しない", () => {
    const taken = takenSlugsWithReserved([{ slug: "uriage" }]);
    expect(uniqueName(slugify("売上"), taken)).not.toBe("uriage");
    expect(uniqueName(slugify("keihi"), taken)).toBe("keihi");
  });
});
