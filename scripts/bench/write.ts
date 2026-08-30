/**
 * 取り込みのDB書き込み（createMany）。ここが取り込み時間の本体。
 * SQLite はローカルディスク、本番の Neon はネットワーク越しなので、
 * ここで測れるのは「下限」。本番はこれより必ず遅い。
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("bench")) { console.error("bench DB 以外では実行しない"); process.exit(1); }
  await db.workspace.create({ data: { id: "wbench", name: "b", slug: "bench-write" } });
  console.log("行数      createMany   1行あたり");
  for (const n of [1_000, 10_000, 50_000]) {
    const colId = `cb_${n}`;
    await db.collection.create({ data: { id: colId, workspaceId: "wbench", name: `c${n}`, slug: `c-${n}` } });
    const rows = Array.from({ length: n }, (_, i) => ({
      collectionId: colId,
      data: { a: `2026-01-${(i % 28) + 1}`, b: `値${i % 50}`, c: 1000 + i, d: `取引先${i % 20}`, e: i % 5 },
    }));
    const t = process.hrtime.bigint();
    await db.record.createMany({ data: rows });
    const msTotal = Number(process.hrtime.bigint() - t) / 1e6;
    console.log(`${String(n).padStart(6)}  ${(msTotal/1000).toFixed(2).padStart(8)}秒  ${(msTotal/n).toFixed(3).padStart(8)}ms`);
  }

  // 読み出し側: ダッシュボードを描くときに全行を読む
  console.log("\n読み出し（ダッシュボード1枚が読む量）");
  for (const n of [1_000, 10_000, 50_000]) {
    const t = process.hrtime.bigint();
    const recs = await db.record.findMany({ where: { collectionId: `cb_${n}` } });
    const msTotal = Number(process.hrtime.bigint() - t) / 1e6;
    const bytes = Buffer.byteLength(JSON.stringify(recs));
    console.log(`${String(n).padStart(6)}行  ${(msTotal/1000).toFixed(2).padStart(6)}秒  転送量 ${(bytes/1024/1024).toFixed(1)}MB`);
  }
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
