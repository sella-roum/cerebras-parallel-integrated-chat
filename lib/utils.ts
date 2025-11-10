import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind CSSのクラス名を条件付きで結合し、
 * 競合するクラス（例: `p-2` と `p-4`）をマージ（上書き）します。
 * shadcn/uiの必須ユーティリティです。
 *
 * @param {...ClassValue[]} inputs - 結合するクラス名のリスト。
 * (例: `cn("p-2", "bg-red-500", true && "font-bold", false && "hidden")`)
 * @returns {string} マージされた最終的なクラス名の文字列
 */
export function cn(...inputs: ClassValue[]): string {
  // 1. clsx: 'font-bold', true && 'text-lg' のような条件付きクラスを解決
  // 2. twMerge: 'p-2 p-4' -> 'p-4' のように競合するクラスをマージ
  return twMerge(clsx(inputs));
}
