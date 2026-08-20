/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Hide the floating Next.js dev indicator (the small "N" badge) — it is
  // dev-only, but it clutters the UI while designing.
  devIndicators: false,
  eslint: {
    // Lint is run separately in CI; don't block production builds on it.
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: ["xlsx", "@prisma/client", "bcryptjs"],

  /*
   * 開発サーバーのターミナルに「1リクエスト＝1行」を出さない。
   *
   * この行は情報量がほぼ無いのに、開いているタブが1つあるだけで延々と流れる。
   * 実際に困ったのは、サーバー再起動中に開きっぱなしだったタブが再接続を
   * 繰り返し、`GET /home 307` が数十行続いたケース。中身は「未ログインだから
   * ログイン画面へ送った」という正常応答なのに、ログの見た目は障害そのもので、
   * 本物のエラーを探す邪魔にしかならなかった。
   *
   * コンパイル結果とエラー（⨯）は従来どおり出るので、見るべきものは残る。
   */
  logging: {
    incomingRequests: false,
  },

  /*
   * ワークスペースのルートを固定する。ホーム直下にも package-lock.json が
   * あるため、Next が起動のたびに「lockfile が複数ある」と警告を出していた。
   * ここを明示すれば、ホーム側のファイルに触らずに警告だけ消える。
   */
  outputFileTracingRoot: import.meta.dirname,

  /*
   * 本番ビルドの出力先を、開発サーバーと分ける。
   *
   * `next dev` と `next build` は既定でどちらも `.next` に書く。開発サーバーを
   * 動かしたまま `npm run build` を走らせると、ビルドが `.next/static` を
   * 作り直し、動いていた開発サーバーが配っていたチャンクが消える。ブラウザは
   * `_next/static/chunks/*` に 404 を返され、スタイルもJSも当たらない
   * 素のHTMLになる。**エラーは出ない**ので、原因がまったく分からないまま
   * 「アプリが壊れた」ように見える——これで実際に4回止まった。
   *
   * `npm run build` / `npm start` は NEXT_DIST_DIR=.next-build を渡すので、
   * 開発サーバーの `.next` には一切触れない。環境変数が無いときは従来どおり
   * `.next` なので、`next build` を直接叩くホスティング（Vercel 等）の
   * 振る舞いは変わらない。
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  /*
   * セキュリティヘッダ。
   *
   * 何も付いていない状態だと、このアプリは他所の iframe に埋め込めるし、
   * ブラウザ側の防御も一切効かない。公開する前に必ず要る。
   *
   * CSP は「厳しくして壊れる」より「確実に効く範囲で確実に付ける」を採る。
   *  - script-src に 'unsafe-inline' が要る: Next.js は起動用のスクリプトを
   *    インラインで埋め込む。nonce を配るにはミドルウェアで全ページの HTML を
   *    書き換える必要があり、静的最適化を捨てることになる。
   *  - style-src も同じ理由（Recharts が要素に style を直接書く）。
   *  - 逆に **frame-ancestors / object-src / base-uri** は無条件に締められる。
   *    クリックジャッキングと base タグの乗っ取りは、これで実際に止まる。
   *  - connect-src は自分自身のみ。取り込んだデータが外へ送られる経路を
   *    ブラウザ側でも塞ぐ（サーバー側の送信は別経路なので影響しない）。
   */
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    const headers = [
      { key: "Content-Security-Policy", value: csp },
      // frame-ancestors を理解しない古いブラウザ向けの二重化。
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=()",
      },
    ];

    /*
     * HSTS は本番だけ。開発機（http://localhost）に付けると、ブラウザが
     * localhost 全体を https に強制するようになり、他のプロジェクトまで
     * 開けなくなる。しかも一度覚えると消すのが面倒。
     */
    if (process.env.NODE_ENV === "production") {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }

    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
