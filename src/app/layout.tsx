import type { Metadata, Viewport } from "next";
import { Inter, Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

/**
 * 見出し用の書体。
 *
 * 本文と操作画面は Inter のまま（日本語は端末の既定に落ちる）。指摘は
 * 「フォントやら背景やらが微妙」で、実際 Inter は日本語を持たないので、
 * 大きな見出しほど**端末まかせのゴシック**が出て、設計した顔にならない。
 * Mac は ヒラギノ、Windows は 游ゴシック——同じ紙面が別物に見える。
 *
 * Zen Kaku Gothic New は日本語を持つ幾何学系のゴシックで、細いウェイトを
 * 大きく組んだときに輪郭が保つ。**見出しにだけ**使う。本文まで替えると、
 * 読む速さが落ちる（長文は端末が最適化している既定のほうが速い）。
 */
const display = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "DashDrop — スプレッドシート発想の経営ダッシュボード",
    template: "%s · DashDrop",
  },
  description:
    "中小企業の経営者のための、問い合わせ・タスク・週間パフォーマンスをExcel連携で管理するシンプルなSaaS。",
  applicationName: "DashDrop",
};

export const viewport: Viewport = {
  themeColor: "#f7f5ef",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className={`${inter.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
