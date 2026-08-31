"use client";

/**
 * お問い合わせフォーム。
 *
 * 気をつけたところ:
 *
 * - **送信中は押せなくする。** 二重送信は運営者の受信箱に同じ用件を2通
 *   積むだけで、誰の得にもならない。
 * - **エラーはその場に出す。** 上に赤帯を出して画面外へ流れると、
 *   長い本文を書いた人には「押しても何も起きない」ようにしか見えない。
 * - **成功したらフォームを消す。** 送ったのに入力が残っていると、
 *   届いたのか分からず、もう一度押される。
 * - **文字数を出す。** 上限（4,000字）に当たってから知るのでは遅い。
 */
import { useState } from "react";
import { CONTACT_TOPICS } from "@/lib/contact-topics";

const MAX = 4000;

type State = "idle" | "sending" | "done";

export function ContactForm({ contactEmail }: { contactEmail: string }) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState("sending");
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name"),
          company: fd.get("company"),
          email: fd.get("email"),
          topic: fd.get("topic"),
          message: fd.get("message"),
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        data?: { message?: string };
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "送信に失敗しました。しばらくして再度お試しください。");
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError(
        `通信に失敗しました。ネットワークをご確認のうえ、もう一度お試しください。解決しない場合は ${contactEmail} 宛に直接お送りください。`,
      );
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-lg border border-ink-line bg-paper-raised p-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success-soft text-lg text-success">
          ✓
        </div>
        <h2 className="mt-5 text-xl font-light tracking-[-0.02em] text-ink">
          お問い合わせを受け付けました
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-faint">
          2営業日以内に、ご記入のメールアドレス宛にご返信いたします。
          受付の控えもお送りしましたので、届いていない場合は迷惑メールフォルダを
          ご確認ください。
        </p>
      </div>
    );
  }

  const field =
    "w-full rounded border border-ink-rule bg-paper-raised px-3 py-2.5 text-sm text-ink transition-colors placeholder:text-ink-faint focus:border-khaki-500 focus:outline-none focus:ring-1 focus:ring-khaki-500";
  const label = "block text-2xs font-medium tracking-wide text-ink-soft";

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-lg border border-ink-line bg-paper-raised p-6 sm:p-8"
      noValidate
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className={label} htmlFor="c-name">
            お名前 <span className="text-danger">*</span>
          </label>
          <input id="c-name" name="name" required maxLength={80} className={field} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={label} htmlFor="c-company">
            会社名
          </label>
          <input id="c-company" name="company" maxLength={120} className={field} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={label} htmlFor="c-email">
          メールアドレス <span className="text-danger">*</span>
        </label>
        <input
          id="c-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={field}
        />
        <p className="text-2xs text-ink-faint">ご返信はこちら宛にお送りします。</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={label} htmlFor="c-topic">
          ご用件 <span className="text-danger">*</span>
        </label>
        <select id="c-topic" name="topic" required defaultValue="導入の相談" className={field}>
          {CONTACT_TOPICS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label className={label} htmlFor="c-message">
            お問い合わせ内容 <span className="text-danger">*</span>
          </label>
          <span
            className={`font-mono text-2xs tabular-nums ${
              message.length > MAX ? "text-danger" : "text-ink-faint"
            }`}
          >
            {message.length.toLocaleString("ja-JP")} / {MAX.toLocaleString("ja-JP")}
          </span>
        </div>
        <textarea
          id="c-message"
          name="message"
          required
          rows={7}
          maxLength={MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="いま使っている管理表の形や、お困りのことをお書きください。"
          className={`${field} resize-y leading-relaxed`}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded border border-danger/40 bg-danger-soft px-3.5 py-2.5 text-sm leading-relaxed text-danger"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={state === "sending"}
          className="inline-flex items-center gap-1.5 rounded bg-khaki-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-khaki-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khaki-500 disabled:opacity-60"
        >
          {state === "sending" ? "送信しています…" : "送信する"}
          {state !== "sending" && (
            <span aria-hidden="true" className="text-ink-line">
              ›
            </span>
          )}
        </button>
        <p className="text-2xs leading-relaxed text-ink-faint">
          送信により
          <a
            href="/privacy"
            className="mx-0.5 text-khaki-700 underline underline-offset-2 hover:text-khaki-600"
          >
            プライバシーポリシー
          </a>
          に同意したものとみなします。
        </p>
      </div>
    </form>
  );
}
