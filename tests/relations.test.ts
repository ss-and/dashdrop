/**
 * 「自動計算の列（computed）を、他の列の参照先にしてしまえる」不具合の回帰テスト。
 *
 * 実際に起きていた症状：
 *  1. ルックアップ／ロールアップの「取得する項目」に、リンク先シートの計算式列や
 *     VLOOKUP 列が出てきて、選んで保存すると緑の「保存しました」が出る。しかし
 *     解決時に読むのはリンク先の *保存済みデータ* だけなので（これが A→B→A の
 *     循環を原理的に不可能にしている）、計算列のキーはそこに存在せず、その列は
 *     永久に空欄のまま。原因は画面にも API にも一切表示されない。
 *  2. リンク（relation）の「表示する列」に計算列を選ぶと、チップのラベルが全件
 *     「（無題）」になる。
 *
 * 原因はどちらも同じで、計算列の判定を `type !== "lookup" && type !== "rollup"`
 * と手で並べていたこと。あとから増えた formula / vlookup がすり抜けていた。
 * tests/field-types.test.ts:245 が記録している「グリッドが読み取り専用判定を
 * lookup/rollup の決め打ちでやっていた」回帰の生き残りで、DataGrid だけ直され、
 * 項目エディタと validateFieldConfig に残っていた。
 * 判定は COMPUTED_FIELD_TYPES / isComputedField に一本化する。
 *
 * 併せて、項目エディタのダイアログのキーボード契約（フォーカスの出入り・Escape）も
 * ここで見張る。見た目だけモーダルで role も Escape も無い状態には戻さない。
 *
 * DB を触る部分は tests/relations-display.test.ts と同じやり方（使い捨ての SQLite に
 * スキーマを流し込み、DATABASE_URL を差し替えたあとの beforeAll で動的 import）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createElement, useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPUTED_FIELD_TYPES, type FieldType } from "@/lib/field-types";
import { FieldEditor } from "@/components/grid/FieldEditor";
import type { GridField } from "@/components/grid/cells";
import type { WorkspaceCollection } from "@/components/grid/DataGrid";
import type { EngineField } from "@/lib/relations";

/* ------------------------------- 使い捨て DB ------------------------------ */

const tmpDir = mkdtempSync(join(tmpdir(), "dashdrop-relations-"));
const dbFile = join(tmpDir, "relations.db");
// tests/setup.ts が `??=` で file:./test.db を入れているので、上書きは代入で行う。
process.env.DATABASE_URL = `file:${dbFile}`;

let db: typeof import("@/lib/db").db;
let validateFieldConfig: typeof import("@/lib/relations").validateFieldConfig;

let workspaceId = "";
/** リンク先（商品シート）の列。保存される列と計算列が混在している。 */
let targetFields: EngineField[] = [];
/** 受注シート側の列（relation を含む）＝ validateFieldConfig の siblingFields。 */
let orderFields: EngineField[] = [];

/** 計算列のキー（種類 → 列キー）。テストは4種類すべてを回す。 */
const COMPUTED_KEYS: Record<string, string> = {
  lookup: "supplierName",
  rollup: "stockTotal",
  formula: "grossMargin",
  vlookup: "categoryLabel",
};

beforeAll(async () => {
  execFileSync(
    "npx",
    ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"],
    {
      cwd: process.cwd(),
      // prisma CLI は .env を読むので、明示的に上書きして dev.db を守る。
      env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
      stdio: "pipe",
    },
  );
  db = (await import("@/lib/db")).db;
  validateFieldConfig = (await import("@/lib/relations")).validateFieldConfig;

  const workspace = await db.workspace.create({
    data: { name: "テスト商事", slug: "test-relations-validate" },
  });
  workspaceId = workspace.id;

  // 商品シート：保存される列と、4種類すべての計算列。
  const products = await db.collection.create({
    data: {
      workspaceId,
      name: "商品",
      slug: "products",
      fields: {
        create: [
          { key: "name", name: "商品名", type: "text", position: 0 },
          { key: "price", name: "単価", type: "currency", position: 1 },
          {
            key: COMPUTED_KEYS.lookup,
            name: "仕入先名",
            type: "lookup",
            config: { via: "supplier", target: "name" },
            position: 2,
          },
          {
            key: COMPUTED_KEYS.rollup,
            name: "在庫合計",
            type: "rollup",
            config: { via: "supplier", target: "stock", op: "sum" },
            position: 3,
          },
          {
            key: COMPUTED_KEYS.formula,
            name: "粗利",
            type: "formula",
            config: { expression: "{price} - {cost}" },
            position: 4,
          },
          {
            key: COMPUTED_KEYS.vlookup,
            name: "分類名",
            type: "vlookup",
            config: {
              targetCollectionId: "dummy",
              localKey: "name",
              targetKey: "name",
              targetField: "label",
              aggregate: "first",
            },
            position: 5,
          },
        ],
      },
    },
    include: { fields: { orderBy: { position: "asc" } } },
  });
  targetFields = products.fields as unknown as EngineField[];

  // 受注シート：商品へのリンクを1本持つ（ルックアップ／ロールアップの via）。
  const orders = await db.collection.create({
    data: {
      workspaceId,
      name: "受注",
      slug: "orders",
      fields: {
        create: [
          { key: "title", name: "件名", type: "text", position: 0 },
          {
            key: "product",
            name: "商品",
            type: "relation",
            config: { targetCollectionId: products.id, displayFieldKey: "name" },
            position: 1,
          },
        ],
      },
    },
    include: { fields: { orderBy: { position: "asc" } } },
  });
  orderFields = orders.fields as unknown as EngineField[];
}, 120_000);

