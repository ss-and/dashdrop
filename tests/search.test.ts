/**
 * グローバル検索の突き合わせの回帰テスト。
 *
 * 直そうとしている不具合:
 *  - multiselect の値は配列なので `String(["other"])` が選択肢の value と
 *    一致せず、選択肢のラベルへ置き換える分岐から落ちていた。その結果、
 *    画面に「その他」と出ている行が「その他」では引けず、保存されている
 *    コード `other` でだけ引ける、という逆転が起きていた。
 *    検索は「見えている文字で引ける」ことが約束なので、これは致命的。
 */
import { describe, it, expect } from "vitest";
import {
  matchRecord,
  matchValue,
  optionLabels,
  prepareField,
  renderValue,
} from "@/components/search/match";

const status = prepareField({
  key: "status",
  name: "ステータス",
  type: "select",
  options: [
    { label: "対応中", value: "open" },
    { label: "その他", value: "other" },
  ],
});

const tags = prepareField({
  key: "tags",
  name: "タグ",
  type: "multiselect",
  options: [
    { label: "その他", value: "other" },
    { label: "至急", value: "urgent" },
  ],
});

const name = prepareField({
  key: "name",
  name: "会社名",
  type: "text",
  options: null,
});

describe("optionLabels", () => {
  it("value → label の対応表を作る", () => {
    expect(optionLabels([{ label: "その他", value: "other" }]).get("other")).toBe(
      "その他",
    );
  });

  it("選択肢が壊れていても落ちない", () => {
    expect(optionLabels(null).size).toBe(0);
    expect(optionLabels("なにか").size).toBe(0);
    expect(optionLabels([null, 3, { value: "a" }, { label: "", value: "b" }]).size).toBe(
      0,
    );
  });
});

describe("renderValue（画面と同じ見え方）", () => {
  it("multiselect はコードではなくラベルを並べる", () => {
    expect(renderValue(tags, ["other", "urgent"])).toBe("その他, 至急");
  });

  it("select もラベルにする", () => {
    expect(renderValue(status, "other")).toBe("その他");
  });

  it("選択肢から消えたコードは、隠さずそのまま出す", () => {
    expect(renderValue(status, "archived")).toBe("archived");
    expect(renderValue(tags, ["other", "archived"])).toBe("その他, archived");
  });

  it("空の値は空文字（空配列を含む）", () => {
    expect(renderValue(tags, [])).toBe("");
    expect(renderValue(name, null)).toBe("");
    expect(renderValue(name, "")).toBe("");
  });
});

describe("matchValue（一致の判定）", () => {
  it("multiselect を画面に出ているラベルで引ける", () => {
    expect(matchValue(tags, ["other"], "その他")).toBe("その他");
    expect(matchValue(tags, ["urgent", "other"], "至急")).toBe("至急, その他");
  });

  it("保存されているコードでも今までどおり引ける", () => {
    expect(matchValue(tags, ["other"], "other")).toBe("その他");
    expect(matchValue(status, "open", "open")).toBe("対応中");
  });

  it("一致しなければ null", () => {
    expect(matchValue(tags, ["urgent"], "その他")).toBeNull();
    expect(matchValue(tags, [], "その他")).toBeNull();
    expect(matchValue(name, null, "あ")).toBeNull();
  });

  it("英字の大文字小文字は区別しない（検索語は小文字化して渡す）", () => {
    expect(matchValue(name, "DashDrop 株式会社", "dashdrop")).toBe(
      "DashDrop 株式会社",
    );
  });
});

describe("matchRecord（1行の突き合わせ）", () => {
  const fields = [name, status, tags];

  it("最初に一致した項目を「項目名: 表示値」で返す", () => {
    expect(
      matchRecord(fields, { name: "田中商店", status: "open", tags: ["other"] }, "その他"),
    ).toBe("タグ: その他");
  });

  it("項目名ではなく値で引く", () => {
    expect(matchRecord(fields, { name: "田中商店" }, "田中")).toBe(
      "会社名: 田中商店",
    );
    expect(matchRecord(fields, { name: "田中商店" }, "会社名")).toBeNull();
  });

  it("どの項目にも無ければ null", () => {
    expect(matchRecord(fields, { name: "田中商店" }, "佐藤")).toBeNull();
  });
});
