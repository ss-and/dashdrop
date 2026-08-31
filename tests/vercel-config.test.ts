/**
 * デプロイ先の設定が、書いてある約束と食い違っていないか。
 *
 * vercel.json はテストもコンパイルも通らない場所にあるので、間違っていても
 * 誰も気づけない。ここで固定するのは2つ。
 *
 *  ① 実行するリージョン
 *     Vercel の既定は iad1（米国東部）。お客さまは日本にいて、DBも東京か
 *     シンガポールに置く。既定のままだと **1リクエストごとに太平洋を往復**し、
 *     しかも1画面が7〜14クエリ投げるので、その回数だけ往復が積み上がる。
 *     ローカルでは14msで終わる集計が、本番でだけ数秒になる——「なぜか遅い」
 *     という形でしか表に出ないので、最初に固定しておく。
 *
 *  ② cron の時刻表と、コード側の時間予算の対応
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CRON_MAX_DURATION_SECONDS, DEFAULT_BUDGET_MS } from "@/lib/cron";

const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  regions?: string[];
  crons?: { path: string; schedule: string }[];
};

describe("① 実行リージョン", () => {
  /**
   * DBと同じ場所に置くこと。ここが一番効く。
   *
   * 最初は関数を東京（hnd1）に、DBは Neon の既定でバージニア（us-east-1）に
   * 作られた。**これが一番遅い組み合わせ**で、1画面が7〜14クエリ投げるたびに
   * 太平洋を往復する（150ms × 14 で2秒）。利用者に近いかどうかより、
   * **関数とDBが同じ場所にあるか**のほうが効く。
   *
   * Neon は東京を持っていない（cle1/iad1/pdx1/fra1/lhr1/syd1/sin1/gru1）。
   * 最寄りのシンガポール（sin1 = ap-southeast-1）に両方を揃えた。
   * 日本からは片道 約70ms が1回だけ乗る。静的ファイルは東京のCDNから出る。
   */
  it("DBと同じシンガポール（sin1）で動かす", () => {
    expect(config.regions).toEqual(["sin1"]);
  });
});

describe("② cron の時刻表", () => {
  const paths = (config.crons ?? []).map((c) => c.path);

  it("アラートとレポートの両方が登録されている", () => {
    expect(paths).toContain("/api/cron/alerts");
    expect(paths).toContain("/api/reports/dispatch");
  });

  /**
   * 画面には「15分ごとに確認します」と書いてある（src/lib/cron-status.ts）。
   * 時刻表を緩めるなら文言も直すこと。片方だけ変わると、約束だけが残る。
   */
  it("アラートは15分ごと", () => {
    const alerts = (config.crons ?? []).find((c) => c.path === "/api/cron/alerts");
    expect(alerts?.schedule).toBe("*/15 * * * *");
  });

  /**
   * Hobby プランの cron は **1日1回まで**で、それより細かい式はデプロイ自体が
   * 失敗する。この時刻表は Pro であることを前提にしている。
   */
  it("Pro を前提にした頻度であることを、ここで明示しておく", () => {
    const perDay = (config.crons ?? []).filter((c) => !/^\d+ \d+ \* \* \*$/.test(c.schedule));
    expect(perDay.length).toBeGreaterThan(0);
  });

  /**
   * ルート側の maxDuration とコード側の予算がずれると、途中で切られて
   * 「何が終わって何が残ったか」が誰にも分からなくなる。
   */
  it("実行時間の予算が、関数の上限より短い", () => {
    expect(DEFAULT_BUDGET_MS).toBeLessThan(CRON_MAX_DURATION_SECONDS * 1000);
    for (const p of [
      "src/app/api/cron/alerts/route.ts",
      "src/app/api/reports/dispatch/route.ts",
    ]) {
      const src = readFileSync(p, "utf8");
      const m = /export const maxDuration = (\d+)/.exec(src);
      expect(Number(m?.[1]), p).toBe(CRON_MAX_DURATION_SECONDS);
    }
  });
});

describe("③ 本番の値を置くファイル名", () => {
  const script = readFileSync("scripts/vercel-setup.sh", "utf8");

  /**
   * 【回帰】最初 `.env.production` という名前で置いたら、**Next.js が本番
   * ビルド時に自動で読み込んで**手元のビルドが落ちた（空欄が .env の値を
   * 上書きして検証に引っかかった）。埋めた状態なら逆に、本番の秘密が手元の
   * ビルド成果物へ入る。Next.js が触らない名前にしておく。
   */
  it("Next.js が自動で読む名前を使っていない", () => {
    const m = /ENV_FILE="\$\{1:-([^}]+)\}"/.exec(script);
    const file = m?.[1];
    expect(file).toBeTruthy();
    for (const reserved of [".env", ".env.local", ".env.production", ".env.development", ".env.test"]) {
      expect(file, "Next.js が読み込む名前").not.toBe(reserved);
    }
  });

  it("そのファイルが .gitignore に入っている", () => {
    const m = /ENV_FILE="\$\{1:-([^}]+)\}"/.exec(script);
    const ignored = readFileSync(".gitignore", "utf8");
    // `.env.*` が全体を覆っている。
    expect(ignored).toMatch(/^\.env\.\*$/m);
    expect(m?.[1]?.startsWith(".env.")).toBe(true);
  });

  /** 値そのものをログに出さない（CI や画面共有に残る）。 */
  it("入れた値を標準出力に出さない", () => {
    expect(script).not.toMatch(/echo\s+"?\$v"?/);
    expect(script).toContain("vercel env ls");
  });
});
