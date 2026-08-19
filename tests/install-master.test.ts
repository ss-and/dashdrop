/**
 * `installMasterObjects()` の DB 結合テスト — 顧客DB / 人事DB の共有インストーラ。
 *
 * このスイートで唯一、実際の SQLite に書き込む。他のテストは純粋関数のままに
 * したいので、DATABASE_URL はこのファイル専用の使い捨て DB へ差し替え、
 * `prisma db push` でスキーマを流し込んでから `@/lib/db` を **動的 import** する。
 * static import はホイストされてこの代入より先に評価されてしまうため、
 * db に触るモジュールは必ず beforeAll の中で読み込むこと。
 *
 * 検証の主眼は「作られた数」ではなく「リレーションが実際に解決されているか」。
 * 勤怠 30 行が employee 空欄のまま「成功」で返る、というのが実際に起きた壊れ方で、
 * 件数だけを見るテストではまったく検出できなかった。
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HR_OBJECTS, HR_SLUGS } from "@/lib/hr-objects";
import { CRM_OBJECTS, CRM_SLUGS } from "@/lib/crm-objects";
import type { CurrentUser } from "@/lib/auth";
import type { MasterObject } from "@/lib/install-master";

/* ------------------------------- 使い捨て DB ------------------------------ */

const tmpDir = mkdtempSync(join(tmpdir(), "dashdrop-install-master-"));
const dbFile = join(tmpDir, "install-master.db");
// tests/setup.ts が `??=` で file:./test.db を入れているので、上書きは代入で行う。
// 絶対パスにするのは、相対パスが schema.prisma の位置基準に解決されるため。
process.env.DATABASE_URL = `file:${dbFile}`;

let db: typeof import("@/lib/db").db;
let installHr: typeof import("@/lib/install-hr").installHr;
let installCrm: typeof import("@/lib/install-crm").installCrm;
let installMasterObjects: typeof import("@/lib/install-master").installMasterObjects;
let ApiError: typeof import("@/lib/errors").ApiError;

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
  installHr = (await import("@/lib/install-hr")).installHr;
  installCrm = (await import("@/lib/install-crm")).installCrm;
  installMasterObjects = (await import("@/lib/install-master")).installMasterObjects;
  ApiError = (await import("@/lib/errors")).ApiError;
}, 120_000);

afterEach(async () => {
  // Workspace / User を消せば Collection・Field・Record・Activity は
  // onDelete: Cascade で落ちる。テスト間の独立性はこれで担保する。
  await db.workspace.deleteMany({});
  await db.user.deleteMany({});
});

