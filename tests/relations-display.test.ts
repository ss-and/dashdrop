/**
 * ルックアップ列の「表示」まわりの回帰テスト。
 *
 * 実際に起きていた不具合：リンク先の select / multiselect を引くルックアップが、
 * 保存値のコード（"parttime"）をそのまま画面に出していた（社員シート自身は
 * 「パート・アルバイト」と正しく出ているのに、休暇申請の雇用形態だけコード）。
 *
 * 直し方の肝は「computed の値は生のまま」。computed[key] はダッシュボードの集計
 * （src/lib/aggregate.ts）や保存済みウィジェットのフィルタが読むので、ここを
 * ラベルに差し替えると、"parttime" と比較している既存のフィルタが黙って壊れ、
 * 直接の select 列（データは生の値・ラベルは表示時）とも不整合になる。
 * そこで relationLabels と同じ「生の値 → ラベル」の副次チャネル lookupLabels を
 * 足し、画面側が表示の直前にだけ当てる。
 *
 * このスイートは実データに近いところを見たいので、使い捨ての SQLite に
 * スキーマを流し込んで resolveCollectionRecords をそのまま動かす
 * （tests/install-master.test.ts と同じやり方。db に触るモジュールは
 * DATABASE_URL を差し替えたあとの beforeAll で動的 import する）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { displayValue } from "@/lib/field-types";
import { DataGrid } from "@/components/grid/DataGrid";
import type { EngineCollection, ResolvedRecords } from "@/lib/relations";

/* ------------------------------- 使い捨て DB ------------------------------ */

const tmpDir = mkdtempSync(join(tmpdir(), "dashdrop-relations-display-"));
const dbFile = join(tmpDir, "relations-display.db");
// tests/setup.ts が `??=` で file:./test.db を入れているので、上書きは代入で行う。
process.env.DATABASE_URL = `file:${dbFile}`;

let db: typeof import("@/lib/db").db;
let resolveCollectionRecords: typeof import("@/lib/relations").resolveCollectionRecords;
let labelLookupValue: typeof import("@/lib/relations").labelLookupValue;
let applyLookupLabels: typeof import("@/lib/relations").applyLookupLabels;

/** 休暇申請シート相当（ルックアップ側）。 */
let leave: EngineCollection;
/** DataGrid にそのまま渡せる形の列定義（Prisma の Field 行）。 */
let leaveFields: Array<{
  id: string;
  key: string;
  name: string;
  type: string;
  required: boolean;
  options: unknown;
  config: unknown;
  position: number;
}> = [];
let resolved: ResolvedRecords;
/** 休暇申請の行 id（フル / パート / 未リンク）。 */
let rowFulltime = "";
let rowParttime = "";
let rowUnlinked = "";

