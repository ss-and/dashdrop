# 負荷の実測

公開前に「1,000人が来たらどこが壊れるか」を、推測ではなく**測って**答えるための道具。

## 使い方

```bash
# 1. 計算だけ（DBに触らない。安全）
npx tsx scripts/bench/compute.ts

# 2. Excel取り込みのCPU時間（DBに触らない）
npx tsx scripts/bench/import.ts

# 3. 使い捨てDBを用意する（開発用DBには絶対に触らない）
rm -f prisma/bench.db
DATABASE_URL="file:./bench.db" npx prisma db push --skip-generate --accept-data-loss

# 4. 1,000ワークスペースでアラート掃引を回す
NODE_PATH=/tmp/bench-shim \
DATABASE_URL="file:$PWD/prisma/bench.db" N=1000 npx tsx scripts/bench/sweep.ts

# 5. DBの書き込み・読み出し
DATABASE_URL="file:$PWD/prisma/bench.db" npx tsx scripts/bench/write.ts
```

`sweep.ts` は `src/lib/alerts.ts` を読むが、そこに `server-only` が入っているため
Next.js の外では解決できない。空の実装を置いて NODE_PATH で渡す:

```bash
mkdir -p /tmp/bench-shim/server-only
echo 'module.exports = {};' > /tmp/bench-shim/server-only/index.js
echo '{"name":"server-only","version":"0.0.0","main":"index.js"}' > /tmp/bench-shim/server-only/package.json
```

## 安全のための決まり

- `sweep.ts` と `write.ts` は `DATABASE_URL` に `bench` が入っていなければ**実行を拒否する**。
  開発用の `dev.db` を壊さないため
- `prisma/bench.db` は `.gitignore` 済み

## 測った結果（2026-08-30・手元のMac・SQLite）

| 何を | 結果 |
|---|---|
| ダッシュボード1枚の計算（5万行） | 14 ms |
| 定期支払いの検出（5万行） | 12 ms |
| データ整備（5万行） | 79 ms |
| Excel解析（4MB＝約1万行） | 約 150 ms |
| createMany（1万行） | 0.16 秒 |
| 全行読み出し（5万行） | 0.22 秒・**転送量 11.9 MB** |
| アラート掃引 200ws | 1.0 秒（予算50秒） |
| 1ワークスペースあたりのDBクエリ | **7回**（ルール3本のとき。1 + 2×ルール数） |

**SQLiteはローカルディスクなので、これは下限。** 本番（Neon）はクエリ1回ごとに
ネットワークの往復が乗るので、クエリ**回数**のほうが移植できる数字になる。
