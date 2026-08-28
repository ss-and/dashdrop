/**
 * 取り込みの行書き込み（createMany）の DB 結合テスト。
 *
 * 【なぜモックではなく本物の DB なのか】
 * 取り込みのテストはほぼ全部 Prisma をモックしている（import-mapping.test.ts）。
 * そのため「db.record.createMany に何を渡したか」は見えても、
 * **その呼び出しが実際に通るか**は一度も確かめられていない。行の書き込みを
 * 500件ぶんの `create` から `createMany` に変えたのはまさにここの話なので、
 * モックだけでは「本番で初めて落ちる」変更になってしまう。
 *
 * 使い捨ての SQLite に `prisma db push` してから本物のルートを叩く
 * （records-api.test.ts / install-master.test.ts と同じ作法）。開発は SQLite・
 * 本番は PostgreSQL という構成なので、少なくとも SQLite 側は毎回ここで通る。
 *
 * 固定したい契約:
 *   1. createMany で本当に行が入る（Prisma / SQLite が受け付ける）
 *   2. 行数・中身・順序が、1行ずつ書いていたときと変わらない
 *   3. バッチ境界（BATCH_SIZE）をまたいでも 1 と 2 が崩れない
 *   4. 失敗したら Collection ごと消える＝行は1件も残らない（all-or-nothing）
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CurrentUser } from "@/lib/auth";
import type { DashboardTemplate } from "@/lib/widgets";

/* ------------------------------- 使い捨て DB ------------------------------ */

const tmpDir = mkdtempSync(join(tmpdir(), "dashdrop-import-createmany-"));
const dbFile = join(tmpDir, "import-createmany.db");
// tests/setup.ts が `??=` で file:./test.db を入れているので、上書きは代入で行う。
process.env.DATABASE_URL = `file:${dbFile}`;

/* --------------------------- ルートを直接叩く土台 -------------------------- */

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
  };
});

type RouteResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; status: number };

type FakeForm = { get: (key: string) => unknown };
type ImportRoute = (
  req: { formData: () => Promise<FakeForm> },
  ctx: { user: CurrentUser; params: Record<string, string> },
) => Promise<RouteResult>;

let db: typeof import("@/lib/db").db;
let importRoute: ImportRoute;
let applyTemplate: typeof import("@/lib/apply-template").applyTemplate;
/** ルート側が実際に使っているバッチサイズ。テストの行数はこれを基準に決める。 */
let batchSize: number;

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
  importRoute = (await import("@/app/api/import/route"))
    .POST as unknown as ImportRoute;
  applyTemplate = (await import("@/lib/apply-template")).applyTemplate;

  // BATCH_SIZE はルートの内部定数。ソースから読み取り、値を変えても
  // 「バッチ境界をまたぐ」テストが意味を失わないようにする。
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile("src/app/api/import/route.ts", "utf-8"),
  );
  batchSize = Number(/const BATCH_SIZE = (\d+);/.exec(src)?.[1]);
  expect(Number.isFinite(batchSize)).toBe(true);
}, 180_000);

afterEach(async () => {
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
    emailVerified: true,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      plan: workspace.plan,
      role: "owner",
      aiEnabled: false,
    },
  };
}

/**
 * CSV を1つだけ持つ multipart フォームの代わり。
 *
 * 列の対応づけ（sheets）は必ず明示する。省略すると型は推定任せになり、
 * 「金額の列に文字が混じっていたら number にはならない」といった推定の都合が
 * このテストの前提を静かに変えてしまう。ここで見たいのは書き込みの方。
 */
function csvReq(csv: string, sheets?: unknown, fileName = "売上台帳.csv") {
  const bytes = new TextEncoder().encode(csv);
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const entries: Record<string, unknown> = {
    file: { name: fileName, size: ab.byteLength, arrayBuffer: async () => ab },
  };
  if (sheets !== undefined) entries.sheets = JSON.stringify(sheets);
  return {
    formData: async () => ({ get: (key: string) => entries[key] ?? null }),
  };
}

/** 見出し3列ぶんの、画面が既定で送る形の対応づけ。 */
function ledgerSheets() {
  return [
    {
      sheetName: "",
      collectionName: "売上台帳",
      fields: [
        { name: "得意先", key: "tokuisaki", type: "text", sourceHeader: "得意先" },
        { name: "金額", key: "kingaku", type: "number", sourceHeader: "金額" },
        { name: "受注日", key: "juchubi", type: "date", sourceHeader: "受注日" },
      ],
    },
  ];
}

