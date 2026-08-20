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
};

export default nextConfig;
