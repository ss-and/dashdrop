/**
 * 試行回数の制限。
 *
 * ログインには回数制限が一切無かった。パスワード総当たりが素通りするので、
 * 公開する前に必ず要る。
 *
 * 置き場所はメモリではなく DB。メモリだとインスタンスを増やした時点で意味を
 * 失い、再起動でも消える——攻撃側にとって都合が良い。書き込みはログイン試行の
 * ときだけなので、量は問題にならない。
 *
 * 数え方は固定窓。厳密な滑走窓の方が正確だが、ここで守りたいのは
 * 「1分間に何百回も試せる」を潰すことなので、実装の単純さを採る。
 */
import { db } from "./db";

export interface RateLimitRule {
  /** 窓の長さ（ミリ秒）。 */
  windowMs: number;
  /** 窓の中で許す回数。 */
  max: number;
  /** 超えたときに止める長さ（ミリ秒）。 */
  blockMs: number;
}

/**
 * ログイン。IPと、入力されたメールアドレスの両方で数える。
 * 片方だけだと、IPを変えれば1アカウントを狙い撃ちでき、逆に1つのIPから
 * 多数のアカウントを薄く試す攻撃も通ってしまう。
 */
export const LOGIN_RULE: RateLimitRule = {
  windowMs: 10 * 60_000,
  max: 10,
  blockMs: 15 * 60_000,
};

/** パスワード再設定・確認メールの再送。メール爆撃に使われないための上限。 */
export const EMAIL_SEND_RULE: RateLimitRule = {
  windowMs: 60 * 60_000,
  max: 5,
  blockMs: 60 * 60_000,
};

/** サインアップ。1つのIPからの大量作成を止める。 */
export const SIGNUP_RULE: RateLimitRule = {
  windowMs: 60 * 60_000,
  max: 5,
  blockMs: 60 * 60_000,
};

/**
 * 外部AIを叩く経路（取り込みの下見・ダッシュボード生成）。
 *
 * ここだけは「守りたいもの」が違う。総当たりではなく**実費**——1回叩くたびに
 * Anthropic へ課金が発生する。しかも入口は無料アカウントのホームで、
 * ファイルを置くたび毎回呼ばれる。上限が無ければ1アカウントで無限に積めた。
 *
 * 数えるのはIPではなく **workspaceId**。ログイン済みの経路なので相手は確実に
 * 分かるし、IPで数えると同じ会社の全員が1つの枠を取り合い、逆に1人が
 * 回線を変えれば何度でも増やせる——課金の主体はワークスペースなので、
 * そこで数えるのが実態に合う。
 *
 * 1時間20回。人が手でファイルを置く速さなら当たらない一方、
 * 自動で回されたときは1時間で頭打ちになる。
 */
export const AI_RULE: RateLimitRule = {
  windowMs: 60 * 60_000,
  max: 20,
  blockMs: 60 * 60_000,
};

export interface RateLimitResult {
  allowed: boolean;
  /** 残り回数（allowed が false のときは 0）。 */
  remaining: number;
  /** 解除される時刻。allowed が true なら null。 */
  retryAt: Date | null;
}

/**
 * 1回ぶん数えて、通してよいかを返す。
 *
 * DBが落ちているときは**通す**。認証基盤の付随機能が、ログインそのものを
 * 巻き添えにして全員を締め出す方が損害が大きい（数えられないことは
 * ログに残す）。
 */
export async function consume(
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  try {
    const row = await db.rateLimit.findUnique({ where: { key } });

    if (row?.blockedUntil && row.blockedUntil > now) {
      return { allowed: false, remaining: 0, retryAt: row.blockedUntil };
    }

    const windowExpired =
      !row || now.getTime() - row.windowStart.getTime() >= rule.windowMs;

    if (windowExpired) {
      await db.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, windowStart: now, blockedUntil: null },
        update: { count: 1, windowStart: now, blockedUntil: null },
      });
      return { allowed: true, remaining: rule.max - 1, retryAt: null };
    }

    const next = row.count + 1;
    if (next > rule.max) {
      const blockedUntil = new Date(now.getTime() + rule.blockMs);
      await db.rateLimit.update({
        where: { key },
        data: { count: next, blockedUntil },
      });
      return { allowed: false, remaining: 0, retryAt: blockedUntil };
    }

    await db.rateLimit.update({ where: { key }, data: { count: next } });
    return { allowed: true, remaining: rule.max - next, retryAt: null };
  } catch (err) {
    console.error("Rate limit check failed (allowing the request):", err);
    return { allowed: true, remaining: rule.max, retryAt: null };
  }
}

/** 成功したら数えをやめる（正しいパスワードで入れた人を締め出さない）。 */
export async function reset(key: string): Promise<void> {
  try {
    await db.rateLimit.deleteMany({ where: { key } });
  } catch {
    /* 消せなくても、窓が切れれば自然に戻る */
  }
}

/**
 * 呼び出し元のIP。
 *
 * プロキシの後ろに置く前提なので `x-forwarded-for` の**先頭**を採る。
 * 末尾はプロキシ自身のIPで、そこを見ると全員が同じ値になり制限が意味を失う。
 * ヘッダは詐称できるので、これは「同じ相手からの連打を鈍らせる」ためのもので
 * あって、本人確認ではない（だからメールアドレス側でも同時に数える）。
 */
export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || null;
}

/**
 * IP ごとの鍵。相手が分からないときは null を返す。
 *
 * ここで "unknown" のような固定値を返してはいけない。プロキシのヘッダが
 * 付いていない構成だと**全員が同じ鍵を共有する**ことになり、誰かが10回
 * 間違えた瞬間に、その場の全員がログインできなくなる。実際、この画面を
 * 総当たりで試したら自分が締め出された。
 *
 * 相手を特定できないときは、IP側の制限は諦めてメールアドレス側だけで数える
 * （そちらは常に効く）。守りが1枚減るのと、全員が入れなくなるのとでは、
 * 後者の方がはるかに悪い。
 */
export function ipKey(req: Request, prefix: string): string | null {
  const ip = clientIp(req);
  return ip ? `${prefix}:ip:${ip}` : null;
}

/**
 * ワークスペースごとの鍵。
 *
 * `ipKey` と同じく、特定できないときは null（＝数えない）を返す。ただしこちらは
 * ログイン済みの経路でしか使わないので、実際に null になるのは呼び出し側の
 * 組み立てを間違えたときだけ。"unknown" のような固定値を置くと、そこに全社の
 * 呼び出しが集まって全員が同時に止まるので、絶対にやらない。
 */
export function workspaceKey(
  workspaceId: string | null | undefined,
  prefix: string,
): string | null {
  const id = workspaceId?.trim();
  return id ? `${prefix}:ws:${id}` : null;
}

/** 鍵が null（相手を特定できない）なら、数えずに通す。 */
export async function consumeOptional(
  key: string | null,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  if (key === null) return { allowed: true, remaining: rule.max, retryAt: null };
  return consume(key, rule, now);
}

/** 待ち時間を日本語にする。 */
export function retryMessage(retryAt: Date | null, now: Date = new Date()): string {
  if (!retryAt) return "しばらくしてから再度お試しください。";
  const minutes = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 60_000));
  return `${minutes} 分後に再度お試しください。`;
}