function expectOk(res: RouteResult): Record<string, unknown> {
  if (!res.ok) throw new Error(`成功するはずが失敗した: ${res.error}`);
  return res.data;
}

/** 見出し1行＋`rows` 行の CSV。1行ごとに値が違うので、欠けや重複が見える。 */
function ledgerCsv(rows: number): string {
  const lines = ["得意先,金額,受注日"];
  for (let i = 1; i <= rows; i++) {
    lines.push(`得意先${i},${i * 100},2024-01-01`);
  }
  return `${lines.join("\n")}\n`;
}

/** 取り込まれた行を、入れた順（createdAt → id）で読み戻す。 */
async function importedRows(
  collectionId: string,
): Promise<Array<Record<string, unknown>>> {
  const records = await db.record.findMany({
    where: { collectionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { data: true },
  });
  return records.map((r) => (r.data as Record<string, unknown>) ?? {});
}

/* --------------------------------- テスト -------------------------------- */

describe("createMany での行書き込み — 本物の DB を通した POST /api/import", () => {
  it("createMany が SQLite で実際に通り、全行が入る", async () => {
    // モックでは絶対に検出できない種類の失敗（Prisma / SQLite が createMany を
    // 受け付けない）を、ここで一度だけ本物に確かめさせる。
    const user = await createUser();

    const res = await importRoute(csvReq(ledgerCsv(3), ledgerSheets()), { user, params: {} });
    const data = expectOk(res);

    expect(data.imported).toBe(3);
    const rows = await importedRows(data.collectionId as string);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ tokuisaki: "得意先1", kingaku: 100 });
    expect(rows[2]).toMatchObject({ tokuisaki: "得意先3", kingaku: 300 });
  });

  it("id は Prisma に採番させる（cuid の既定値／重複しない）", async () => {
    // createMany に id を渡す形にすると、SQLite と PostgreSQL で採番の癖が
    // 分かれる。渡していないことを、実際に振られた値で確かめる。
    const user = await createUser();

    const data = expectOk(
      await importRoute(csvReq(ledgerCsv(5), ledgerSheets()), {
        user,
        params: {},
      }),
    );
    const ids = (
      await db.record.findMany({
        where: { collectionId: data.collectionId as string },
        select: { id: true },
      })
    ).map((r) => r.id);

    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) expect(id.length).toBeGreaterThan(10);
  });

  it("バッチ境界をまたいでも、行数・中身・順序が変わらない", async () => {
    // BATCH_SIZE + 1 行。2回目の createMany に1行だけ残る形にして、
    // 「最後のバッチが落ちる」「境界で1行重複する」を検出できるようにする。
    const user = await createUser();
    const rowCount = batchSize + 1;

    const data = expectOk(
      await importRoute(csvReq(ledgerCsv(rowCount), ledgerSheets()), {
        user,
        params: {},
      }),
    );

    expect(data.imported).toBe(rowCount);
    const rows = await importedRows(data.collectionId as string);
    expect(rows).toHaveLength(rowCount);
    // 先頭・境界の前後・末尾。ここが1つでもずれたら並びが壊れている。
    expect(rows[0].tokuisaki).toBe("得意先1");
    expect(rows[batchSize - 1].tokuisaki).toBe(`得意先${batchSize}`);
    expect(rows[batchSize].tokuisaki).toBe(`得意先${batchSize + 1}`);
    // 取りこぼしも重複も無い。
    expect(new Set(rows.map((r) => r.tokuisaki)).size).toBe(rowCount);
  }, 60_000);

  it("型に合わないセルは空欄として入り、行そのものは落ちない", async () => {
    // 1行ずつの create から createMany に変えても、coerceValue の結果
    // （合わないセルは null にして skipped に数える）は変わらないこと。
    const user = await createUser();
    const csv = "得意先,金額\nA社,1000\nB社,千円\n";
    const sheets = [
      {
        sheetName: "",
        fields: [
          { name: "得意先", key: "tokuisaki", type: "text", sourceHeader: "得意先" },
          { name: "金額", key: "kingaku", type: "number", sourceHeader: "金額" },
        ],
      },
    ];

    const data = expectOk(
      await importRoute(csvReq(csv, sheets), { user, params: {} }),
    );

    expect(data.imported).toBe(2);
    expect(data.skipped).toBe(1);
    const rows = await importedRows(data.collectionId as string);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ tokuisaki: "B社", kingaku: null });
  });

  it("書き込みの途中で失敗したら、行は1件も残らない", async () => {
    /*
     * all-or-nothing。createMany はバッチ単位でしかまとまらないので、
     * 「1バッチ目は入ったが2バッチ目で落ちた」ときに前半が残らないことを、
     * 本物の DB で確かめる（巻き戻しの単位は Collection ごと削除＝
     * Record は cascade で消える、という設計そのものの検証）。
     */
    const user = await createUser();
    const rowCount = batchSize + 1;

    let calls = 0;
    /*
     * 差し替えは手で戻す。`vi.spyOn(...).mockRestore()` は使わない——
     * Prisma のモデルは動的なプロキシで、restore すると `createMany` が
     * undefined になり、**この後に走るテストが道連れで落ちる**（実際に
     * applyTemplate のテストが「createMany is not a function」で落ちた）。
     *
     * 中身は本物に委ねるので、型は署名だけ合わせる（Prisma の戻り値は
     * PrismaPromise なので、素の async 関数では合わない）。
     */
    const original = db.record.createMany;
    const real = original.bind(db.record);
    db.record.createMany = ((args: Parameters<typeof real>[0]) => {
      calls += 1;
      if (calls > 1) return Promise.reject(new Error("db is gone"));
      return real(args);
    }) as typeof db.record.createMany;

    try {
      const res = await importRoute(csvReq(ledgerCsv(rowCount), ledgerSheets()), {
        user,
        params: {},
      });
      expect(res.ok).toBe(false);
      // 1バッチ目は本当に書き込まれている（＝巻き戻しが効いたことの証明になる）。
      expect(calls).toBe(2);
    } finally {
      db.record.createMany = original;
    }

    expect(await db.record.count({})).toBe(0);
    expect(await db.collection.count({})).toBe(0);
    // 中身のない空のファイルも残さない。
    expect(await db.workbook.count({})).toBe(0);
  }, 60_000);
});

