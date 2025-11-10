/**
 * PostCSSの設定ファイル
 * @type {import('postcss-load-config').Config}
 */
const config = {
  plugins: {
    /**
     * Tailwind CSS v4
     * `@tailwindcss/postcss` をプラグインとして登録します。
     * これにより、Tailwindの `@theme` や `@apply` などのディレクティブが
     * ビルド時に標準的なCSSに変換されます。
     */
    "@tailwindcss/postcss": {},
  },
};

export default config;
