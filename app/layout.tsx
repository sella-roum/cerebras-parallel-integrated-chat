import type React from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

// Vercelが開発したフォント 'Geist' を読み込みます
const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

/**
 * アプリケーションの基本メタデータ
 */
export const metadata: Metadata = {
  title: "Cerebras Parallel Integrated Chat",
  description: "複数のLLMを統合した高機能チャットアプリケーション",
  icons: {
    icon: [
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
};

/**
 * ルートレイアウトコンポーネント
 * すべてのページで共通の <html> と <body> タグを定義します。
 * @param {Readonly<{ children: React.ReactNode }>} props - Reactの子要素
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className={`font-sans antialiased`}>
        {/* アプリケーション本体 */}
        {children}

        {/* useToastフックで使用するトースト（通知）コンポーネント */}
        <Toaster />
      </body>
    </html>
  );
}
