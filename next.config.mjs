/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // 要項QA は knowledge/ 配下の Markdown を実行時に fs で読む。
    // Next はコードから辿れないファイルをサーバ関数に含めないため、明示的に同梱する。
    // ★ knowledge/ の置き場所を変えたらここも直すこと（変え忘れると本番だけ 0 件になる）。
    outputFileTracingIncludes: {
      '/api/yoko-qa': ['./knowledge/**/*.md'],
      // 部門会議議事録の文字起こしは GLOSSARY.md の社内用語をヒントとして読む
      //（lib/transcribeVocab.ts）。外すと本番だけ用語が効かなくなる。
      '/api/dept-minutes/transcribe': ['./knowledge/00_index/GLOSSARY.md'],
    },
  },
};
export default nextConfig;
