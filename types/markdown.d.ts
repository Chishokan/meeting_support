// knowledge/ の Markdown をビルド時に文字列として取り込む（next.config.mjs の webpack 設定）。
declare module '*.md' {
  const content: string;
  export default content;
}
