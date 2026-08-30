/**
 * 1,000人が登録する日に、認証の出口で人が消えないか。
 *
 * 実際にブラウザで新規登録から歩いて見つかった4つを固定する。どれも
 * 例外を出さず、テストも通り、**画面も一見動いている**ように見える形で壊れていた。
 *
 *   ① /forgot が、登録済みのときだけ 502 を返していた
 *      → 応答が利用者から見て逆（本物の顧客だけがエラー）
 *      → **そのアドレスが登録済みかどうかを外から判定できた**
 *   ② 送れなかった理由に SMTP_HOST / SMTP_USER が入っていた
 *      → 受け取るのは経理事務の方。環境変数名を読んでもできることは無い
 *   ③ 確認メールの再送は、送信に失敗しても回数の枠を1つ消費していた
 *      → 運営側の不具合で5回失敗した人が、6回目に60分締め出される
 *   ④ 確認リンクの結果を表示する画面が存在しなかった
 *      → 成功しても「できました」が出ず、失敗しても理由が出ない
 *
 * ここではソースそのものを見張る。どれも**実行しても落ちない**種類の壊れ方で、
 * 振る舞いのテストでは捕まえにくいため。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MAIL_UNAVAILABLE } from "@/lib/email";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * コメントを外したソース。
 *
 * このリポジトリのコメントには「以前どう壊れていたか」が書いてある。
 * 素朴に文字列を探すと、**直したことを説明している文章のほうに当たる**
 * （実際に 502 と /home?verify で踏んだ）。見張りたいのはコードなので、
 * 行コメントとブロックコメントを落としてから見る。
 */
