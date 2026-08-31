/**
 * サイトの窓口。
 *
 * これが無かった。試したい人も、詰まった人も「聞く先が無い」だけで
 * 黙って離れる——しかもこちらには何も残らないので、何人逃したかすら
 * 分からない。作った以上、静かに壊れないように固定しておく。
 *
 * 見張るのは4つ:
 *  ① 送れないときに、受け付けたふりをしない
 *  ② 控えに本文を載せない（迷惑メールの踏み台にされる）
 *  ③ 応答を待たせない（サインアップで踏んだのと同じ穴）
 *  ④ 導線が実在する（ヘッダ・フッタ・料金ページから辿れる）
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { CONTACT_TOPICS } from "@/lib/contact-topics";
import { contactAckMail, contactNoticeMail } from "@/lib/email";
import { CONTACT_EMAIL } from "@/lib/legal";
import { CONTACT_RULE } from "@/lib/rate-limit";

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const route = code("src/app/api/contact/route.ts");

describe("① 送れないときに、受け付けたふりをしない", () => {
  /**
   * ここで 200 を返すと、書いた人は届いたと思って待ち続ける。
   * 「送った」と言って届いていないのが、いちばん悪い。
   */
  it("送信手段が無ければ 503 を返し、別の連絡先を出す", () => {
    expect(route).toContain("emailConfigured()");
    const guard = route.slice(route.indexOf("if (!emailConfigured())"));
    /*
     * **最初の return** を見る。窓を toContain で眺めるだけだと、
     * その手前に `return ok(...)` を差し込む変異を素通しした——
     * 元の文字列がうしろに残っているので条件は成立してしまう。
     */
    const first = guard.slice(guard.indexOf("return"), guard.indexOf(";", guard.indexOf("return")) + 1);
    expect(first, "最初に返しているのが失敗ではない").toContain("fail(");
    expect(first).toContain("503");
    expect(first).toContain("CONTACT_EMAIL");
  });

  it("その連絡先が実在する", () => {
    expect(CONTACT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });
});

describe("② 控えに本文を載せない", () => {
  /**
   * 控えに送信者の本文をそのまま返すと、送信元アドレスを詐称した第三者宛の
   * 迷惑メール送信に使える。差出人が自ドメインになるぶん、こちらのドメインの
   * 評判が落ちる。控えは「受け付けたこと」と連絡先だけ。
   */
  it("控えは、渡された本文を含まない", () => {
    const secret = "これは本文に書いた秘密の一文です";
    const ack = contactAckMail("山田");
    expect(ack.text).not.toContain(secret);
    expect(ack.text).toContain("山田");
  });

  it("運営者宛には本文をそのまま載せる（読むのは運営者だけ）", () => {
    const notice = contactNoticeMail({
      name: "山田",
      company: "山田製作所",
      email: "a@example.invalid",
      topic: "導入の相談",
      message: "取り込みたい表が3つあります",
    });
    expect(notice.text).toContain("取り込みたい表が3つあります");
    expect(notice.text).toContain("a@example.invalid");
  });
});

describe("③ 応答を待たせない・受信箱を守る", () => {
  it("送信は応答の後ろに回している", () => {
    expect(route).toContain('from "next/server"');
    const at = route.indexOf("after(");
    expect(at).toBeGreaterThan(-1);
    for (const m of [...route.matchAll(/sendMail\(/g)]) {
      expect(m.index, "sendMail が after() の外にある").toBeGreaterThan(at);
    }
  });

  it("回数の上限がある（受信箱が埋まると本物が埋もれる）", () => {
    // import に名前が残るので、**呼び出し**の形で見る。
    expect(route).toMatch(/consumeOptional\([^;]*CONTACT_RULE/);
    expect(CONTACT_RULE.max).toBeGreaterThan(0);
    expect(CONTACT_RULE.max).toBeLessThanOrEqual(10);
  });

  it("送信の失敗を運用者に残す", () => {
    expect(route).toContain("reportError");
  });
});

describe("④ 導線が実在する", () => {
  it("お問い合わせのページがある", () => {
    expect(existsSync("src/app/(marketing)/contact/page.tsx")).toBe(true);
  });

  it("ヘッダとフッタから辿れる", () => {
    const layout = readFileSync("src/app/(marketing)/layout.tsx", "utf8");
    const hits = layout.match(/href="\/contact"/g) ?? [];
    expect(hits.length, "ヘッダとフッタの両方に要る").toBeGreaterThanOrEqual(2);
  });

  /**
   * 【回帰】ヘッダの「機能」は `/#features` を指しているが、トップページを
   * 書き直したときにその id ごと消してしまい、**押しても何も起きない**
   * リンクになっていた。押した人には壊れているとしか見えない。
   */
  it("ヘッダのリンクの行き先が、実際に存在する", () => {
    const layout = readFileSync("src/app/(marketing)/layout.tsx", "utf8");
    /*
     * **コメントを外してから**見る。素のまま探すと、この穴を説明している
     * こちらのコメント（`id="features"` と書いてある）に当たって通ってしまう。
     * 実際にそれで変異を素通しした。
     */
    const page = code("src/app/(marketing)/page.tsx");
    const anchors = [...layout.matchAll(/href="\/#([a-z-]+)"/g)];
    // 照合が0件だと、下のループが1度も回らずに通る（空ループ）。
    expect(anchors.length, "ページ内リンクが1つも見つからない").toBeGreaterThan(0);
    for (const m of anchors) {
      expect(page, `#${m[1]} の行き先が無い`).toContain(`id="${m[1]}"`);
    }
  });

  it("用件は選択式（自由記述だと返信の優先度が付けられない）", () => {
    expect(CONTACT_TOPICS.length).toBeGreaterThan(2);
    expect(route).toContain("z.enum(CONTACT_TOPICS)");
  });
});