const EMPLOYMENT_OPTIONS = [
  { label: "正社員", value: "fulltime" },
  { label: "契約社員", value: "contract" },
  { label: "パート・アルバイト", value: "parttime" },
];
const SKILL_OPTIONS = [
  { label: "Excel", value: "excel" },
  { label: "簿記", value: "bookkeeping" },
];

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
  const relations = await import("@/lib/relations");
  resolveCollectionRecords = relations.resolveCollectionRecords;
  labelLookupValue = relations.labelLookupValue;
  applyLookupLabels = relations.applyLookupLabels;

  const workspace = await db.workspace.create({
    data: { name: "テスト商事", slug: "test-relations-display" },
  });

  /* --- 社員シート：select / multiselect と、選択肢を持たない各型 --------- */
  const employees = await db.collection.create({
    data: {
      workspaceId: workspace.id,
      name: "社員",
      slug: "employees",
      fields: {
        create: [
          { key: "name", name: "氏名", type: "text", position: 0 },
          {
            key: "employmentType",
            name: "雇用形態",
            type: "select",
            options: EMPLOYMENT_OPTIONS,
            position: 1,
          },
          {
            key: "skills",
            name: "スキル",
            type: "multiselect",
            options: SKILL_OPTIONS,
            position: 2,
          },
          { key: "position", name: "役職", type: "text", position: 3 },
          { key: "baseSalary", name: "基本給", type: "currency", position: 4 },
          { key: "joinedOn", name: "入社日", type: "date", position: 5 },
          { key: "absences", name: "欠勤日数", type: "number", position: 6 },
          { key: "remote", name: "在宅可", type: "checkbox", position: 7 },
        ],
      },
    },
  });

  const sasaki = await db.record.create({
    data: {
      collectionId: employees.id,
      data: {
        name: "佐々木 隆",
        employmentType: "fulltime",
        skills: ["excel", "bookkeeping"],
        position: "部長",
        baseSalary: 520000,
        joinedOn: "2012-04-01",
        // 0 と false が「空」に潰れないことの見張り役。
        absences: 0,
        remote: false,
      },
    },
  });
  const kimura = await db.record.create({
    data: {
      collectionId: employees.id,
      data: {
        name: "木村 彩香",
        employmentType: "parttime",
        skills: ["excel"],
        position: "担当",
      },
    },
  });
  const ooishi = await db.record.create({
    data: {
      collectionId: employees.id,
      data: {
        // 選択肢から消えた（が、データには残っている）古いコード。
        name: "大石 実",
        employmentType: "haken",
        skills: [],
      },
    },
  });

  /* --- 休暇申請シート：各種ルックアップ -------------------------------- */
  const created = await db.collection.create({
    data: {
      workspaceId: workspace.id,
      name: "休暇申請",
      slug: "leave-requests",
      fields: {
        create: [
          {
            key: "employee",
            name: "社員",
            type: "relation",
            config: { targetCollectionId: employees.id, displayFieldKey: "name" },
            position: 0,
          },
          {
            key: "approvers",
            name: "承認者",
            type: "relation",
            config: {
              targetCollectionId: employees.id,
              displayFieldKey: "name",
              multiple: true,
            },
            position: 1,
          },
          {
            key: "employmentType",
            name: "雇用形態",
            type: "lookup",
            config: { via: "employee", target: "employmentType" },
            position: 2,
          },
          {
            key: "skills",
            name: "スキル",
            type: "lookup",
            config: { via: "employee", target: "skills" },
            position: 3,
          },
          {
            key: "approverTypes",
            name: "承認者の雇用形態",
            type: "lookup",
            config: { via: "approvers", target: "employmentType" },
            position: 4,
          },
          {
            key: "empPosition",
            name: "役職",
            type: "lookup",
            config: { via: "employee", target: "position" },
            position: 5,
          },
          {
            key: "empSalary",
            name: "基本給",
            type: "lookup",
            config: { via: "employee", target: "baseSalary" },
            position: 6,
          },
          {
            key: "empJoinedOn",
            name: "入社日",
            type: "lookup",
            config: { via: "employee", target: "joinedOn" },
            position: 7,
          },
          {
            key: "empAbsences",
            name: "欠勤日数",
            type: "lookup",
            config: { via: "employee", target: "absences" },
            position: 8,
          },
          {
            key: "empRemote",
            name: "在宅可",
            type: "lookup",
            config: { via: "employee", target: "remote" },
            position: 9,
          },
        ],
      },
      records: {
        create: [
          { data: { employee: [sasaki.id], approvers: [kimura.id, ooishi.id] } },
          { data: { employee: [kimura.id] } },
          { data: {} },
        ],
      },
    },
    include: {
      fields: { orderBy: { position: "asc" } },
      records: { orderBy: { createdAt: "asc" } },
    },
  });
  leaveFields = created.fields;
  rowFulltime = created.records[0].id;
  rowParttime = created.records[1].id;
  rowUnlinked = created.records[2].id;

  leave = created as unknown as EngineCollection;
  resolved = await resolveCollectionRecords(
    workspace.id,
    leave,
    created.records.map((r) => ({
      id: r.id,
      data: (r.data as Record<string, unknown>) ?? {},
    })),
  );
}, 120_000);

afterAll(async () => {
  await db.$disconnect().catch(() => {});
  rmSync(tmpDir, { recursive: true, force: true });
});

/* --------------------------------- ヘルパ --------------------------------- */

function computedOf(recordId: string): Record<string, unknown> {
  const row = resolved.records.find((r) => r.id === recordId);
  if (!row) throw new Error(`row not found: ${recordId}`);
  return row.computed;
}

/** グリッド / レコード詳細が最終的に画面へ出す文字列。 */
function shownText(recordId: string, key: string): string {
  return displayValue(
    "lookup",
    labelLookupValue(computedOf(recordId)[key], resolved.lookupLabels[key]),
  );
}

/* ---------------------------------- 検証 ---------------------------------- */

