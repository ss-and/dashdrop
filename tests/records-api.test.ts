/**
 * レコード／項目 API の DB 結合テスト。
 *
 * install-master.test.ts と同じ作法：このファイル専用の使い捨て SQLite に
 * DATABASE_URL を差し替え、`prisma db push` でスキーマを流し込んでから
 * db に触るモジュールを **動的 import** する（static import は巻き上げられて
 * 代入より先に評価されてしまうため）。
 *
 * ここで守りたいのは「保存できたか」ではなく「利用者が嘘をつかれないか」。
 * 実際に起きた壊れ方は次の4つで、いずれも件数や 200 応答だけを見るテストでは
 * まったく検出できなかった。
 *   1. リンク先の1件を消しただけで、その行のどのセルも二度と保存できない
 *   2. 消えた列に打ち込んだ内容が、200 OK で「保存済み」表示のまま消える
 *   3. ルックアップ等が参照している列を、警告なしに削除できてしまう
 *   4. 同名の項目を作り直すと、削除したはずの古い値が別の種類の列に復活する
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CurrentUser } from "@/lib/auth";

/* ------------------------------- 使い捨て DB ------------------------------ */

const tmpDir = mkdtempSync(join(tmpdir(), "dashdrop-records-api-"));
const dbFile = join(tmpDir, "records-api.db");
// tests/setup.ts が `??=` で file:./test.db を入れているので、上書きは代入で行う。
process.env.DATABASE_URL = `file:${dbFile}`;

/* --------------------------- ルートを直接叩く土台 -------------------------- */

// next/server を読み込まずに withAuth を素通しさせる。ApiError は本物を使い、
// ルート側の instanceof 判定と一致させる。fail() 相当の封筒に詰め直すことで、
// 「利用者に成功と見えるか」をそのまま検証できる。
vi.mock("@/lib/api", async () => {
  const errors = await import("@/lib/errors");
  type Ctx = { user: CurrentUser; params: Record<string, string> };
  type Handler = (req: unknown, ctx: Ctx) => Promise<unknown>;
  return {
    ApiError: errors.ApiError,
    ok: (data: unknown) => ({ ok: true, data }),
    fail: (error: string, status: number) => ({ ok: false, error, status }),
    withAuth: (handler: Handler) => async (req: unknown, ctx: Ctx) => {
      try {
        return await handler(req, ctx);
      } catch (err) {
        if (err instanceof errors.ApiError) {
          return { ok: false, error: err.message, status: err.status };
        }
        throw err;
      }
    },
    readJson: async (
      req: { json: () => Promise<unknown> },
      schema: { parse: (v: unknown) => unknown },
    ) => schema.parse(await req.json()),
  };
});

type RouteResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; status: number };

type RouteHandler = (
  req: { json: () => Promise<unknown> },
  ctx: { user: CurrentUser; params: Record<string, string> },
) => Promise<RouteResult>;

/** JSON ボディを持つ Request の代わり（readJson は json() しか使わない）。 */
function reqWith(body: unknown): { json: () => Promise<unknown> } {
  return { json: async () => body };
}

function expectOk(res: RouteResult): Record<string, unknown> {
  if (!res.ok) throw new Error(`成功するはずが失敗した: ${res.error}`);
  return res.data;
}

function expectFail(res: RouteResult): { error: string; status: number } {
  if (res.ok) throw new Error("失敗するはずが成功した（利用者に嘘をついている）");
  return { error: res.error, status: res.status };
}

