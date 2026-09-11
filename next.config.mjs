/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // 要項QA は knowledge/ 配下の Markdown を実行時に fs で読む。
    // Next はコードから辿れないファイルをサーバ関数に含めないため、明示的に同梱する。
    // ★ knowledge/ の置き場所を変えたらここも直すこと（変え忘れると本番だけ 0 件になる）。
    outputFileTracingIncludes: {
      '/api/yoko-qa': ['./knowledge/**/*.md'],
    },
  },
};
export default nextConfig;
