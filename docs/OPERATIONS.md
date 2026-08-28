# 運用手順

公開して動かし続けるために必要なことをまとめる。開発の手順は README を参照。

---

## 1. 本番の環境変数

`.env` ではなく、実行環境の環境変数として設定する。

| 変数 | 必須 | 説明 |
|---|---|---|
| `APP_URL` | ✅ | 公開URL。メールのリンクと共有リンクの土台になる。`http://localhost` のままだと本番起動時にエラーで止まる |
| `DATABASE_URL` | ✅ | `postgresql://…`。`file:`（SQLite）のままだと本番起動時にエラーで止まる——サーバーレスの一時FSに作られて、書けたように見えたまま消えるため |
| `DATABASE_PROVIDER` | ✅ | 本番では `postgresql`。`DATABASE_URL` と必ず対で変えること |
| `AUTH_SECRET` | ✅ | セッションJWTの署名鍵。**32文字以上のランダム文字列**。`openssl rand -base64 48` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `EMAIL_FROM` | ✅ | パスワード再設定とメール確認に必要。未設定だと、忘れた人が二度と入れない |
| `ANTHROPIC_API_KEY` |  | 取り込み時のAI提案。未設定でも決定的なルールで動く |
| `ERROR_WEBHOOK_URL` |  | 拾えなかった例外の通知先。Slack の Incoming Webhook でも可 |
| `CRON_SECRET` | ✅ | 定期実行の入口を守る。長いランダム文字列 |

`AUTH_SECRET` を変えると、**全員のログインが即座に切れる**（署名が変わるため）。
漏洩時の緊急遮断手段として使えるが、平時に変えてはいけない。

---

## 2. SQLite から PostgreSQL への移行

スキーマは最初から両対応で書いてある（列挙型は `String` + Zod、行データは `Json`）。
`provider` だけがリテラルで書けないので、写しを生成して切り替える。

```bash
# 1. Postgres を用意し、接続できることを確認する
psql "$DATABASE_URL" -c 'select 1'

# 2. スキーマを流し込む（初回）
DATABASE_PROVIDER=postgresql DATABASE_URL="postgresql://…" npm run db:deploy
```

`npm run db:deploy` は次の3つを行う。

1. `prisma/schema.generated.prisma` を provider=postgresql で生成
2. `prisma migrate deploy` でマイグレーションを適用
3. その schema で Prisma Client を生成

`prisma/schema.prisma`（sqlite のまま）は編集しない。手元の開発はこれまでどおり。

> **移行するデータがある場合**
> SQLite → Postgres の行コピーは Prisma では行えない。`sqlite3 dev.db .dump` から
> 変換するか、アプリの書き出し（各シートの「Excelで書き出し」）→ 新環境で取り込み直す。
> 本番を始める前に移す場合は、後者が確実。

---

## 3. マイグレーション

履歴は `prisma/migrations/` にある。**PostgreSQL 方言**で書かれていて、本番
（Postgres）専用。手元の SQLite はこれまでどおり `npm run db:push` で回す
（`prisma/migrations/migration_lock.toml` に `provider = "postgresql"` と書いてある）。

### 3-1. 新しい本番DBに初めて流す

```bash
DATABASE_PROVIDER=postgresql DATABASE_URL="postgresql://…" npm run db:deploy
```

`prisma/migrations/<timestamp>_init/migration.sql` が15テーブル分の
`CREATE TABLE` とインデックス・外部キーを作る。適用後の確認:

```bash
psql "$DATABASE_URL" -c '\dt'                     # 15テーブルあること
psql "$DATABASE_URL" -c 'table _prisma_migrations' # init が applied になっていること
```

> **なぜ履歴が要るのか**
> このリポジトリは長く `prisma db push`（履歴なし）で来ていた。一方
> `npm run db:deploy` は `prisma migrate deploy` を叩く。**履歴が空だと、
> 新規DBに対して「適用するものが無い」と言って成功で終わり、テーブルが1つも
> 作られない。** エラーが出ないので、アプリは起動し、最初のリクエストで初めて
> 壊れていることが分かる——という事故になる。それを塞ぐためのベースライン。

### 3-2. 既に `db push` でテーブルができているDBに、後から履歴を付ける

（先行して手で作った検証環境などが該当。**テーブルがある状態で 3-1 を流すと
「already exists」で落ちる**。）適用はせず、「適用済み」とだけ記録する。