describe("ルックアップ列の表示ラベル", () => {
  it("computed の値は生のまま（集計・保存済みフィルタが参照するため）", () => {
    // ここがラベルに変わると、"parttime" で絞っているダッシュボードが黙って壊れる。
    expect(computedOf(rowFulltime).employmentType).toBe("fulltime");
    expect(computedOf(rowParttime).employmentType).toBe("parttime");
    expect(computedOf(rowFulltime).skills).toEqual(["excel", "bookkeeping"]);
    expect(computedOf(rowFulltime).approverTypes).toEqual(["parttime", "haken"]);
  });

  it("select を引くルックアップは「生の値 → ラベル」の対応表を返す", () => {
    expect(resolved.lookupLabels.employmentType).toEqual({
      fulltime: "正社員",
      contract: "契約社員",
      parttime: "パート・アルバイト",
    });
    expect(shownText(rowFulltime, "employmentType")).toBe("正社員");
    expect(shownText(rowParttime, "employmentType")).toBe("パート・アルバイト");
  });

  it("選択肢から消えたコードは空欄にせず、そのまま見せる", () => {
    // 何が保存されているのか分からなくなるのが一番困るので、コードを残す。
    expect(labelLookupValue("haken", resolved.lookupLabels.employmentType)).toBe(
      "haken",
    );
  });

  it("multiselect を引くルックアップは値ごとにラベル化される", () => {
    expect(resolved.lookupLabels.skills).toEqual({
      excel: "Excel",
      bookkeeping: "簿記",
    });
    expect(shownText(rowFulltime, "skills")).toBe("Excel, 簿記");
    expect(shownText(rowParttime, "skills")).toBe("Excel");
  });

  it("複数リンク（multiple: true）は値ごとにラベル化され、未知のコードは残る", () => {
    expect(shownText(rowFulltime, "approverTypes")).toBe(
      "パート・アルバイト, haken",
    );
  });

  it("select 以外を引くルックアップは今までどおり（対応表を作らない）", () => {
    for (const key of [
      "empPosition",
      "empSalary",
      "empJoinedOn",
      "empAbsences",
      "empRemote",
    ]) {
      expect(resolved.lookupLabels[key]).toBeUndefined();
    }
    const computed = computedOf(rowFulltime);
    expect(computed.empPosition).toBe("部長");
    expect(computed.empSalary).toBe(520000);
    expect(computed.empJoinedOn).toBe("2012-04-01");
    // 0 / false は「空」ではない。消えずに残ること。
    expect(computed.empAbsences).toBe(0);
    expect(computed.empRemote).toBe(false);
    expect(shownText(rowFulltime, "empAbsences")).toBe("0");
    expect(shownText(rowFulltime, "empRemote")).toBe("false");
  });

  it("リンクが無い行は null のまま、表示は空欄", () => {
    const computed = computedOf(rowUnlinked);
    expect(computed.employmentType).toBeNull();
    expect(computed.skills).toBeNull();
    expect(shownText(rowUnlinked, "employmentType")).toBe("");
    expect(labelLookupValue(null, resolved.lookupLabels.employmentType)).toBeNull();
  });

  it("applyLookupLabels は元の computed を書き換えない（表示用のコピーを返す）", () => {
    // レコード詳細ページはこの関数で表示用バッグを作る。元が汚れると、
    // 同じ resolved を読む集計側まで巻き添えになる。
    const raw = computedOf(rowParttime);
    const display = applyLookupLabels(raw, resolved.lookupLabels);
    expect(display.employmentType).toBe("パート・アルバイト");
    expect(raw.employmentType).toBe("parttime");
    expect(display.empPosition).toBe(raw.empPosition);
    expect(display).not.toBe(raw);
  });

  it("グリッド・レコード詳細・API が同じ文字列に落ち着く", () => {
    // API は resolved.records（生の computed）と resolved.lookupLabels を
    // そのまま返す。グリッドはセル単位で labelLookupValue、レコード詳細は
    // バッグ単位で applyLookupLabels を通す。どちらも同じ結果になること。
    for (const rowId of [rowFulltime, rowParttime, rowUnlinked]) {
      const raw = computedOf(rowId);
      const viaBag = applyLookupLabels(raw, resolved.lookupLabels);
      for (const key of Object.keys(raw)) {
        const viaCell = labelLookupValue(raw[key], resolved.lookupLabels[key]);
        expect(displayValue("lookup", viaBag[key])).toBe(
          displayValue("lookup", viaCell),
        );
      }
    }
  });

  it("グリッドは保存値ではなくラベルを描画する", () => {
    // 表示層まで通した最終確認。DataGrid が computed[key] をそのまま
    // CellView に渡す実装に戻ったら、ここで落ちる。
    // （このファイルは .ts なので JSX ではなく createElement で組む）
    render(
      createElement(DataGrid, {
        collection: { id: "grid-test", template: "custom" },
        fields: leaveFields,
        initialRecords: resolved.records,
        relationLabels: resolved.relationLabels,
        lookupLabels: resolved.lookupLabels,
        workspaceCollections: [],
      }),
    );

    expect(screen.getAllByText("正社員").length).toBeGreaterThan(0);
    expect(screen.getAllByText("パート・アルバイト").length).toBeGreaterThan(0);
    // multiselect も複数リンクも、値ごとにラベル化されて並ぶ。
    expect(screen.getByText("Excel, 簿記")).toBeInTheDocument();
    // 選択肢から消えたコードは残る（空欄にしない）。
    expect(screen.getByText("パート・アルバイト, haken")).toBeInTheDocument();
    // コードそのものが単独で出ていないこと。
    expect(screen.queryByText("fulltime")).toBeNull();
    expect(screen.queryByText("parttime")).toBeNull();
    // select 以外は今までどおり。0 / false も消えない。
    expect(screen.getByText("部長")).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("false").length).toBeGreaterThan(0);
  });

  it("リンク先が同じワークスペースに無ければ、対応表も作られない", async () => {
    // 別テナントの collection には触れない（relationLabels と同じ扱い）。
    const other = await db.workspace.create({
      data: { name: "別会社", slug: "other-relations-display" },
    });
    const leaked = await resolveCollectionRecords(other.id, leave, [
      { id: rowFulltime, data: { employee: [] } },
    ]);
    expect(leaked.lookupLabels).toEqual({});
    expect(leaked.records[0].computed.employmentType).toBeNull();
  });
});