let db: typeof import("@/lib/db").db;
let patchRecord: RouteHandler;
let createRecord: RouteHandler;
let createField: RouteHandler;
let patchField: RouteHandler;
let deleteField: RouteHandler;
let createCollection: RouteHandler;

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
  const recordRoute = await import("@/app/api/records/[id]/route");
  const recordsRoute = await import("@/app/api/collections/[id]/records/route");
  const fieldsRoute = await import("@/app/api/collections/[id]/fields/route");
  const fieldRoute = await import("@/app/api/collections/[id]/fields/[fieldId]/route");
  const collectionsRoute = await import("@/app/api/collections/route");
  patchRecord = recordRoute.PATCH as unknown as RouteHandler;
  createRecord = recordsRoute.POST as unknown as RouteHandler;
  createField = fieldsRoute.POST as unknown as RouteHandler;
  patchField = fieldRoute.PATCH as unknown as RouteHandler;
  deleteField = fieldRoute.DELETE as unknown as RouteHandler;
  createCollection = collectionsRoute.POST as unknown as RouteHandler;
}, 180_000);

afterEach(async () => {
  // Workspace / User を消せば Collection・Field・Record・Activity は
  // onDelete: Cascade で落ちる。テスト間の独立性はこれで担保する。
  await db.workspace.deleteMany({});
  await db.user.deleteMany({});
});

