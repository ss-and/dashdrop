/**
 * メール送信。
 *
 * この製品には長らく「メールを送る経路」が無かった。SMTP の設定項目だけが
 * あって、送信処理はどこにも無い——つまり設定した人ほど「送った」と表示され
 * ながら何も届いていなかった。パスワード再設定もメール確認もここが土台なので、
 * まずこの1本を用意する。
 *
 * 設計はひとつだけ徹底する: **送れていないのに送れたと言わない。** 送信結果は
 * 必ず真偽で返し、呼び出し側が「届かなかった」を利用者に伝えられるようにする。
 * 例外は投げない（通知の失敗で、引き金になった操作まで倒してはいけない）。
 */
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

export interface MailInput {
  to: string;
  subject: string;
  /** 本文（プレーンテキスト）。HTMLしか無いメールは読めない環境がある。 */
  text: string;
  /** 任意のHTML本文。 */
  html?: string;
}

export type MailResult = { ok: true } | { ok: false; error: string };

/** SMTP が設定されているか。未設定なら送信を試みずに理由を返す。 */
export function emailConfigured(): boolean {
  return env.SMTP_HOST.length > 0 && env.SMTP_USER.length > 0;
}

let cached: Transporter | null = null;

function transporter(): Transporter {
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 は接続時から TLS、587 は STARTTLS。ポートで決まる作法なので、
    // 設定項目を増やさずにここで分ける。
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    // 送れない相手で延々待たない。呼び出し元は画面の応答を待っている。
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return cached;
}

/** テスト用: キャッシュした接続を捨てる。 */
export function resetMailTransport(): void {
  cached = null;
}

/**
 * 送れなかったときに、**利用者に見せてよい**文面。
 *
 * 以前は「メールの送信設定（SMTP_HOST / SMTP_USER）がされていないため…」を
 * そのまま画面に出していた。受け取るのは経理事務の方で、環境変数名を読んでも
 * できることは何も無い。しかも**自分の入力が悪いのか**と思って黙って閉じる。
 * 原因は運営側にあり、利用者の操作では直らない——それが伝わる文面にする。
 */
export const MAIL_UNAVAILABLE =
  "ただいまメールをお送りできません。こちらの不具合です。表とグラフはそのままお使いいただけますので、少し時間をおいてからお試しください。";

export async function sendMail(input: MailInput): Promise<MailResult> {
  if (!emailConfigured()) {
    // 運用者向けの理由はログに残す。画面には出さない。
    console.error("Mail send skipped: SMTP_HOST / SMTP_USER are not configured");
    return { ok: false, error: MAIL_UNAVAILABLE };
  }
  try {
    await transporter().sendMail({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { ok: true };
  } catch (err) {
    // 宛先や認証情報はログに残さない。
    console.error("Mail send failed:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: "メールを送信できませんでした。時間をおいて再度お試しください。",
    };
  }
}

/* --------------------------- 定型文 --------------------------- */

/**
 * 本文は日本語のプレーンテキストで組む。装飾より、
 * 「誰が・何のために・いつまで有効か・心当たりが無ければどうするか」が要る。
 */
export function passwordResetMail(url: string, expiresInMinutes: number): Omit<MailInput, "to"> {
  return {
    subject: "【DashDrop】パスワード再設定のご案内",
    text: [
      "DashDrop のパスワード再設定のご依頼を受け付けました。",
      "",
      "次のリンクを開いて、新しいパスワードを設定してください。",
      url,
      "",
      `このリンクは ${expiresInMinutes} 分で無効になります。`,
      "",
      "心当たりが無い場合は、このメールを破棄してください。",
      "リンクを開かないかぎり、パスワードは変わりません。",
    ].join("\n"),
  };
}

export function emailVerifyMail(url: string, expiresInHours: number): Omit<MailInput, "to"> {
  return {
    subject: "【DashDrop】メールアドレスの確認",
    text: [
      "DashDrop へのご登録ありがとうございます。",
      "",
      "次のリンクを開いて、メールアドレスの確認を完了してください。",
      url,
      "",
      `このリンクは ${expiresInHours} 時間で無効になります。`,
      "",
      "確認が済むまでは、ダッシュボードの公開リンクを作成できません。",
      "心当たりが無い場合は、このメールを破棄してください。",
    ].join("\n"),
  };
}
