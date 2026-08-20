/**
 * CP932(Shift_JIS) のエンコーダ。
 *
 * 日本語 Windows の Excel が「CSV (カンマ区切り)」で書き出すのはこの文字コード
 * なので、テストでも**実バイト列**を作れないと、いちばん普通に渡されるファイルを
 * 再現できない（文字列のまま渡すと、判定処理をまるごと素通りしてしまう）。
 *
 * Node に CP932 のエンコーダは無いが、デコーダはある。全ての2バイト組を1度だけ
 * 復号して逆引き表を作る——依存を増やさずに済み、正しさはデコーダ側が保証する。
 */

let table: Map<string, number[]> | null = null;

function buildTable(): Map<string, number[]> {
  const dec = new TextDecoder("shift_jis", { fatal: true });
  const map = new Map<string, number[]>();

  // 1バイト: ASCII と半角カナ。
  for (let b = 0x20; b <= 0x7e; b++) map.set(String.fromCharCode(b), [b]);
  for (let b = 0xa1; b <= 0xdf; b++) {
    try {
      map.set(dec.decode(Uint8Array.of(b)), [b]);
    } catch {
      /* 未定義のバイトは表に入れない */
    }
  }

  // 2バイト: 先頭 0x81-0x9F / 0xE0-0xFC、後続 0x40-0xFC（0x7F を除く）。
  const leads: number[] = [];
  for (let b = 0x81; b <= 0x9f; b++) leads.push(b);
  for (let b = 0xe0; b <= 0xfc; b++) leads.push(b);
  for (const lead of leads) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      try {
        const ch = dec.decode(Uint8Array.of(lead, trail));
        // 同じ文字に複数の並びがある領域では、先に見つかった方を採る。
        if (!map.has(ch)) map.set(ch, [lead, trail]);
      } catch {
        /* 未定義の組み合わせ */
      }
    }
  }
  return map;
}

/** CP932 で表せない文字があれば、その文字を返す（テストの前提崩れを検出するため）。 */
export function unencodableIn932(text: string): string | null {
  table ??= buildTable();
  for (const ch of text) {
    if (ch === "\n" || ch === "\r" || ch === "\t") continue;
    if (!table.has(ch)) return ch;
  }
  return null;
}

/** 文字列を CP932 のバイト列にする。表せない文字は「?」に落とす。 */
export function encodeCp932(text: string): Buffer {
  table ??= buildTable();
  const out: number[] = [];
  for (const ch of text) {
    if (ch === "\n") {
      out.push(0x0a);
      continue;
    }
    if (ch === "\r") {
      out.push(0x0d);
      continue;
    }
    if (ch === "\t") {
      out.push(0x09);
      continue;
    }
    const bytes = table.get(ch);
    if (bytes) out.push(...bytes);
    else out.push(0x3f); // "?"
  }
  return Buffer.from(out);
}