afterAll(async () => {
  try {
    await db?.$disconnect();
  } catch {
    /* 後片付けは best-effort */
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

/* --------------------------------- ヘルパ --------------------------------- */

let seq = 0;

async function createUser(): Promise<CurrentUser> {
  seq += 1;
  const workspace = await db.workspace.create({
    data: { name: `テスト商事${seq}`, slug: `test-ws-${seq}` },
  });
  const user = await db.user.create({
    data: {
      email: `owner${seq}@example.co.jp`,
      name: `オーナー${seq}`,
      passwordHash: "x",
    },
  });
  await db.membership.create({
    data: { userId: user.id, workspaceId: workspace.id, role: "owner" },
  });
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      plan: workspace.plan,
      role: "owner",
    },
  };
}

interface FieldSpec {
  key: string;
  name: string;
  type: string;
  options?: unknown;
  config?: unknown;
}

/** ワークスペース内にシート＋項目を用意する（API を通さない素の状態）。 */
async function makeSheet(
  user: CurrentUser,
  name: string,
  slug: string,
  fields: FieldSpec[],
) {
  const collection = await db.collection.create({
    data: { workspaceId: user.workspace.id, name, slug },
  });
  for (const [i, f] of fields.entries()) {
    await db.field.create({
      data: {
        collectionId: collection.id,
        key: f.key,
        name: f.name,
        type: f.type,
        options: f.options === undefined ? undefined : (f.options as object),
        config: f.config === undefined ? undefined : (f.config as object),
        position: i,
      },
    });
  }
  return db.collection.findFirstOrThrow({
    where: { id: collection.id },
    include: { fields: { orderBy: { position: "asc" } } },
  });
}

async function addRecord(collectionId: string, data: Record<string, unknown>) {
  return db.record.create({ data: { collectionId, data: data as object } });
}

async function recordData(id: string): Promise<Record<string, unknown>> {
  const row = await db.record.findFirstOrThrow({ where: { id } });
  return (row.data as Record<string, unknown>) ?? {};
}

function fieldId(
  collection: { fields: Array<{ id: string; key: string }> },
  key: string,
): string {
  const f = collection.fields.find((x) => x.key === key);
  if (!f) throw new Error(`テストの前提が壊れている: ${key} が無い`);
  return f.id;
}

/* ---------------------- P0-3 リンク切れで行が凍らない ---------------------- */

describe("PATCH /api/records/[id] — リンク先が消えた行", () => {
  it("リンク先レコードが削除されていても、無関係なセルは保存できる", async () => {
    const user = await createUser();
    const customers = await makeSheet(user, "顧客", "kokyaku", [
      { key: "name", name: "顧客名", type: "text" },
    ]);
    const customer = await addRecord(customers.id, { name: "山田商店" });
    const deals = await makeSheet(user, "案件", "anken", [
      { key: "title", name: "件名", type: "text" },
      { key: "memo", name: "メモ", type: "text" },
      {
        key: "customer",
        name: "顧客",
        type: "relation",
        config: { targetCollectionId: customers.id, displayFieldKey: "name" },
      },
    ]);
    const deal = await addRecord(deals.id, {
      title: "初回商談",
      memo: "旧メモ",
      customer: [customer.id],
    });

    // リンク先を削除（表示は空欄に落ちる仕様）。
    await db.record.delete({ where: { id: customer.id } });

    const res = await patchRecord(reqWith({ data: { memo: "新メモ" } }), {
      user,
      params: { id: deal.id },
    });

    expectOk(res);
    const stored = await recordData(deal.id);
    expect(stored.memo).toBe("新メモ");
    // 触っていないリンク値はそのまま残る（勝手に消さない）。
    expect(stored.customer).toEqual([customer.id]);
  });

  it("今回書き換えたリンク値が壊れている場合は、これまで通り弾く", async () => {
    const user = await createUser();
    const customers = await makeSheet(user, "顧客", "kokyaku", [
      { key: "name", name: "顧客名", type: "text" },
    ]);
    const deals = await makeSheet(user, "案件", "anken", [
      { key: "title", name: "件名", type: "text" },
      {
        key: "customer",
        name: "顧客",
        type: "relation",
        config: { targetCollectionId: customers.id, displayFieldKey: "name" },
      },
    ]);
    const deal = await addRecord(deals.id, { title: "初回商談" });

    const res = await patchRecord(
      reqWith({ data: { customer: ["cnotexist0000000000000000"] } }),
      { user, params: { id: deal.id } },
    );

    const failure = expectFail(res);
    expect(failure.status).toBe(422);
    expect(failure.error).toContain("顧客");
  });
});

/* ------------------- P1-5 消えた列に書いたら黙って捨てない ------------------ */

describe("存在しない列への書き込み", () => {
  it("PATCH：無くなった列を指定したら成功扱いにせず、列名を伝える", async () => {
    const user = await createUser();
    const sheet = await makeSheet(user, "備品", "bihin", [
      { key: "name", name: "品名", type: "text" },
    ]);
    const row = await addRecord(sheet.id, { name: "机" });

    const res = await patchRecord(
      reqWith({ data: { tanka: 1200 } }), // 別タブで削除済みの列
      { user, params: { id: row.id } },
    );

    const failure = expectFail(res);
    expect(failure.status).toBe(409);
    expect(failure.error).toContain("tanka");
    expect(failure.error).toContain("存在しません");
    // 打ち込んだ内容が消えたうえに「保存済み」になる、が元の症状。
    expect(await recordData(row.id)).toEqual({ name: "机" });
  });

  it("POST：無くなった列を含む新規行も成功扱いにしない", async () => {
    const user = await createUser();
    const sheet = await makeSheet(user, "備品", "bihin", [
      { key: "name", name: "品名", type: "text" },
    ]);

    const res = await createRecord(
      reqWith({ data: { name: "椅子", tanka: 800 } }),
      { user, params: { id: sheet.id } },
    );

    const failure = expectFail(res);
    expect(failure.status).toBe(409);
    expect(failure.error).toContain("tanka");
    expect(await db.record.count({ where: { collectionId: sheet.id } })).toBe(0);
  });

  it("実在する列だけなら通常どおり保存できる", async () => {
    const user = await createUser();
    const sheet = await makeSheet(user, "備品", "bihin", [
      { key: "name", name: "品名", type: "text" },
    ]);
    const res = await createRecord(reqWith({ data: { name: "椅子" } }), {
      user,
      params: { id: sheet.id },
    });
    expectOk(res);
    expect(await db.record.count({ where: { collectionId: sheet.id } })).toBe(1);
  });
});

/* --------------------- P1-6 項目削除：依存チェックと後始末 -------------------- */

describe("DELETE /api/collections/[id]/fields/[fieldId]", () => {
  it("ルックアップ／ロールアップが使っているリンク列は削除できない", async () => {
    const user = await createUser();
    const customers = await makeSheet(user, "顧客", "kokyaku", [
      { key: "name", name: "顧客名", type: "text" },
      { key: "amount", name: "取引額", type: "number" },
    ]);
    const deals = await makeSheet(user, "案件", "anken", [
      { key: "title", name: "件名", type: "text" },
      {
        key: "customer",
        name: "顧客",
        type: "relation",
        config: { targetCollectionId: customers.id, displayFieldKey: "name" },
      },
      {
        key: "customer_name",
        name: "顧客名（参照）",
        type: "lookup",
        config: { via: "customer", target: "name" },
      },
      {
        key: "total",
        name: "取引額合計",
        type: "rollup",
        config: { via: "customer", target: "amount", op: "sum" },
      },
    ]);

    const res = await deleteField(reqWith({}), {
      user,
      params: { id: deals.id, fieldId: fieldId(deals, "customer") },
    });

    const failure = expectFail(res);
    expect(failure.status).toBe(422);
    expect(failure.error).toContain("顧客名（参照）");
    expect(failure.error).toContain("取引額合計");
    // 消えていないこと（消えたら参照側が永久に空欄になる）。
    expect(await db.field.count({ where: { id: fieldId(deals, "customer") } })).toBe(1);
  });

  it("計算式が参照している列は削除できない", async () => {
    const user = await createUser();
    const sales = await makeSheet(user, "売上", "uriage", [
      { key: "sales", name: "売上", type: "number" },
      { key: "cost", name: "原価", type: "number" },
      {
        key: "profit",
        name: "粗利",
        type: "formula",
        config: { expression: "{sales} - {cost}" },
      },
    ]);

    const res = await deleteField(reqWith({}), {
      user,
      params: { id: sales.id, fieldId: fieldId(sales, "cost") },
    });

    const failure = expectFail(res);
    expect(failure.status).toBe(422);
    expect(failure.error).toContain("粗利");
    expect(await db.field.count({ where: { id: fieldId(sales, "cost") } })).toBe(1);
  });

  it("他シートの vlookup が参照している列も削除できない", async () => {
    const user = await createUser();
    const masters = await makeSheet(user, "商品マスタ", "shohin", [
      { key: "code", name: "商品コード", type: "text" },
      { key: "price", name: "単価", type: "number" },
    ]);
    await makeSheet(user, "受注", "juchu", [
      { key: "code", name: "商品コード", type: "text" },
      {
        key: "price",
        name: "単価（マスタ参照）",
        type: "vlookup",
        config: {
          targetCollectionId: masters.id,
          localKey: "code",
          targetKey: "code",
          targetField: "price",
          aggregate: "first",
        },
      },
    ]);

    const res = await deleteField(reqWith({}), {
      user,
      params: { id: masters.id, fieldId: fieldId(masters, "price") },
    });

    const failure = expectFail(res);
    expect(failure.status).toBe(422);
    expect(failure.error).toContain("単価（マスタ参照）");
  });

  it("依存が無ければ削除でき、行データからも値が消える（キー再利用で復活しない）", async () => {
    const user = await createUser();
    const sheet = await makeSheet(user, "経費", "keihi", [
      { key: "name", name: "件名", type: "text" },
      { key: "金額", name: "金額", type: "number" },
    ]);
    const row = await addRecord(sheet.id, { name: "交通費", 金額: 1200 });

    const del = await deleteField(reqWith({}), {
      user,
      params: { id: sheet.id, fieldId: fieldId(sheet, "金額") },
    });
    expectOk(del);
    expect(await recordData(row.id)).toEqual({ name: "交通費" });

    // 同じ名前で作り直すと同じキー（金額）が割り当てられる。以前は行データが
    // 残っていたため、種類の違う列に古い数値がそのまま復活していた。
    const added = expectOk(
      await createField(reqWith({ name: "金額", type: "text" }), {
        user,
        params: { id: sheet.id },
      }),
    );
    expect(added.key).toBe("金額");
    const after = await recordData(row.id);
    expect(after["金額"]).toBeUndefined();
  });
});

/* ------------------- P1-7 種類変更：データと設定を整合させる ------------------ */

describe("PATCH /api/collections/[id]/fields/[fieldId] — 種類の変更", () => {
  it("変換できない既存データがあるときは、件数と実例を挙げて中止する", async () => {
    const user = await createUser();
    const sheet = await makeSheet(user, "在庫", "zaiko", [
      {
        key: "size",
        name: "サイズ",
        type: "select",
        options: [
          { label: "小", value: "s" },
          { label: "大", value: "h" },
        ],
      },
    ]);
    const row = await addRecord(sheet.id, { size: "h" });

    const res = await patchField(reqWith({ type: "number" }), {
      user,
      params: { id: sheet.id, fieldId: fieldId(sheet, "size") },
    });

    const failure = expectFail(res);
    expect(failure.status).toBe(422);
    expect(failure.error).toContain("サイズ");
    expect(failure.error).toContain("h");
    // 種類も中身も変わっていない（"h" が数値列に残る、が元の症状）。
    const field = await db.field.findFirstOrThrow({
      where: { id: fieldId(sheet, "size") },
    });
    expect(field.type).toBe("select");
    expect((await recordData(row.id)).size).toBe("h");
  });

  it("変換できる場合は既存データも新しい種類に揃える", async () => {
    const user = await createUser();
    const sheet = await makeSheet(user, "在庫", "zaiko", [
      { key: "qty", name: "数量", type: "text" },
    ]);
    const row = await addRecord(sheet.id, { qty: "1,200" });

    const res = await patchField(reqWith({ type: "number" }), {
      user,
      params: { id: sheet.id, fieldId: fieldId(sheet, "qty") },
    });

    const data = expectOk(res);
    expect(data.type).toBe("number");
    expect(data.convertedRecordCount).toBe(1);
    expect((await recordData(row.id)).qty).toBe(1200);
  });

  it("リンク列を参照しているルックアップがあるうちは、種類を変えられない", async () => {
    const user = await createUser();
    const customers = await makeSheet(user, "顧客", "kokyaku", [
      { key: "name", name: "顧客名", type: "text" },
    ]);
    const deals = await makeSheet(user, "案件", "anken", [
      {
        key: "customer",
        name: "顧客",
        type: "relation",
        config: { targetCollectionId: customers.id, displayFieldKey: "name" },
      },
      {
        key: "customer_name",
        name: "顧客名（参照）",
        type: "lookup",
        config: { via: "customer", target: "name" },
      },
    ]);

    const res = await patchField(reqWith({ type: "text" }), {
      user,
      params: { id: deals.id, fieldId: fieldId(deals, "customer") },
    });

    const failure = expectFail(res);
    expect(failure.status).toBe(422);
    expect(failure.error).toContain("顧客名（参照）");
  });

  it("relation → text にすると、古いリンク設定が残らない", async () => {
    const user = await createUser();
    const customers = await makeSheet(user, "顧客", "kokyaku", [
      { key: "name", name: "顧客名", type: "text" },
    ]);
    const deals = await makeSheet(user, "案件", "anken", [
      {
        key: "customer",
        name: "顧客",
        type: "relation",
        config: { targetCollectionId: customers.id, displayFieldKey: "name" },
      },
    ]);

    const res = await patchField(reqWith({ name: "顧客", type: "text" }), {
      user,
      params: { id: deals.id, fieldId: fieldId(deals, "customer") },
    });

    expectOk(res);
    const field = await db.field.findFirstOrThrow({
      where: { id: fieldId(deals, "customer") },
    });
    expect(field.type).toBe("text");
    expect(field.config).toBeNull();
  });

  it("select → text では選択肢も残さない", async () => {
    const user = await createUser();
    const sheet = await makeSheet(user, "在庫", "zaiko", [
      {
        key: "size",
        name: "サイズ",
        type: "select",
        options: [{ label: "小", value: "s" }],
      },
    ]);

    expectOk(
      await patchField(reqWith({ type: "text" }), {
        user,
        params: { id: sheet.id, fieldId: fieldId(sheet, "size") },
      }),
    );

    const field = await db.field.findFirstOrThrow({
      where: { id: fieldId(sheet, "size") },
    });
    expect(field.options).toBeNull();
  });

  it("text → relation は、既存の値がリンク先に無ければ中止する", async () => {
    const user = await createUser();
    const customers = await makeSheet(user, "顧客", "kokyaku", [
      { key: "name", name: "顧客名", type: "text" },
    ]);
    const deals = await makeSheet(user, "案件", "anken", [
      { key: "customer", name: "顧客", type: "text" },
    ]);
    const row = await addRecord(deals.id, { customer: "山田商店" });

    const res = await patchField(
      reqWith({
        type: "relation",
        config: { targetCollectionId: customers.id, displayFieldKey: "name" },
      }),
      { user, params: { id: deals.id, fieldId: fieldId(deals, "customer") } },
    );

    const failure = expectFail(res);
    expect(failure.status).toBe(422);
    expect(failure.error).toContain("顧客");
    expect((await recordData(row.id)).customer).toBe("山田商店");
  });
});

/* --------------------- P1-14 シート新規作成時の config 検証 -------------------- */

describe("POST /api/collections — フィールド設定の検証", () => {
  it("他ワークスペースのシートを指すリンク設定は保存できない", async () => {
    const outsider = await createUser();
    const foreign = await makeSheet(outsider, "他社顧客", "hoka", [
      { key: "name", name: "顧客名", type: "text" },
    ]);
    const user = await createUser();

    const res = await createCollection(
      reqWith({
        name: "案件",
        fields: [
          { name: "件名", type: "text" },
          {
            name: "顧客",
            type: "relation",
            config: { targetCollectionId: foreign.id },
          },
        ],
      }),
      { user, params: {} },
    );

    expectFail(res);
    expect(
      await db.collection.count({ where: { workspaceId: user.workspace.id } }),
    ).toBe(0);
  });

  it("構文の通らない計算式は保存できない", async () => {
    const user = await createUser();
    const res = await createCollection(
      reqWith({
        name: "売上",
        fields: [
          { name: "売上", key: "sales", type: "number" },
          {
            name: "粗利",
            type: "formula",
            config: { expression: "{sales} - {nonexistent}" },
          },
        ],
      }),
      { user, params: {} },
    );

    expectFail(res);
    expect(
      await db.collection.count({ where: { workspaceId: user.workspace.id } }),
    ).toBe(0);
  });

  it("正しい設定なら、リンク列とルックアップを一度に作れる", async () => {
    const user = await createUser();
    const customers = await makeSheet(user, "顧客", "kokyaku", [
      { key: "name", name: "顧客名", type: "text" },
    ]);

    const res = await createCollection(
      reqWith({
        name: "案件",
        fields: [
          { name: "件名", key: "title", type: "text" },
          {
            name: "顧客",
            key: "customer",
            type: "relation",
            config: { targetCollectionId: customers.id, displayFieldKey: "name" },
          },
          {
            name: "顧客名（参照）",
            key: "customer_name",
            type: "lookup",
            config: { via: "customer", target: "name" },
          },
        ],
      }),
      { user, params: {} },
    );

    const data = expectOk(res);
    const created = await db.collection.findFirstOrThrow({
      where: { id: String(data.id) },
      include: { fields: true },
    });
    const relation = created.fields.find((f) => f.key === "customer");
    expect((relation?.config as { targetCollectionId?: string } | null)?.targetCollectionId).toBe(
      customers.id,
    );
  });
});