function code(p: string): string {
  return read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* ========================================================================== */
describe("① /forgot が登録の有無を漏らさない", () => {
  const src = code("src/app/api/auth/forgot/route.ts");

  /**
   * 送信手段の有無は、アカウントの有無と関係が無い。だから利用者を探す前に
   * 返してよい。順序が逆だと「登録があった → 送信に失敗した → 502」になり、
   * ステータスコードが名簿の答えになる。
   */
  it("利用者を探す前に、送信手段の有無で返している", () => {
    const guard = src.indexOf("emailConfigured()");
    const lookup = src.indexOf("db.user.findUnique");
    expect(guard).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(lookup);
  });

  /** 登録済みの人だけが受け取るステータスコードがあってはいけない。 */
  it("送信に失敗しても 502 を返さない", () => {
    expect(src).not.toContain("502");
  });

  it("送信の失敗は、利用者ではなく運用者に知らせる", () => {
    expect(src).toContain("reportError");
  });

  /** 最後は必ず、登録の有無に関わらず同じ形で返る。 */
  it("成功の応答は1か所だけ（分岐で文面が割れない）", () => {
    const oks = src.match(/return ok\(/g) ?? [];
    expect(oks.length).toBe(2); // 送信手段なし / 通常。どちらも 200
  });
});

/* ========================================================================== */
describe("② 利用者に環境変数名を見せない", () => {
  it("送れないときの文面に SMTP_HOST / SMTP_USER が入っていない", () => {
    expect(MAIL_UNAVAILABLE).not.toContain("SMTP");
    expect(MAIL_UNAVAILABLE).not.toContain("_");
  });

  it("原因が運営側にあることが伝わる", () => {
    // 「自分の入力が悪いのか」と思わせない。ここが伝わらないと黙って閉じる。
    expect(MAIL_UNAVAILABLE).toContain("こちらの不具合");
  });

  /** 送れなくても、製品の芯（表とグラフ）は使えることを添える。 */
  it("いま何ができるかを添えている", () => {
    expect(MAIL_UNAVAILABLE).toMatch(/表とグラフ|お使いいただけ/);
  });

  it("email.ts のどの文面にも環境変数名が残っていない", () => {
    const src = code("src/lib/email.ts");
    // 返す文字列（error: "..."）に SMTP が入っていないこと。
    const returned = src.match(/error:\s*"[^"]*"/g) ?? [];
    for (const line of returned) expect(line).not.toContain("SMTP");
  });
});

/* ========================================================================== */
describe("③ 失敗した送信で、唯一の出口を閉じない", () => {
  const src = code("src/app/api/auth/resend-verification/route.ts");

  it("送信に失敗したら回数の枠を戻す", () => {
    expect(src).toContain("reset(");
  });

  /**
   * 枠を戻すのは**失敗したときだけ**。成功時にも戻すと、回数制限そのものが
   * 意味を失い、メール爆撃に使われる。
   */
  it("枠を戻すのは失敗したときだけ", () => {
    const failBranch = src.slice(src.indexOf("if (!res.ok)"));
    expect(failBranch).toContain("reset(");
    // 成功を返す行より前に reset があること（＝失敗の分岐の中）。
    expect(failBranch.indexOf("reset(")).toBeLessThan(
      failBranch.indexOf("return ok("),
    );
  });

  it("数える処理は送信の前のまま（叩かれる回数自体は抑える）", () => {
    expect(src.indexOf("consume(")).toBeLessThan(src.indexOf("sendMail("));
  });
});

/* ========================================================================== */
describe("④ 確認リンクの結果が画面に出る", () => {
  const route = code("src/app/api/auth/verify/route.ts");

  it("結果を表示する画面へ送っている", () => {
    expect(route).toContain("/verified?ok=1");
    expect(route).toContain("/verified?ok=0");
  });

  /**
   * 【回帰】`/home?verify=…` に送っていたが、その値を読む画面が無かった。
   * さらに /home は保護対象なので、メールをスマホで開いた人は
   * /login へ弾かれて結果ごと消えていた。
   */
  it("保護されたページに結果を載せて送らない", () => {
    expect(route).not.toContain("/home?verify");
  });

  it("送り先のページが実在し、成功と失敗を出し分ける", () => {
    const page = code("src/app/(auth)/verified/page.tsx");
    expect(page).toContain("ok === \"1\"");
    expect(page).toContain("メールアドレスを確認しました");
    // 失敗したときは、次にどうすればよいかを書く。
    expect(page).toMatch(/もう一度お送り|再送/);
  });

  /**
   * 失敗の理由（無効・期限切れ・使用済み）は分けない。
   * 区別は攻撃側にしか役に立たない。
   */
  it("失敗の理由を細かく出し分けていない", () => {
    const page = code("src/app/(auth)/verified/page.tsx");
    expect(page).not.toContain("使用済みです");
    expect(route).not.toMatch(/expired|used|invalid_token/);
  });
});

/* ========================================================================== */
describe("⑤ メールの送信で、応答を待たせない", () => {
  /**
   * nodemailer の待ち時間は 接続10秒・挨拶10秒・通信15秒（src/lib/email.ts）。
   * SMTP が健康なら数百ミリ秒なので、手元でも少人数でも絶対に気づかない。
   * 詰まったときだけ、**登録した人が最大25秒、白い画面を見る**。
   * アカウントはとっくにできているのに本人には「固まった」としか見えないので、
   * 再読み込みしてもう一度登録し、「既に登録されています」に当たる。
   *
   * `after()` は応答を返したあとに走る（Vercel が関数を生かしておく）。
   */
  const signup = code("src/app/api/auth/signup/route.ts");
  const forgot = code("src/app/api/auth/forgot/route.ts");

  it("サインアップは、確認メールを応答の後ろに回す", () => {
    expect(signup).toContain('from "next/server"');
    const at = signup.indexOf("after(");
    expect(at, "after() が無い").toBeGreaterThan(-1);
    // 送信の呼び出しが全部 after() の内側にあること。
    for (const m of [...signup.matchAll(/sendMail\(/g)]) {
      expect(m.index, "sendMail が after() の外にある").toBeGreaterThan(at);
    }
  });

  it("セッションのCookieは応答に載る（after より前で設定する）", () => {
    // after() の中で設定しても、応答はもう出たあとなので載らない。
    //
    // 位置だけを比べていると、**行ごと消えた**ときに indexOf が -1 を返して
    // 「どの位置より前」も成立してしまう（実際にその変異を素通しした）。
    // 在ることを先に確かめる。
    const cookie = signup.indexOf("setSessionCookie(");
    expect(cookie, "setSessionCookie が無い").toBeGreaterThan(-1);
    expect(cookie).toBeLessThan(signup.indexOf("after("));
  });

  /**
   * `sendMail` は失敗しても**例外を投げず** `{ ok: false }` を返す。
   * 戻り値を捨てていたので try/catch には何も入らず、送れていないのに
   * 証跡が1行も残らなかった。気づく手段が「お客さまに言われる」しか無い。
   */
  it("サインアップは、送信の失敗を運用者に残す", () => {
    expect(signup).toContain("if (!res.ok)");
    expect(signup).toContain("reportError");
  });

  /**
   * 【回帰】/forgot は名簿の漏れをステータスコードでは塞いだが、
   * **時間の形で残っていた**。登録済みだけが送信を待つので、
   * 同じ文面・同じコードでも応答時間で判別できた。
   */
  it("/forgot は、登録の有無で応答時間が変わらない", () => {
    const at = forgot.indexOf("after(");
    expect(at, "after() が無い").toBeGreaterThan(-1);
    for (const m of [...forgot.matchAll(/sendMail\(/g)]) {
      expect(m.index, "sendMail が after() の外にある").toBeGreaterThan(at);
    }
    // 応答は今までどおり、どちらの枝でも同じ1か所から返る。
    expect(forgot).toContain("return ok({ message: ALWAYS })");
  });

  /**
   * 再送（/api/auth/resend-verification）は **待って良い**。
   * 送信の成否で回数の枠を戻すかどうかが決まる（③）ので、結果が要る。
   * ここを after() に変えると枠の管理が壊れるため、そうなっていないことを固定する。
   */
  it("再送は結果を待つ（回数の枠を戻す判断に要る）", () => {
    const resend = code("src/app/api/auth/resend-verification/route.ts");
    expect(resend).not.toContain("after(");
    expect(resend).toContain("if (!res.ok)");
    expect(resend).toContain("reset(");
  });
});
