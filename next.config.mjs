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
};

export default nextConfig;
