/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    /**
     * Vercel AI SDK 3.x や React 19 など、
     * 一部の先進的なライブラリでは型エラーが発生する可能性があるため、
     * ビルド時の型チェックを一時的に無視します。
     * (ローカル開発では `pnpm lint` やエディタで型チェックが実行されます)
     */
    ignoreBuildErrors: false,
  },
  images: {
    /**
     * Next.jsの画像最適化（`next/image`）を無効にします。
     * `next export`（静的エクスポート）を使用する場合や、
     * Cloudflare Pages / Vercel Hobby 以外の環境で
     * `sharp` ライブラリなしでデプロイする場合に必要です。
     */
    unoptimized: true,
  },
};

export default nextConfig;
