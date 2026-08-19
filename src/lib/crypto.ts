/**
 * Encryption for stored third-party credentials.
 *
 * Integration secrets (Slack webhook URLs, Notion tokens) are live credentials:
 * anyone holding one can post into a customer's channel or read their Notion
 * workspace. Storing them as plaintext columns means a database dump — or a
 * stray backup, or a support engineer running a SELECT — hands them over. So
 * they are sealed with AES-256-GCM before they touch the database.
 *
 * The key is derived from AUTH_SECRET via scrypt with a fixed application salt.
 * That deliberately ties the ciphertext to the deployment: rotating AUTH_SECRET
 * invalidates stored integrations (they must be re-entered), which is the
 * correct, loud failure mode rather than silently decrypting to garbage.
 *
 * Format: v1.<iv-b64>.<tag-b64>.<ciphertext-b64> — versioned so the scheme can
 * change later without guessing at what old rows contain.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const SALT = "dashdrop.integration.v1";

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 16) {
    throw new Error(
      "AUTH_SECRET が未設定または短すぎるため、連携情報を安全に保存できません。",
    );
  }
  cachedKey = scryptSync(secret, SALT, 32);
  return cachedKey;
}

/** Seal a credential for storage. Returns an opaque, versioned string. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(".");
}

/**
 * Open a sealed credential. Returns null for anything that doesn't decrypt —
 * wrong key, tampered ciphertext, malformed input — rather than throwing, so a
 * single bad row can't take down a settings page.
 */
export function decryptSecret(sealed: string): string | null {
  try {
    const parts = sealed.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION) return null;
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const data = Buffer.from(parts[3], "base64");
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;
    const decipher = createDecipheriv(ALGO, key(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    // Includes the GCM auth-tag failure that signals tampering.
    return null;
  }
}

/**
 * A display form that proves which credential is stored without revealing it:
 * "xoxb-…4f2a". Settings screens must never echo the real value back.
 */
export function maskSecret(plain: string): string {
  const s = plain.trim();
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/** Constant-time compare, for verifying webhook signatures later. */
export function safeEqual(a: string, b: string): boolean {
  // 長さが違う時点で false を返すと、比較にかかる時間から秘密の長さが漏れる。
  // 先に固定長のダイジェストへ落としてから比べれば、入力の長さに関わらず
  // 比較は常に32バイト同士になる。
  const ab = createHash("sha256").update(a, "utf8").digest();
  const bb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ab, bb);
}
