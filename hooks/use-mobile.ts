"use client";

import * as React from "react";

/**
 * モバイルデバイスのブレークポイント（この値 *未満* がモバイルと判定されます）
 */
const MOBILE_BREAKPOINT = 768; // (md)

/**
 * ビューポートがモバイルサイズ（`MOBILE_BREAKPOINT`未満）かどうかを
 * リアルタイムで判定するカスタムフック。
 *
 * @returns {boolean} モバイルサイズの場合は `true`、それ以外の場合は `false`。
 * サーバーサイドレンダリング中またはハイドレーション前は `undefined` (から `false` に解決)。
 */
export function useIsMobile(): boolean {
  // 初期値は undefined にし、クライアントでのマウント後に判定
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    // マッチメディアAPI
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

    /**
     * 現在のウィンドウ幅に基づいて `isMobile` state を更新する関数
     */
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    // リスナーを登録
    mql.addEventListener("change", onChange);

    // --- クライアントでの初回マウント時 ---
    // 1. まず現在の状態を判定してセット
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);

    // 2. クリーンアップ関数
    return () => mql.removeEventListener("change", onChange);
  }, []); // このEffectはクライアントでのみ一度だけ実行されます

  // !!isMobile とすることで、
  // サーバーサイド/ハイドレーション前の `undefined` は `false` として返されます。
  return !!isMobile;
}

/**
 * @deprecated `useIsMobile` のエイリアス。`useIsMobile` の使用を推奨。
 */
export { useIsMobile as useMobile };
