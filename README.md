# DashDrop

> スプレッドシート感覚で、経営の数字とお客様対応をひとつに。

DashDrop は、中小企業の経営者のための **シンプルな SaaS ダッシュボード**です。
顧客からの問い合わせ、社内タスク、週間パフォーマンスを、**Excel / スプレッドシート連携**を軸に管理できます。表計算の手軽さそのままに、裏側は**型付きメタデータのデータベース**として機能します。

- 🗂 **メタデータ駆動データベース** — テーブル（コレクション）に型付きフィールドを定義。表がそのまま構造化データに。
- 📊 **Excel / CSV 連携** — アップロードで列を自動判定してテーブル化。ワンクリックでエクスポート。
- 📈 **週間パフォーマンス** — 問い合わせ数・対応率・タスク完了を落ち着いたチャートで可視化。
- 🖼 **ダッシュボード・ギャラリー** — 営業・請求・経理・人事・マーケなど**30種のテンプレート**をカテゴリ別に選択。適用するとサンプルデータ付きでテーブル＋ダッシュボードが即完成。
- 🤖 **画像・PDFから自動生成** — 作りたいダッシュボードのスクショ/PDF/文章を添付すると、AIが構成を生成（`.env` の API キーで有効化。未設定でも近似テンプレで作成）。
- 📮 **問い合わせ & タスク管理** — 組み込みテンプレートですぐ運用開始。
- 🔐 **商用前提の設計** — マルチテナント（ワークスペース）、プラン制、API 連携用の `.env` を同梱。

デザインは **カーキ基調のアース系**。過度な角丸・派手な配色・グラデーションを避けた、清潔感と信頼感のある実務向けトーンです。

---

## 技術スタック

| 領域 | 採用 |
|---|---|
| フレームワーク | Next.js 15（App Router）+ TypeScript |
| スタイル | Tailwind CSS（カーキのデザイントークン） |
| データベース | Prisma + SQLite（開発） / PostgreSQL（本番に切替可能） |
| 認証 | bcrypt + JWT（httpOnly Cookie、`jose`） |
| チャート | Recharts |
| Excel | SheetJS（`xlsx`） |
| バリデーション | Zod |
| テスト | Vitest |

---

## セットアップ

```bash
# 1. 依存関係
npm install

# 2. 環境変数（.env.example をコピーして値を設定）
cp .env.example .env
#   AUTH_SECRET は本番で必ず変更:  openssl rand -base64 48

# 3. データベース初期化 + デモデータ投入
npm run setup      # = prisma generate && prisma db push && seed

# 4. 開発サーバー
npm run dev        # http://localhost:3000
```

### デモアカウント

シード投入後、以下でログインできます:

```
メール:      owner@demo.dashdrop
パスワード:  demo1234
```

---

## 主要コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド（`prisma generate` 込み） |
| `npm run start` | 本番サーバー |
| `npm run typecheck` | 型チェック |
| `npm run test` | テスト（Vitest） |
| `npm run db:push` | スキーマを DB に反映 |
| `npm run db:seed` | デモデータ投入 |
| `npm run db:reset` | DB リセット＋再シード |

---

## 環境変数（`.env`）

`.env` は **コミットしません**（`.gitignore` 済み）。テンプレートは `.env.example` を参照。

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | DB 接続。開発は `file:./dev.db`、本番は Postgres の URL |
| `AUTH_SECRET` | セッション JWT の署名鍵（本番は 32 文字以上のランダム値必須） |
| `SESSION_MAX_AGE` | セッション有効期間（秒） |
| `STRIPE_SECRET_KEY` ほか | 決済（任意）。未設定なら課金は無効モード |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | 画像・PDFからのダッシュボード自動生成に使用（未設定でも近似テンプレで動作） |
| `GOOGLE_SHEETS_*` | 将来の API 連携用プレースホルダ |
| `SMTP_*` | トランザクションメール（任意） |

---

## アーキテクチャ

```
src/
  app/
    (marketing)/        公開: LP・料金プラン
    (auth)/             ログイン・サインアップ
    (app)/              認証必須: ダッシュボード / テーブル / 取り込み / 設定
    api/                Route Handlers（すべて withAuth でテナント分離）
  components/
    ui/                 デザインシステムの基本部品
    app/                アプリシェル（Sidebar / Topbar）
    grid/               スプレッドシート風グリッド
    charts/  dashboard/ ダッシュボードとチャート
    import/  marketing/ 取り込みウィザード・LP 部品
  lib/
    db, env, auth, api  基盤
    field-types         フィールド型エンジン（型推論・検証・整形）
    workspace           テナント分離・プラン上限・アクティビティ記録
    plans, templates    プラン定義・組み込みテンプレート
    metrics, excel      集計・Excel 入出力
prisma/
    schema.prisma       Workspace / Collection / Field / Record / Activity
    seed.ts             デモワークスペース
```

### データモデルの考え方

プロダクトの核は**メタデータ駆動 DB**です。`Workspace` が `Collection`（＝テーブル）を持ち、各 `Collection` が型付きの `Field`（メタデータ）を持ち、`Record` が実データを JSON で保持します。「顧客問い合わせ」「タスク」は、あらかじめ `Field` を定義した `Collection` テンプレートにすぎません。

### 本番（PostgreSQL）への切り替え

1. `prisma/schema.prisma` の `datasource db` の `provider` を `"postgresql"` に変更
2. `.env` の `DATABASE_URL` を Postgres の接続文字列に
3. `npx prisma migrate deploy`（または `db push`）

スキーマは移行しやすいよう、enum を String + Zod 検証で表現しています。

---

## セキュリティ

- パスワードは bcrypt（コスト 12）でハッシュ化
- セッションは httpOnly・SameSite=Lax・本番は Secure な Cookie に格納した JWT
- すべての API はワークスペース単位でスコープされ、他テナントのデータには到達不可
- 入力は Zod で検証、Excel 取り込みはサイズ・行数の上限あり
- 秘密情報は `.env` のみ（リポジトリには含めない）

---

## ライセンス

Proprietary — © 2026 DashDrop.