afterAll(async () => {
  await db.$disconnect().catch(() => {});
  rmSync(tmpDir, { recursive: true, force: true });
});

/* ------------------------- validateFieldConfig ---------------------------- */

describe("validateFieldConfig — ルックアップ／ロールアップの対象列", () => {
  it("列挙もれ防止：計算列は4種類そろっている", () => {
    // COMPUTED_FIELD_TYPES に型が増えたら、この表にも足して全種類を回す。
    expect([...COMPUTED_FIELD_TYPES].sort()).toEqual(
      Object.keys(COMPUTED_KEYS).sort(),
    );
  });

  for (const type of COMPUTED_FIELD_TYPES) {
    const targetKey = COMPUTED_KEYS[type];

    it(`ルックアップの対象に ${type} 列（自動計算）を指定すると 422 で断る`, async () => {
      const call = validateFieldConfig(
        workspaceId,
        "lookup",
        { via: "product", target: targetKey },
        orderFields,
      );
      // 「保存はできたのに永久に空欄」ではなく、その場で理由が出ること。
      await expect(call).rejects.toThrow(/自動計算の列/);
      await call.catch((e: unknown) => {
        expect((e as { status?: number }).status).toBe(422);
        // どの列がだめなのか、利用者が見ている名前で伝える。
        expect((e as Error).message).toContain(
          targetFields.find((f) => f.key === targetKey)!.name,
        );
      });
    });

    it(`ロールアップの対象に ${type} 列（自動計算）を指定すると 422 で断る`, async () => {
      await expect(
        validateFieldConfig(
          workspaceId,
          "rollup",
          { via: "product", target: targetKey, op: "sum" },
          orderFields,
        ),
      ).rejects.toThrow(/自動計算の列/);
    });

    it(`リンクの表示する列に ${type} 列（自動計算）を指定すると 422 で断る`, async () => {
      // 通すと、リンクのチップが全件「（無題）」になる。
      const products = await db.collection.findFirstOrThrow({
        where: { workspaceId, slug: "products" },
      });
      await expect(
        validateFieldConfig(
          workspaceId,
          "relation",
          { targetCollectionId: products.id, displayFieldKey: targetKey },
          orderFields,
        ),
      ).rejects.toThrow(/自動計算の列/);
    });
  }

  it("保存されている列を指定したときは、これまで通り通る", async () => {
    await expect(
      validateFieldConfig(
        workspaceId,
        "lookup",
        { via: "product", target: "name" },
        orderFields,
      ),
    ).resolves.toEqual({ via: "product", target: "name" });

    await expect(
      validateFieldConfig(
        workspaceId,
        "rollup",
        { via: "product", target: "price", op: "sum" },
        orderFields,
      ),
    ).resolves.toEqual({ via: "product", target: "price", op: "sum" });
  });

  it("リンクの表示する列は、保存されている列なら通る（未指定なら自動選択）", async () => {
    const products = await db.collection.findFirstOrThrow({
      where: { workspaceId, slug: "products" },
    });
    await expect(
      validateFieldConfig(
        workspaceId,
        "relation",
        { targetCollectionId: products.id, displayFieldKey: "name" },
        orderFields,
      ),
    ).resolves.toEqual({
      targetCollectionId: products.id,
      displayFieldKey: "name",
      multiple: false,
    });
    await expect(
      validateFieldConfig(
        workspaceId,
        "relation",
        { targetCollectionId: products.id },
        orderFields,
      ),
    ).resolves.toEqual({
      targetCollectionId: products.id,
      displayFieldKey: "name", // pickDisplayField は元から計算列を除外している
      multiple: false,
    });
  });
});

/* ---------------------------- 項目エディタの候補 --------------------------- */