describe("createMany での見本データ — applyTemplate", () => {
  /*
   * テンプレート適用の見本データも 200件ぶんの `create` を1トランザクションに
   * 詰める形だった。ここを createMany に変えたが、呼び出し元のテストが1つも
   * 無く（applyTemplate を叩くテストが存在しなかった）、モックでは
   * 「その createMany が通るか」を誰も確かめられない。
   *
   * 特に `createdAt` を渡し続けていることが重要。既定の now() に落ちると
   * 見本データの日付が全部「今」になり、折れ線が1点に潰れる——グラフは
   * 描画されるので、エラーにもならないまま見本だけが無意味になる。
   */
  const template: DashboardTemplate = {
    key: "test-uriage",
    category: "sales",
    name: "売上ダッシュボード",
    description: "テスト用",
    icon: "dashboard",
    color: "khaki",
    collections: [
      {
        name: "受注",
        slug: "juchu",
        icon: "table",
        color: "khaki",
        sampleRows: 120,
        fields: [
          { key: "tokuisaki", name: "得意先", type: "text" },
          { key: "kingaku", name: "金額", type: "number" },
        ],
      },
    ],
    widgets: [
      {
        id: "w1",
        type: "kpi",
        title: "売上合計",
        collection: "juchu",
        measure: { kind: "sum", field: "kingaku" },
      },
    ],
  } as DashboardTemplate;

  it("見本データが createMany で入り、createdAt が今日に潰れない", async () => {
    const user = await createUser();

    const result = await applyTemplate(user, template, { withSampleData: true });

    expect(result.seededRows).toBe(120);
    const rows = await db.record.findMany({
      where: { collectionId: result.collections[0].id },
      select: { createdAt: true, isSampleData: true },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(120);
    // 見本データとしての印が全行に付いていること（一括削除の対象になる）。
    expect(rows.every((r) => r.isSampleData)).toBe(true);
    // 日付が散らばっていること。createdAt を渡し忘れると全行 now() になり、
    // 先頭と末尾の差が 0 に潰れる。
    const spreadMs =
      rows[rows.length - 1].createdAt.getTime() - rows[0].createdAt.getTime();
    expect(spreadMs).toBeGreaterThan(24 * 60 * 60 * 1000);
  }, 60_000);
});
