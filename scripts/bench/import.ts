/**
 * 取り込み1回のCPU時間。maxDuration=60秒 に収まるか。
 * xlsx の解析はサーバーのCPUを実際に使う（I/O待ちではない）ので、
 * Vercel の課金対象にもなる。
 */
import * as XLSX from "xlsx";
import { readSheet, inferFields } from "../../src/lib/excel";
import { coerceValue } from "../../src/lib/field-types";

function makeXlsx(rows: number, cols: number): Buffer {
  const header = Array.from({ length: cols }, (_, c) => `列${c + 1}`);
  const data = [header];
  for (let r = 0; r < rows; r++) {
    data.push(
      Array.from({ length: cols }, (_, c) =>
        c === 0 ? `2026-0${(r % 9) + 1}-15` : c % 3 === 0 ? String(1000 + r) : `値${r % 50}`,
      ),
    );
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function ms(fn: () => void) {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
}

console.log("行数     ファイル   解析      型推定    値の変換   合計");
for (const rows of [500, 5_000, 20_000, 50_000]) {
  const buf = makeXlsx(rows, 10);
  const mb = buf.length / 1024 / 1024;

  let parsed!: ReturnType<typeof readSheet>;
  const parseMs = ms(() => { parsed = readSheet(buf); });

  let fields!: ReturnType<typeof inferFields>;
  const inferMs = ms(() => { fields = inferFields(parsed.headers, parsed.sampleByHeader); });

  const coerceMs = ms(() => {
    for (const r of parsed.rows) {
      for (const f of fields) coerceValue(f.type, r[f.name]);
    }
  });

  const total = parseMs + inferMs + coerceMs;
  console.log(
    `${String(rows).padStart(6)}  ${mb.toFixed(2).padStart(6)}MB  ` +
    `${parseMs.toFixed(0).padStart(6)}ms  ${inferMs.toFixed(0).padStart(6)}ms  ` +
    `${coerceMs.toFixed(0).padStart(7)}ms  ${(total / 1000).toFixed(1).padStart(5)}秒`,
  );
}
console.log("\n※ 取り込みAPIの上限は 4MB / maxDuration 60秒");
