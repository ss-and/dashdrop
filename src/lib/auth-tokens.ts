/**
 * パスワード再設定・メール確認の使い捨てトークン。
 *
 * 生の値はDBに入れない。漏れたときに、そのままアカウントを乗っ取れる鍵が
 * 並んでいることになるため、SHA-256 のハッシュだけを持つ（パスワードと
 * 同じ考え方）。照合は、送られてきた値をハッシュして引く。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "./db";

export type TokenPurpose = "password_reset" | "email_verify";

/** 再設定リンクの有効時間。短いほど安全だが、メールの遅延も考えて30分。 */
export const PASSWORD_RESET_TTL_MIN = 30;
/** メール確認は、後から気づいて押されることが多いので長めに。 */
export const EMAIL_VERIFY_TTL_HOURS = 48;

/** URLに載せる値。256bit を base64url で。 */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * 発行する。同じ用途の未使用トークンは無効にする——再送するたびに有効な
 * リンクが増えていくと、古いメールが漏れただけで入れてしまう。
 */
export async function issueToken(
  userId: string,
  purpose: TokenPurpose,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt =
    purpose === "password_reset"
      ? new Date(now.getTime() + PASSWORD_RESET_TTL_MIN * 60_000)
      : new Date(now.getTime() + EMAIL_VERIFY_TTL_HOURS * 3_600_000);

  await db.authToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: now },
  });
  await db.authToken.create({
    data: { userId, purpose, tokenHash: hashToken(token), expiresAt },
  });
  return { token, expiresAt };
}

export interface ConsumedToken {
  userId: string;
}

/**
 * 使う。有効なら userId を返し、そのトークンを使用済みにする。
 * 無効・期限切れ・使用済みはすべて同じ null（理由を返すと、
 * 「そのトークンは存在した」ことが分かってしまう）。
 */
export async function consumeToken(
  token: string,
  purpose: TokenPurpose,
  now: Date = new Date(),
): Promise<ConsumedToken | null> {
  const raw = typeof token === "string" ? token.trim() : "";
  if (!raw) return null;

  const row = await db.authToken.findUnique({
    where: { tokenHash: hashToken(raw) },
  });
  if (!row) return null;
  if (row.purpose !== purpose) return null;
  if (row.usedAt !== null) return null;
  if (row.expiresAt <= now) return null;

  /*
   * ハッシュの一致は上の索引引きで既に決まっているが、比較そのものは
   * 時間差の出ない形で行う。索引引きだけに頼ると、将来ここを
   * 「候補を舐めて比較する」形に変えたときに差が漏れる。
   */
  const a = Buffer.from(hashToken(raw));
  const b = Buffer.from(row.tokenHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // 使えるのは1回だけ。同時に2回来ても、更新できた側だけが通る。
  const claimed = await db.authToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count === 0) return null;

  return { userId: row.userId };
}

/** 期限切れの掃除。定期実行から呼ぶ。 */
export async function purgeExpiredTokens(now: Date = new Date()): Promise<number> {
  const res = await db.authToken.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return res.count;
}
