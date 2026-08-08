import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
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
    <html lang="ja" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