```bash
DATABASE_PROVIDER=postgresql node scripts/db-provider.mjs
DATABASE_URL="postgresql://…" npx prisma migrate resolve \
  --applied 20260828122104_init \
  --schema prisma/schema.generated.prisma
```

そのDBのテーブル定義が本当に現在のスキーマと一致しているかは、先に確かめること
（`prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel
prisma/schema.generated.prisma --script` が空なら一致している）。ずれたまま
resolve すると、以降のマイグレーションが噛み合わなくなる。

### 3-3. 以降、スキーマを変えたとき

```bash
# 作る（要 Postgres。ローカルに docker で立てても良い）
DATABASE_PROVIDER=postgresql npm run db:migrate -- --name add_something

# 本番へ適用
DATABASE_PROVIDER=postgresql npm run db:deploy
```

**`DATABASE_PROVIDER=postgresql` を付け忘れないこと。** 付け忘れると sqlite 方言の
SQL が `prisma/migrations/` に入り、本番の `migrate deploy` がそこで落ちる。

Postgres を用意できない場合は、DBに繋がずに差分SQLだけ作れる（初回の
`_init` もこの方法で作った）。

```bash
DATABASE_PROVIDER=postgresql node scripts/db-provider.mjs
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.generated.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" --script
# 初回（空のDBから）は --from-empty で、シャドウDBも不要:
#   npx prisma migrate diff --from-empty \
#     --to-schema-datamodel prisma/schema.generated.prisma --script
```

`migrate deploy` は履歴を進めるだけで、データを消す変更を勝手に行わない。

---

## 4. バックアップと復旧

**取っていないバックアップは無いのと同じ。復旧の手順を1度は実際に通すこと。**

```bash
# 毎日（cron / マネージドDBの自動バックアップでも可）
pg_dump --format=custom --no-owner "$DATABASE_URL" > dashdrop-$(date +%F).dump

# 復旧
pg_restore --clean --no-owner --dbname "$DATABASE_URL" dashdrop-2026-08-20.dump
```

チェックしておくこと。

- 保管先は本番DBと**別の場所**（同じディスクに置くと同時に失う）
- 保管期間を決める（プライバシーポリシーに「バックアップの保管期間の経過をもって
  順次消去」と書いてあるので、実際にそうする）
- 復元を年に1度は試す

削除機能（シート・ファイル・退会）は**元に戻せない**。誤削除の受け皿はバックアップだけ。

---

## 5. 定期実行

アラート評価とレポート配信は、外部から叩いて動かす。

```
POST https://<APP_URL>/api/cron/alerts
Authorization: Bearer $CRON_SECRET
```

期限切れの認証トークン（パスワード再設定・メール確認）も定期的に掃除する
（`purgeExpiredTokens`）。使用済み・期限切れのトークンは無効なので放置しても
危険ではないが、溜め続ける理由もない。

---

## 6. 監視

- `ERROR_WEBHOOK_URL` を設定すると、拾えなかった例外が1件ずつ POST される
- ログは1行JSON（`{"level":"error","at":…,"where":"api:/api/import",…}`）。
  収集基盤があればそのまま構造化して拾える
- 見るべきもの: 5xx の発生率、取り込みの失敗、メール送信の失敗（`Mail send failed`）

---

## 7. 公開前チェックリスト

- [ ] `DATABASE_PROVIDER=postgresql` で動いている
- [ ] `DATABASE_URL` が `postgresql://…`（`file:` のままなら起動時に落ちる）
- [ ] `npm run db:deploy` を通し、テーブルが15個できていることを確認した（§3-1）
- [ ] `AUTH_SECRET` が本番用のランダム値
- [ ] `APP_URL` が公開URL
- [ ] SMTP が設定され、**実際にパスワード再設定メールが届くことを確認した**
- [ ] `src/lib/legal.ts` の必須項目を記入した（未記入だと `/legal` に警告が出る）
- [ ] 利用規約・プライバシーポリシーを専門家が確認した
- [ ] バックアップが動いていて、復元を1度通した
- [ ] `CRON_SECRET` を設定し、定期実行を登録した
- [ ] デモアカウント（`owner@demo.dashdrop`）が本番DBに**存在しない**
      （`npm run db:seed` は `NODE_ENV=production` では実行を拒否するが、
      `NODE_ENV` を渡し忘れた手元から本番の `DATABASE_URL` を向いて叩けば通ってしまう。
      実際に居ないことを1度は目で確認すること）
