/**
 * 1,000ワークスペースでアラート評価（15分ごとのcron）を実際に走らせて測る。
 *
 * **開発中のDBには触らない。** DATABASE_URL を使い捨てのファイルに向けてから
 * 実行すること:
 *   DATABASE_URL="file:./bench.db" npx tsx scripts/bench/sweep.ts
 *
 * 測りたいのは2つ。
 *  1. 対象ワークスペースを並べるクエリが、総数に比例してどれだけ重くなるか
 *  2. 1回の実行（50秒の予算）で何ワークスペース捌けるか＝一周に何分かかるか
 */
import { PrismaClient } from "@prisma/client";
import { runAlertSweep, DEFAULT_MAX_WORKSPACES } from "../../src/lib/cron";

const db = new PrismaClient();

const WORKSPACES = Number(process.env.N ?? 1000);
const RULES_PER_WS = 3;

function ms(t: bigint) {
  return Number(process.hrtime.bigint() - t) / 1e6;
}

async function seed() {
  console.log(`seed: ${WORKSPACES} ワークスペース × ${RULES_PER_WS} ルール …`);
  const t = process.hrtime.bigint();

  await db.workspace.createMany({
    data: Array.from({ length: WORKSPACES }, (_, i) => ({
      id: `ws_${i}`,
      name: `会社${i}`,
      slug: `co-${i}`,
      plan: "free",
    })),
  });

  // コレクションとレコードも作る（評価はレコードを読むので、空だと実態から離れる）
  await db.collection.createMany({
    data: Array.from({ length: WORKSPACES }, (_, i) => ({
      id: `col_${i}`,
      workspaceId: `ws_${i}`,
      name: "受注",
      slug: "juchu",
    })),
  });
  await db.field.createMany({
    data: Array.from({ length: WORKSPACES }, (_, i) => ({
      id: `f_${i}`,
      collectionId: `col_${i}`,
      key: "kingaku",
      name: "金額",
      type: "currency",
      position: 0,
    })),
  });

  const RECORDS_PER_WS = 50;
  for (let chunk = 0; chunk < WORKSPACES; chunk += 100) {
    const data: { id: string; collectionId: string; data: object }[] = [];
    for (let i = chunk; i < Math.min(chunk + 100, WORKSPACES); i++) {
      for (let r = 0; r < RECORDS_PER_WS; r++) {
        data.push({
          id: `rec_${i}_${r}`,
          collectionId: `col_${i}`,
          data: { kingaku: 1000 + r * 37 },
        });
      }
    }
    await db.record.createMany({ data });
  }

  await db.alertRule.createMany({
    data: Array.from({ length: WORKSPACES * RULES_PER_WS }, (_, i) => {
      const ws = Math.floor(i / RULES_PER_WS);
      return {
        id: `ar_${i}`,
        workspaceId: `ws_${ws}`,
        collectionId: `col_${ws}`,
        name: `ルール${i}`,
        enabled: true,
        channel: "inapp",
        metric: { measure: { kind: "sum", field: "kingaku" } },
        operator: "gt",
        threshold: 10,
      };
    }),
  });
  console.log(`  完了 ${ms(t).toFixed(0)}ms\n`);
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("bench")) {
    console.error("⚠ DATABASE_URL に 'bench' が入っていません。開発DBを壊す恐れがあるので中止します。");
    console.error(`  いまの値: ${url}`);
    process.exit(1);
  }

  await seed();

  // ── 1. 対象を並べるクエリ ──
  const { dbSweepDeps } = await import("../../src/lib/cron");
  const deps = dbSweepDeps();
  let t = process.hrtime.bigint();
  const queue = await deps.listWorkspaces(DEFAULT_MAX_WORKSPACES);
  const listMs = ms(t);
  console.log(`listWorkspaces(${DEFAULT_MAX_WORKSPACES})`);
  console.log(`  総ワークスペース ${WORKSPACES} / 返った件数 ${queue.length} / ${listMs.toFixed(0)} ms`);
  console.log(`  ※ DB側では全件を groupBy し、アプリ側で ${DEFAULT_MAX_WORKSPACES} 件に切っている\n`);

  // ── 2. 実際に1回分の掃引を回す ──
  t = process.hrtime.bigint();
  const result = await runAlertSweep(deps);
  const sweepMs = ms(t);
  const done = result.outcomes?.length ?? 0;
  const skipped = result.skippedWorkspaceIds?.length ?? 0;
  console.log(`runAlertSweep（予算50秒）`);
  console.log(`  実時間        ${(sweepMs / 1000).toFixed(1)} 秒`);
  console.log(`  評価できた    ${done} ワークスペース`);
  console.log(`  次回へ回した  ${skipped}`);
  console.log(`  1件あたり     ${(sweepMs / Math.max(done, 1)).toFixed(0)} ms`);
  console.log(`  message: ${result.message}\n`);

  const rounds = Math.ceil(WORKSPACES / Math.max(done, 1));
  console.log(`=== ${WORKSPACES} ワークスペースを一周するのに ===`);
  console.log(`  ${rounds} 回の実行 × 15分 = ${rounds * 15} 分`);
  console.log(`  → 通知が最大 ${rounds * 15} 分遅れうる`);

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
