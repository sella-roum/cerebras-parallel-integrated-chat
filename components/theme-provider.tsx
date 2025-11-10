"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from "next-themes";

/**
 * next-themesライブラリのラッパーコンポーネント。
 * アプリケーションにダークモード/ライトモードの機能を提供します。
 * このコンポーネントはクライアントコンポーネントである必要があります。
 *
 * @param {ThemeProviderProps} props - next-themesの`ThemeProvider`が受け取るProps
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  // `app/layout.tsx` が "use client" ではないため、
  // このコンポーネントでラップしてクライアント機能（テーマ切替）を提供します。
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
