#!/usr/bin/env bash
#
# DashDrop — Vercel 本番環境の初期設定
#
# 手で1つずつ入れると、必ずどれかを忘れる。忘れても**アプリは起動する**種類の
# 設定（DATABASE_URL の接続プール、CRON_SECRET、APP_URL）が混ざっているので、
# 忘れたことに気づくのはお客さまが困ったときになる。まとめて入れる。
#
# 使い方:
#   1) `vercel login`（ブラウザが開く。一度だけ）
#   2) `.env.vercel` を作って値を埋める（このファイルは .gitignore 済み）
#   3) bash scripts/vercel-setup.sh
#
# 何度流しても同じ結果になる（既存の値は消してから入れ直す）。
set -euo pipefail

ENV_FILE="${1:-.env.vercel}"
TARGET="${TARGET:-production}"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE がありません。.env.example を写して値を埋めてください。" >&2
  exit 1
fi

if ! npx --yes vercel whoami >/dev/null 2>&1; then
  echo "✗ Vercel にログインしていません。先に \`npx vercel login\` を実行してください。" >&2
  exit 1
fi

# 本番に入れるもの。ここに無い変数は入れない（.env.vercel に手元用の値が
# 混ざっていても、それが本番へ漏れないようにするため）。
KEYS=(
  APP_URL
  DATABASE_URL
  DATABASE_PROVIDER
  AUTH_SECRET
  CRON_SECRET
  EMAIL_FROM
  SMTP_HOST
  SMTP_PORT
  SMTP_USER
  SMTP_PASSWORD
  ANTHROPIC_API_KEY
  ANTHROPIC_MODEL
  ERROR_WEBHOOK_URL
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_PRICE_PRO
  STRIPE_PRICE_BUSINESS
)

# 空でも必ず入れるべきもの以外は、空なら飛ばす（未設定と空文字は意味が違う）。
REQUIRED=(APP_URL DATABASE_URL DATABASE_PROVIDER AUTH_SECRET)

value_of() {
  # `KEY="value"` / `KEY=value` の両方を読む。値の中の = は残す。
  sed -n "s/^${1}=//p" "$ENV_FILE" | head -1 | sed -e 's/^"//' -e 's/"$//'
}

echo "→ プロジェクトを紐づけます（ss-and）"
npx --yes vercel link --yes --scope ss-and

missing=0
for k in "${REQUIRED[@]}"; do
  if [ -z "$(value_of "$k")" ]; then
    echo "✗ $k が $ENV_FILE に入っていません" >&2
    missing=1
  fi
done
[ "$missing" -eq 0 ] || exit 1

for k in "${KEYS[@]}"; do
  v="$(value_of "$k")"
  if [ -z "$v" ]; then
    echo "  · $k … 空なので飛ばします"
    continue
  fi
  # 入れ直し。既存が無いときの失敗は無視する。
  npx --yes vercel env rm "$k" "$TARGET" --yes >/dev/null 2>&1 || true
  printf '%s' "$v" | npx --yes vercel env add "$k" "$TARGET" >/dev/null
  # 値そのものは出さない。入ったことだけ出す。
  echo "  ✓ $k"
done

echo
echo "→ 入っているものの一覧"
npx --yes vercel env ls "$TARGET"

cat <<'NEXT'

────────────────────────────────────────────────────────
残り（ここは画面での作業です）

  1. ドメイン         npx vercel domains add <ドメイン>
                      買った先（お名前.com 等）で NS を Vercel に向けるか、
                      DNS を Cloudflare に残すなら CNAME を **DNS only** で。
                      ※ オレンジの proxy を通すとアクセス元IPが全部
                        Cloudflare になり、登録・ログインの回数制限が
                        全ユーザーで1つのバケツを共有します。

  2. DB のマイグレーション
                      DATABASE_PROVIDER=postgresql DATABASE_URL="…" \
                        npm run db:deploy

  3. 最初のデプロイ    npx vercel --prod

  4. cron が動いたか   Vercel の画面 → Settings → Cron Jobs
                      15分待って、実行履歴に 200 が並ぶこと。
                      401 が並ぶなら CRON_SECRET が食い違っています。
────────────────────────────────────────────────────────
NEXT