describe("vlookup も選択肢のラベルで見せる", () => {
  /**
   * 回帰テスト: ラベル化を lookup にだけ入れて vlookup を忘れていたため、
   * 「キー列で別シートを突合する」列では 雇用形態 が parttime のまま出ていた。
   * 同じ症状が別の列に残るのは、直したうちに入らない。
   */
  it("キー突合で引いた select 列にラベル対応表が付く", async () => {
    const ws = await db.workspace.create({
      data: { name: "vlookup検証", slug: "vlookup-labels" },
    });

    const master = await db.collection.create({
      data: {
        workspaceId: ws.id,
        name: "社員マスタ",
        slug: "vl-master",
        fields: {
          create: [
            { key: "code", name: "社員コード", type: "text", position: 0 },
            {
              key: "employmentType",
              name: "雇用形態",
              type: "select",
              position: 1,
              options: [
                { label: "正社員", value: "fulltime" },
                { label: "パート・アルバイト", value: "parttime" },
              ],
            },
          ],
        },
      },
    });
    await db.record.create({
      data: {
        collectionId: master.id,
        data: { code: "E-1", employmentType: "parttime" },
      },
    });

    const sheet = await db.collection.create({
      data: {
        workspaceId: ws.id,
        name: "勤務表",
        slug: "vl-sheet",
        fields: {
          create: [
            { key: "code", name: "社員コード", type: "text", position: 0 },
            {
              key: "kind",
              name: "雇用形態",
              type: "vlookup",
              position: 1,
              config: {
                targetCollectionId: master.id,
                localKey: "code",
                targetKey: "code",
                targetField: "employmentType",
                aggregate: "first",
              },
            },
          ],
        },
      },
    });
    const row = await db.record.create({
      data: { collectionId: sheet.id, data: { code: "E-1" } },
    });

    const withFields = await db.collection.findFirstOrThrow({
      where: { id: sheet.id },
      include: { fields: { orderBy: { position: "asc" } } },
    });
    const resolved = await resolveCollectionRecords(
      ws.id,
      withFields as unknown as EngineCollection,
      [{ id: row.id, data: { code: "E-1" } }],
    );

    // 集計・保存済みフィルタが読む値は生のまま。
    expect(resolved.records[0].computed.kind).toBe("parttime");
    // 表示用の対応表が付いていること。
    expect(resolved.lookupLabels.kind).toEqual({
      fulltime: "正社員",
      parttime: "パート・アルバイト",
    });
    const shown = applyLookupLabels(
      resolved.records[0].computed,
      resolved.lookupLabels,
    );
    expect(shown.kind).toBe("パート・アルバイト");
  });
});
