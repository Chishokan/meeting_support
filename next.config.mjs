/** @type {import('next').NextConfig} */
const nextConfig = {
  // knowledge/ の Markdown を import すると、中身が文字列としてコードに埋め込まれる
  //（lib/core/companyKnowledge.ts が COMPANY.md を読むのに使う）。
  // 実行時にファイルを読まないので、下の outputFileTracingIncludes に足さなくても本番で読める。
  webpack(config) {
    config.module.rules.push({ test: /\.md$/, type: 'asset/source' });
    return config;
  },
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
