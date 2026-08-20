# 運用手順

公開して動かし続けるために必要なことをまとめる。開発の手順は README を参照。

---

## 1. 本番の環境変数

`.env` ではなく、実行環境の環境変数として設定する。

| 変数 | 必須 | 説明 |
|---|---|---|
| `APP_URL` | ✅ | 公開URL。メールのリンクと共有リンクの土台になる。`http://localhost` のままだと本番起動時にエラーで止まる |
| `DATABASE_URL` | ✅ | `postgresql://…` |
| `DATABASE_PROVIDER` | ✅ | 本番では `postgresql` |
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

このリポジトリはこれまで `prisma db push`（マイグレーション履歴なし）で来ている。
本番に出すなら履歴を作る。

```bash
# 初回だけ: 現在のスキーマを最初のマイグレーションにする
DATABASE_PROVIDER=postgresql npm run db:migrate -- --name init

# 以降: スキーマを変えたら
DATABASE_PROVIDER=postgresql npm run db:migrate -- --name add_something
```

本番への適用は `npm run db:deploy`（`migrate deploy` は履歴を進めるだけで、
データを消す変更を勝手に行わない）。

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
- [ ] `AUTH_SECRET` が本番用のランダム値
- [ ] `APP_URL` が公開URL
- [ ] SMTP が設定され、**実際にパスワード再設定メールが届くことを確認した**
- [ ] `src/lib/legal.ts` の必須項目を記入した（未記入だと `/legal` に警告が出る）
- [ ] 利用規約・プライバシーポリシーを専門家が確認した
- [ ] バックアップが動いていて、復元を1度通した
- [ ] `CRON_SECRET` を設定し、定期実行を登録した
- [ ] デモアカウント（`owner@demo.dashdrop`）が本番DBに**存在しない**
      （`npm run db:seed` を本番で流さない）