/** DB を使わない、画面テスト用の列定義。 */
function gridField(
  key: string,
  name: string,
  type: FieldType,
  config: Record<string, unknown> | null = null,
): GridField {
  return {
    id: `f-${key}`,
    key,
    name,
    type,
    required: false,
    options: null,
    config,
    position: 0,
  };
}

const TARGET_SHEET: WorkspaceCollection = {
  id: "col-products",
  name: "商品",
  fields: [
    { key: "name", name: "商品名", type: "text" },
    { key: "price", name: "単価", type: "currency" },
    { key: "supplierName", name: "仕入先名", type: "lookup" },
    { key: "stockTotal", name: "在庫合計", type: "rollup" },
    { key: "grossMargin", name: "粗利", type: "formula" },
    { key: "categoryLabel", name: "分類名", type: "vlookup" },
  ],
};

/** 計算列の「名前」だけを集めたもの（候補に出ていないことの確認用）。 */
const COMPUTED_NAMES = ["仕入先名", "在庫合計", "粗利", "分類名"];

const ORDER_FIELDS: GridField[] = [
  gridField("title", "件名", "text"),
  gridField("product", "商品", "relation", {
    targetCollectionId: TARGET_SHEET.id,
    displayFieldKey: "name",
  }),
];

function renderEditor(onClose: () => void = () => {}) {
  return render(
    createElement(FieldEditor, {
      collectionId: "col-orders",
      collectionFields: ORDER_FIELDS,
      workspaceCollections: [TARGET_SHEET],
      onClose,
      onSaved: () => {},
    }),
  );
}

/** <select> の選択肢ラベル一覧（先頭のプレースホルダを除く）。 */
function optionLabels(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "")
    .filter((t) => t !== "選択してください" && t !== "自動（先頭のテキスト列）");
}

describe("項目エディタ — 参照先に選べる列", () => {
  it("リンクの「表示する列」に自動計算の列を出さない", () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("種類"), {
      target: { value: "relation" },
    });
    fireEvent.change(screen.getByLabelText("リンク先スプレッドシート"), {
      target: { value: TARGET_SHEET.id },
    });

    const labels = optionLabels(screen.getByLabelText("表示する列"));
    expect(labels).toEqual(["商品名", "単価"]);
    for (const name of COMPUTED_NAMES) expect(labels).not.toContain(name);
  });

  it("ルックアップの「取得する項目」に自動計算の列を出さない", () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("種類"), {
      target: { value: "lookup" },
    });
    fireEvent.change(screen.getByLabelText("参照するリンク列"), {
      target: { value: "product" },
    });

    const labels = optionLabels(screen.getByLabelText("取得する項目"));
    expect(labels).toEqual(["商品名", "単価"]);
    for (const name of COMPUTED_NAMES) expect(labels).not.toContain(name);
  });

  it("ロールアップの「集計する項目」にも自動計算の列を出さない", () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("種類"), {
      target: { value: "rollup" },
    });
    fireEvent.change(screen.getByLabelText("リンク列"), {
      target: { value: "product" },
    });

    const labels = optionLabels(screen.getByLabelText("集計する項目"));
    expect(labels).toEqual(["商品名", "単価"]);
  });
});

/* ------------------------ ダイアログのキーボード契約 ----------------------- */

/** 「項目を追加」ボタン → ダイアログ、という実際の開き方を再現する入れ物。 */
function Harness() {
  const [open, setOpen] = useState(false);
  return createElement(
    "div",
    null,
    createElement(
      "button",
      { type: "button", onClick: () => setOpen(true) },
      "＋項目を追加",
    ),
    open
      ? createElement(FieldEditor, {
          collectionId: "col-orders",
          collectionFields: ORDER_FIELDS,
          workspaceCollections: [TARGET_SHEET],
          onClose: () => setOpen(false),
          onSaved: () => {},
        })
      : null,
  );
}

describe("項目エディタ — ダイアログのキーボード契約", () => {
  it("ダイアログとして名前が付いている（役割・モーダル・見出しの紐付け）", () => {
    renderEditor();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // 支援技術が読み上げる名前は、見出しそのもの。
    expect(dialog).toHaveAccessibleName("項目を追加");
  });

  it("開いた瞬間にフォーカスがダイアログの中へ移る", () => {
    renderEditor();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("項目名"));
  });

  it("Escape で閉じ、フォーカスは開いたボタンへ戻る", () => {
    render(createElement(Harness));
    const opener = screen.getByRole("button", { name: "＋項目を追加" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    // ここが body に落ちると、キーボード利用者は表のどこにいたのか分からなくなる。
    expect(document.activeElement).toBe(opener);
  });

  it("開いている間、タブ移動はダイアログの中で折り返す", () => {
    renderEditor();
    const dialog = screen.getByRole("dialog");
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(first).not.toBe(last);

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