afterAll(async () => {
  // beforeAll が落ちた場合 db は未定義。ここで TypeError を投げると一時DBの
  // 削除まで到達せず、os.tmpdir() にゴミが残る。
  try {
    await db?.$disconnect();
  } catch {
    /* 後片付けは best-effort */
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

/* --------------------------------- ヘルパ --------------------------------- */

let seq = 0;

/** ワークスペース + ユーザー + メンバーシップを作り、CurrentUser を組み立てる。 */
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

/** Prisma の Json 値をオブジェクトとして読む（data / config はどちらも JSON）。 */
function asObject(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

/** relation フィールドの値は「解決済み record id の配列」。未解決なら空配列。 */
function relationIds(data: Record<string, unknown>, key: string): string[] {
  const raw = data[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

async function collectionBySlug(user: CurrentUser, slug: string) {
  return db.collection.findFirstOrThrow({
    where: { workspaceId: user.workspace.id, slug },
    include: { fields: true, records: true },
  });
}

async function slugsOf(user: CurrentUser): Promise<string[]> {
  const rows = await db.collection.findMany({
    where: { workspaceId: user.workspace.id },
    select: { slug: true },
    orderBy: { position: "asc" },
  });
  return rows.map((r) => r.slug);
}

async function countsOf(user: CurrentUser) {
  const workspaceId = user.workspace.id;
  return {
    collections: await db.collection.count({ where: { workspaceId } }),
    fields: await db.field.count({ where: { collection: { workspaceId } } }),
    records: await db.record.count({ where: { collection: { workspaceId } } }),
  };
}

const hrObject = (slug: string) => HR_OBJECTS.find((o) => o.slug === slug)!;
const HR_SAMPLE_TOTAL = HR_OBJECTS.reduce((n, o) => n + o.samples.length, 0);
const CRM_SAMPLE_TOTAL = CRM_OBJECTS.reduce((n, o) => n + o.samples.length, 0);

/** 社員 collection の「氏名 -> record id」表。リレーション解決の答え合わせ用。 */
async function employeeIdByName(user: CurrentUser): Promise<Map<string, string>> {
  const employees = await collectionBySlug(user, "hr-employees");
  return new Map(
    employees.records.map((r) => [String(asObject(r.data).name), r.id]),
  );
}

/* ------------------------- 1. 人事DBの新規インストール ------------------------- */

describe("人事データベースの新規インストール", () => {
  it(
    "5 オブジェクトを作り、58 行のサンプルをリレーション解決済みで投入する",
    async () => {
      const user = await createUser();
      const result = await installHr(user);

      expect(result.created.map((c) => c.slug)).toEqual(HR_SLUGS);
      expect(result.skipped).toEqual([]);
      expect(result.seededRows).toBe(58);
      expect(result.seededRows).toBe(HR_SAMPLE_TOTAL);
      for (const c of result.created) {
        expect(c.id).toMatch(/^c[a-z0-9]+$/);
      }

      expect(await slugsOf(user)).toEqual(HR_SLUGS);

      // 各オブジェクトが宣言どおりの列数・行数で入っていること。
      for (const obj of HR_OBJECTS) {
        const col = await collectionBySlug(user, obj.slug);
        expect(col.name).toBe(obj.name);
        expect(col.icon).toBe(obj.icon);
        expect(col.template).toBe("custom");
        expect(col.fields).toHaveLength(obj.fields.length);
        expect(col.records).toHaveLength(obj.samples.length);
        // 組み込みの行はユーザーが一括削除できるよう sample 印を付ける。
        expect(col.records.every((r) => r.isSampleData)).toBe(true);
        expect(col.records.every((r) => r.createdById === user.id)).toBe(true);
      }

      const departments = await collectionBySlug(user, "hr-departments");
      const employees = await collectionBySlug(user, "hr-employees");
      const attendance = await collectionBySlug(user, "hr-attendance");

      // --- Pass 2: relation の config が実在の collection を指していること ---
      const empRelation = asObject(
        employees.fields.find((f) => f.key === "department")!.config,
      );
      expect(empRelation.targetCollectionId).toBe(departments.id);
      expect(empRelation.displayFieldKey).toBe("name");
      expect(empRelation.multiple).toBe(false);

      const attRelation = asObject(
        attendance.fields.find((f) => f.key === "employee")!.config,
      );
      expect(attRelation.targetCollectionId).toBe(employees.id);

      // lookup / rollup / formula も config が書かれていること（Pass 2 の取りこぼし防止）。
      expect(
        asObject(employees.fields.find((f) => f.key === "departmentCode")!.config),
      ).toEqual({ via: "department", target: "code" });
      const reviews = await collectionBySlug(user, "hr-reviews");
      expect(
        asObject(reviews.fields.find((f) => f.key === "achievementBand")!.config)
          .expression,
      ).toContain("ISBLANK");

      // --- Pass 3: 表示名 -> record id が全行で解決されていること ---
      const deptIdByName = new Map(
        departments.records.map((r) => [String(asObject(r.data).name), r.id]),
      );
      const empSamples = new Map(
        hrObject("hr-employees").samples.map((s) => [String(s.name), s]),
      );
      expect(employees.records).toHaveLength(10);
      for (const row of employees.records) {
        const data = asObject(row.data);
        const ids = relationIds(data, "department");
        expect(ids).toHaveLength(1);
        // 部署名がサンプルどおりの部署行を指していること（id が入っているだけでは不十分）。
        const sample = empSamples.get(String(data.name))!;
        expect(ids[0]).toBe(deptIdByName.get(String(sample.department)));
      }

      const empIdByName = new Map(
        employees.records.map((r) => [String(asObject(r.data).name), r.id]),
      );
      const attSamples = new Map(
        hrObject("hr-attendance").samples.map((s) => [String(s.recordNo), s]),
      );
      expect(attendance.records).toHaveLength(30);
      for (const row of attendance.records) {
        const data = asObject(row.data);
        const ids = relationIds(data, "employee");
        expect(ids).toHaveLength(1);
        const sample = attSamples.get(String(data.recordNo))!;
        expect(ids[0]).toBe(empIdByName.get(String(sample.employee)));
      }
      // 勤怠は 5 名に散っている。全行が同じ 1 名に潰れていないことも見る。
      expect(
        new Set(attendance.records.map((r) => relationIds(asObject(r.data), "employee")[0]))
          .size,
      ).toBe(5);

      // 作成のアクティビティが 1 件だけ記録される。
      const activities = await db.activity.findMany({
        where: { workspaceId: user.workspace.id },
      });
      expect(activities).toHaveLength(1);
      expect(activities[0].type).toBe("collection.created");
      expect(asObject(activities[0].meta).source).toBe("hr");
    },
    30_000,
  );
});

/* ----------------------------- 2. 二重実行の冪等性 ---------------------------- */

describe("同じマスターDBを二度インストールする", () => {
  it(
    "2 回目は全 slug が skipped になり、行も列も増えない",
    async () => {
      const user = await createUser();
      await installHr(user);
      const before = await countsOf(user);

      const again = await installHr(user);
      expect(again.created).toEqual([]);
      expect(again.skipped).toEqual(HR_SLUGS);
      expect(again.seededRows).toBe(0);

      // 同じ slug の collection が 2 つできる／サンプルが二重に入る、という
      // 「ボタンを 2 回押しただけでデータが倍になる」壊れ方を封じる。
      expect(await countsOf(user)).toEqual(before);
      expect(await slugsOf(user)).toEqual(HR_SLUGS);
      // created が空なら activity も増えない。
      expect(
        await db.activity.count({ where: { workspaceId: user.workspace.id } }),
      ).toBe(1);
    },
    30_000,
  );
});

/* --------------------- 3. 一部だけ消して再インストール（回帰） -------------------- */

describe("一部のシートだけ削除してから再インストールする", () => {
  it(
    "再作成した勤怠 30 行が既存の社員行に紐づく",
    async () => {
      // 【回帰】表示名インデックスを「今回作成したオブジェクト」だけから
      // 組み立てていたため、社員シートが既存だと勤怠側の参照先が引けず、
      // 再投入された 30 行すべてが employee 空欄で入っていた。しかも戻り値は
      // seededRows: 30 の「成功」。壊れたことに誰も気づけないのが最悪だった。
      const user = await createUser();
      await installHr(user);
      const employeesBefore = await collectionBySlug(user, "hr-employees");

      await db.collection.deleteMany({
        where: { workspaceId: user.workspace.id, slug: "hr-attendance" },
      });
      expect(
        await db.record.count({
          where: { collection: { workspaceId: user.workspace.id } },
        }),
      ).toBe(HR_SAMPLE_TOTAL - 30);

      const result = await installHr(user);
      expect(result.created.map((c) => c.slug)).toEqual(["hr-attendance"]);
      expect(result.skipped).toEqual(
        HR_SLUGS.filter((s) => s !== "hr-attendance"),
      );
      expect(result.seededRows).toBe(30);

      const attendance = await collectionBySlug(user, "hr-attendance");
      const empIdByName = await employeeIdByName(user);
      const attSamples = new Map(
        hrObject("hr-attendance").samples.map((s) => [String(s.recordNo), s]),
      );

      expect(attendance.records).toHaveLength(30);
      for (const row of attendance.records) {
        const data = asObject(row.data);
        const ids = relationIds(data, "employee");
        // ここが空配列になるのがバグの症状。
        expect(ids).toHaveLength(1);
        const sample = attSamples.get(String(data.recordNo))!;
        expect(ids[0]).toBe(empIdByName.get(String(sample.employee)));
      }
      expect(
        new Set(attendance.records.map((r) => relationIds(asObject(r.data), "employee")[0]))
          .size,
      ).toBe(5);

      // 参照先は「作り直された社員」ではなく、元からあった社員行そのもの。
      const employeesAfter = await collectionBySlug(user, "hr-employees");
      expect(employeesAfter.id).toBe(employeesBefore.id);
      expect(employeesAfter.records).toHaveLength(10);
      expect(new Set(employeesAfter.records.map((r) => r.id))).toEqual(
        new Set(employeesBefore.records.map((r) => r.id)),
      );

      // 消していないシートは一切増えていない。
      expect(await countsOf(user)).toEqual({
        collections: 5,
        fields: HR_OBJECTS.reduce((n, o) => n + o.fields.length, 0),
        records: HR_SAMPLE_TOTAL,
      });

      // relation の config も既存の社員 collection を指し直していること。
      expect(
        asObject(attendance.fields.find((f) => f.key === "employee")!.config)
          .targetCollectionId,
      ).toBe(employeesAfter.id);
    },
    30_000,
  );
});

/* -------------------------- 4. slug 衝突（回帰） --------------------------- */

describe("ユーザーのシートが slug で衝突している", () => {
  it(
    "無関係なシートに乗っ取られず 409 で拒否し、他のオブジェクトも作らない",
    async () => {
      // 【回帰】slug が一致するだけで「インストール済み」と見なしていたため、
      // たまたま hr-employees に slug 化される個人のメモ表があると、そこを
      // 社員シートとして扱い、勤怠・休暇申請・評価のリレーションを全部その
      // 他人の表に向けてしまっていた。人事DBとメモの両方が壊れる。
      const user = await createUser();
      const stranger = await db.collection.create({
        data: {
          workspaceId: user.workspace.id,
          name: "個人メモ",
          slug: "hr-employees",
          fields: {
            create: [
              { key: "title", name: "件名", type: "text", position: 0 },
              { key: "memo", name: "内容", type: "longtext", position: 1 },
              { key: "done", name: "済", type: "checkbox", position: 2 },
            ],
          },
        },
      });

      const err = await installHr(user).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ApiError);
      const apiError = err as InstanceType<typeof ApiError>;
      expect(apiError.status).toBe(409);
      // 利用者が直せるよう、衝突した相手のシート名と人事DB側の名前を両方出す。
      expect(apiError.message).toContain("個人メモ");
      expect(apiError.message).toContain("社員");
      expect(apiError.message).toContain("人事データベース");

      // 他の 4 オブジェクトは作られない（判定はインストール開始前に行われる）。
      expect(await slugsOf(user)).toEqual(["hr-employees"]);
      expect(await countsOf(user)).toEqual({
        collections: 1,
        fields: 3,
        records: 0,
      });

      // 他人のシートに config を書き込んでいないこと。
      const after = await db.collection.findUniqueOrThrow({
        where: { id: stranger.id },
        include: { fields: true },
      });
      expect(after.name).toBe("個人メモ");
      expect(after.fields.map((f) => f.key).sort()).toEqual([
        "done",
        "memo",
        "title",
      ]);
      expect(after.fields.every((f) => f.config === null)).toBe(true);
      expect(await db.activity.count({ where: { workspaceId: user.workspace.id } })).toBe(0);
    },
    30_000,
  );

  it(
    "列を何本か消した過去のインストールは「本物」と判定して skip する",
    async () => {
      // 衝突判定は列の一致率のヒューリスティック。厳しくしすぎると、
      // 利用者が不要な列を消しただけで自分の人事DBを他人扱いされてしまう。
      const user = await createUser();
      await installHr(user);
      const employees = await collectionBySlug(user, "hr-employees");
      await db.field.deleteMany({
        where: {
          collectionId: employees.id,
          key: { in: ["birthday", "baseSalary", "note", "phone", "office"] },
        },
      });

      const result = await installHr(user);
      expect(result.created).toEqual([]);
      expect(result.skipped).toEqual(HR_SLUGS);
      expect(result.seededRows).toBe(0);
      expect(await slugsOf(user)).toEqual(HR_SLUGS);
    },
    30_000,
  );
});

/* ------------------------- 5. 複数値リレーションの解決 ------------------------- */

describe("multiple: true のリレーション", () => {
  it(
    "承認者 1 名のサンプルが 1 要素の配列になる",
    async () => {
      const user = await createUser();
      await installHr(user);
      const leave = await collectionBySlug(user, "hr-leave-requests");
      const empIdByName = await employeeIdByName(user);

      expect(
        asObject(leave.fields.find((f) => f.key === "approvers")!.config).multiple,
      ).toBe(true);
      expect(
        asObject(leave.fields.find((f) => f.key === "employee")!.config).multiple,
      ).toBe(false);

      const leaveSamples = new Map(
        hrObject("hr-leave-requests").samples.map((s) => [String(s.number), s]),
      );
      for (const row of leave.records) {
        const data = asObject(row.data);
        const sample = leaveSamples.get(String(data.number))!;
        const ids = relationIds(data, "approvers");
        // 単一値でも multiple なら配列 1 要素。スカラーで入ると読み側が壊れる。
        expect(ids).toEqual([empIdByName.get(String(sample.approvers))]);
        expect(relationIds(data, "employee")).toEqual([
          empIdByName.get(String(sample.employee)),
        ]);
      }
    },
    30_000,
  );

  it(
    "「藤井 理恵、佐々木 隆」のような複数指定が両方の id に解決される",
    async () => {
      // 出荷サンプルは承認者が常に 1 名なので、区切り文字の分解は定義を
      // その場で組み立てて確かめる。ここが落ちると承認者が 0 件になり、
      // 「承認者数」の rollup まで巻き添えで 0 になる。
      const user = await createUser();
      const people: MasterObject = {
        slug: "test-people",
        name: "人",
        description: "",
        icon: "table",
        color: "khaki",
        fields: [{ key: "name", name: "氏名", type: "text", required: true }],
        samples: [{ name: "藤井 理恵" }, { name: "佐々木 隆" }, { name: "石井 光" }],
      };
      const approvals: MasterObject = {
        slug: "test-approvals",
        name: "承認",
        description: "",
        icon: "table",
        color: "khaki",
        fields: [
          { key: "number", name: "番号", type: "text", required: true },
          {
            key: "approvers",
            name: "承認者",
            type: "relation",
            relation: { to: "test-people", multiple: true, displayFieldKey: "name" },
          },
        ],
        samples: [
          { number: "A-1", approvers: "藤井 理恵、佐々木 隆" },
          { number: "A-2", approvers: "石井 光, 藤井 理恵" },
          { number: "A-3", approvers: "藤井 理恵" },
          { number: "A-4", approvers: "存在しない 人" },
        ],
      };

      const result = await installMasterObjects(user, [people, approvals], {
        source: "test",
        label: "テストDB",
      });
      expect(result.seededRows).toBe(7);

      const peopleCol = await collectionBySlug(user, "test-people");
      const idByName = new Map(
        peopleCol.records.map((r) => [String(asObject(r.data).name), r.id]),
      );
      const approvalsCol = await collectionBySlug(user, "test-approvals");
      const byNumber = new Map(
        approvalsCol.records.map((r) => [String(asObject(r.data).number), asObject(r.data)]),
      );

      // 読点区切り: 2 件とも解決され、順序も宣言どおり。
      expect(relationIds(byNumber.get("A-1")!, "approvers")).toEqual([
        idByName.get("藤井 理恵"),
        idByName.get("佐々木 隆"),
      ]);
      // 半角カンマ + 空白も同じ区切りとして扱う。
      expect(relationIds(byNumber.get("A-2")!, "approvers")).toEqual([
        idByName.get("石井 光"),
        idByName.get("藤井 理恵"),
      ]);
      expect(relationIds(byNumber.get("A-3")!, "approvers")).toEqual([
        idByName.get("藤井 理恵"),
      ]);
      // 引けない名前は列そのものを書かない（空配列を入れて「0 件承認」に見せない）。
      expect(byNumber.get("A-4")).not.toHaveProperty("approvers");
    },
    30_000,
  );
});

/* ----------------------------- 6. 失敗時のロールバック ----------------------------- */

describe("インストールの途中で失敗したとき", () => {
  it(
    "行の投入中に落ちても collection / field / record が残らない",
    async () => {
      const user = await createUser();
      // Pass 3（行の投入）の途中で落とす。ここまでに collection と field は
      // 作成済み、record も数件入っている状態なので、片付け漏れがあれば
      // 「列だけある空のシートが 5 枚」という中途半端な残骸が残る。
      const original = db.record.create;
      let calls = 0;
      // Prisma のデリゲートはジェネリックなので、差し替え用の関数はシグネチャを
      // そのまま満たせない。呼び出しは素通しするだけなので unknown 経由で被せる。
      const patched = ((args: Parameters<typeof original>[0]) => {
        calls += 1;
        if (calls > 5) return Promise.reject(new Error("boom"));
        return original(args);
      }) as unknown as typeof original;
      Object.defineProperty(db.record, "create", {
        value: patched,
        configurable: true,
        writable: true,
      });
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      let err: unknown = null;
      try {
        await installHr(user);
      } catch (e) {
        err = e;
      } finally {
        Object.defineProperty(db.record, "create", {
          value: original,
          configurable: true,
          writable: true,
        });
        consoleError.mockRestore();
      }

      expect(err).toBeInstanceOf(ApiError);
      const apiError = err as InstanceType<typeof ApiError>;
      expect(apiError.status).toBe(500);
      // 内部エラーは利用者向けの日本語に丸めて出す。
      expect(apiError.message).toBe("人事データベースの作成に失敗しました");
      expect(calls).toBeGreaterThan(5);

      expect(await countsOf(user)).toEqual({
        collections: 0,
        fields: 0,
        records: 0,
      });
    },
    30_000,
  );

  it(
    "オブジェクト作成中に落ちても、先に作られた分まで巻き戻す",
    async () => {
      const user = await createUser();
      const first: MasterObject = {
        slug: "test-dup",
        name: "先に作られる方",
        description: "",
        icon: "table",
        color: "khaki",
        fields: [{ key: "name", name: "名前", type: "text", required: true }],
        samples: [{ name: "x" }],
      };
      // slug は workspace 内で一意なので、2 つ目の create が必ず失敗する。
      const second: MasterObject = { ...first, name: "後から衝突する方" };
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      const err = await installMasterObjects(user, [first, second], {
        source: "test",
        label: "テストDB",
      }).then(
        () => null,
        (e: unknown) => e,
      );
      consoleError.mockRestore();

      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).message).toBe(
        "テストDBの作成に失敗しました",
      );
      // 1 枚目は作成に成功していたので、消し忘れるとここが 1 になる。
      expect(await countsOf(user)).toEqual({
        collections: 0,
        fields: 0,
        records: 0,
      });
    },
    30_000,
  );
});

/* ------------------------- 7. 顧客DB / 両方の同居 ------------------------- */

describe("顧客データベース", () => {
  it(
    "CRM 5 オブジェクトを作り、サンプルのリレーションを解決する",
    async () => {
      const user = await createUser();
      const result = await installCrm(user);

      expect(result.created.map((c) => c.slug)).toEqual(CRM_SLUGS);
      expect(result.skipped).toEqual([]);
      expect(result.seededRows).toBe(CRM_SAMPLE_TOTAL);

      for (const obj of CRM_OBJECTS) {
        const col = await collectionBySlug(user, obj.slug);
        expect(col.fields).toHaveLength(obj.fields.length);
        expect(col.records).toHaveLength(obj.samples.length);
      }

      // 商談 -> 顧客 が実 id に解決されていること（CRM 側も同じ 3 パスを通る）。
      const accounts = await collectionBySlug(user, "accounts");
      const accountIdByName = new Map(
        accounts.records.map((r) => [String(asObject(r.data).name), r.id]),
      );
      const opportunities = await collectionBySlug(user, "opportunities");
      const oppSamples = new Map(
        CRM_OBJECTS.find((o) => o.slug === "opportunities")!.samples.map((s) => [
          String(s.name),
          s,
        ]),
      );
      for (const row of opportunities.records) {
        const data = asObject(row.data);
        const sample = oppSamples.get(String(data.name))!;
        expect(relationIds(data, "account")).toEqual([
          accountIdByName.get(String(sample.account)),
        ]);
      }
    },
    30_000,
  );

  it(
    "顧客DBと人事DBは同じワークスペースに同居できる",
    async () => {
      // 10 枚とも slug が違うので衝突しない。片方を入れた後にもう片方を
      // 入れると position の採番や既存 collection の走査が絡むため、
      // 「あとから入れた方だけ壊れる」ことがないかをここで見る。
      const user = await createUser();
      await installCrm(user);
      const hr = await installHr(user);

      expect(hr.created.map((c) => c.slug)).toEqual(HR_SLUGS);
      expect(hr.skipped).toEqual([]);
      expect(hr.seededRows).toBe(HR_SAMPLE_TOTAL);
      expect(await slugsOf(user)).toEqual([...CRM_SLUGS, ...HR_SLUGS]);

      const counts = await countsOf(user);
      expect(counts.collections).toBe(10);
      expect(counts.records).toBe(CRM_SAMPLE_TOTAL + HR_SAMPLE_TOTAL);
      for (const obj of [...CRM_OBJECTS, ...HR_OBJECTS]) {
        const col = await collectionBySlug(user, obj.slug);
        expect(col.records).toHaveLength(obj.samples.length);
      }

      // あとから入れた人事DBのリレーションが、CRM の collection ではなく
      // 自分の社員シートを指していること。
      const employees = await collectionBySlug(user, "hr-employees");
      const attendance = await collectionBySlug(user, "hr-attendance");
      expect(
        asObject(attendance.fields.find((f) => f.key === "employee")!.config)
          .targetCollectionId,
      ).toBe(employees.id);
      const empIds = new Set(employees.records.map((r) => r.id));
      for (const row of attendance.records) {
        const ids = relationIds(asObject(row.data), "employee");
        expect(ids).toHaveLength(1);
        expect(empIds.has(ids[0])).toBe(true);
      }
    },
    45_000,
  );
});

/* ---------------- 8. 親シートを消してから再インストールする ---------------- */

describe("リレーションの参照先シートを削除してから再インストールする", () => {
  it(
    "子シートの参照先を貼り直し、選択画面が壊れたままにならない",
    async () => {
      // 【回帰】pass 2 は「これから作る分」しか config を書かなかったため、
      // 親（社員）だけ削除して作り直すと、子（勤怠・休暇申請・評価）の
      // targetCollectionId が消えた id を指したままになっていた。関連の列が
      // 黙って空欄になるうえ、リンクの選択画面が 404 になり手作業でも直せない。
      const user = await createUser();
      await installHr(user);

      const employees = await collectionBySlug(user, "hr-employees");
      const attendance = await collectionBySlug(user, "hr-attendance");
      const before = (
        attendance.fields.find((f) => f.key === "employee")!.config as {
          targetCollectionId: string;
        }
      ).targetCollectionId;
      expect(before).toBe(employees.id);

      await db.collection.delete({ where: { id: employees.id } });
      const result = await installHr(user);

      expect(result.created.map((c) => c.slug)).toEqual(["hr-employees"]);
      expect(result.repairedRelations).toBeGreaterThan(0);

      const rebuilt = await collectionBySlug(user, "hr-employees");
      expect(rebuilt.id).not.toBe(employees.id);

      // 子3つすべてが新しい社員シートを指していること。
      for (const [slug, key] of [
        ["hr-attendance", "employee"],
        ["hr-leave-requests", "employee"],
        ["hr-reviews", "employee"],
      ] as const) {
        const child = await collectionBySlug(user, slug);
        const cfg = child.fields.find((f) => f.key === key)!.config as {
          targetCollectionId: string;
        };
        expect(cfg.targetCollectionId, slug).toBe(rebuilt.id);
      }

      // 承認者（multiple: true）も同じく貼り直される。
      const leave = await collectionBySlug(user, "hr-leave-requests");
      const approvers = leave.fields.find((f) => f.key === "approvers")!
        .config as { targetCollectionId: string; multiple: boolean };
      expect(approvers.targetCollectionId).toBe(rebuilt.id);
      expect(approvers.multiple).toBe(true);
    },
    30_000,
  );

  it(
    "参照先が生きているときは config を書き換えない",
    async () => {
      const user = await createUser();
      await installHr(user);
      const before = await collectionBySlug(user, "hr-attendance");
      const beforeCfg = before.fields.find((f) => f.key === "employee")!.config;

      const result = await installHr(user);
      expect(result.repairedRelations).toBe(0);

      const after = await collectionBySlug(user, "hr-attendance");
      expect(after.fields.find((f) => f.key === "employee")!.config).toEqual(
        beforeCfg,
      );
    },
    30_000,
  );
});

/* ------------- 9. 列を削られた本物のシートを拒否しないこと ------------- */

describe("列を削った本物のマスターシート", () => {
  it(
    "主キーの列を消しても、自分が書いた config があれば再インストールを拒否しない",
    async () => {
      // 【回帰】衝突の判定が「主キー + 列の半数」だけだったため、
      // 「勤怠番号」「申請番号」のような“要らない列”に見えるものを消すと
      // 自分のシートを他人のものと誤判定し、409 で永久に再インストール
      // できなくなっていた（slug は改名では変えられないので回復不能）。
      const user = await createUser();
      await installHr(user);

      const attendance = await collectionBySlug(user, "hr-attendance");
      const recordNo = attendance.fields.find((f) => f.key === "recordNo")!;
      await db.field.delete({ where: { id: recordNo.id } });

      const result = await installHr(user);
      expect(result.created).toEqual([]);
      expect(result.skipped).toContain("hr-attendance");
    },
    30_000,
  );
});

/* --------- 10. 英語名のユーザーシートが CRM の slug に当たっている --------- */

describe("ユーザー自身のリンク列を持つ、slug が衝突したシート", () => {
  it(
    "リンク先を書き換えず、409 で止まる",
    async () => {
      // 【回帰】衝突判定の「config が空でないこと」が弱すぎたため、
      // ユーザーが Invoices というシートに「Account」というリンク列を足して
      // いるだけで「自分のシートだ」と誤認し、そのうえ貼り直しの処理が
      // リンク先を新しい CRM の顧客シートへ**上書き**していた。保存済みの
      // id が全部よそのシートのものになり、値が全滅したうえ元に戻せない。
      // 安全な 409 を、取り返しのつかないデータ破壊に変えてしまっていた。
      const user = await createUser();

      const ownAccounts = await db.collection.create({
        data: {
          workspaceId: user.workspace.id,
          name: "取引先マスタ",
          slug: "torihikisaki",
          fields: {
            create: [{ key: "name", name: "会社名", type: "text", position: 0 }],
          },
        },
      });
      const row = await db.record.create({
        data: {
          collectionId: ownAccounts.id,
          createdById: user.id,
          data: { name: "株式会社サンプル" },
        },
      });

      // 取り込んだ「Invoices」シート。ユーザーが自分でリンク列を足している。
      const invoices = await db.collection.create({
        data: {
          workspaceId: user.workspace.id,
          name: "Invoices",
          slug: "invoices",
          fields: {
            create: [
              { key: "title", name: "件名", type: "text", position: 0 },
              {
                key: "account",
                name: "Account",
                type: "relation",
                position: 1,
                config: { targetCollectionId: ownAccounts.id },
              },
            ],
          },
        },
      });
      await db.record.create({
        data: {
          collectionId: invoices.id,
          createdById: user.id,
          data: { title: "7月請求", account: [row.id] },
        },
      });

      const err = await installCrm(user).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(409);

      // リンク先が書き換えられていないこと（これが本命）。
      const after = await collectionBySlug(user, "invoices");
      const cfg = after.fields.find((f) => f.key === "account")!.config as {
        targetCollectionId: string;
      };
      expect(cfg.targetCollectionId).toBe(ownAccounts.id);
      expect(after.records[0].data).toEqual({
        title: "7月請求",
        account: [row.id],
      });

      // 他の CRM オブジェクトも作られていないこと。
      const slugs = await slugsOf(user);
      expect(slugs.sort()).toEqual(["invoices", "torihikisaki"]);
    },
    30_000,
  );

  it(
    "本物のインストールは、リンク先がマスターのシートなので通る",
    async () => {
      const user = await createUser();
      await installCrm(user);
      // 主キーの列を消しても、config がマスターを指しているので自分のものと分かる。
      const contacts = await collectionBySlug(user, "contacts");
      const primary = contacts.fields.find((f) => f.key === "name");
      if (primary) await db.field.delete({ where: { id: primary.id } });

      const result = await installCrm(user);
      expect(result.created).toEqual([]);
      expect(result.skipped).toContain("contacts");
    },
    30_000,
  );
});
