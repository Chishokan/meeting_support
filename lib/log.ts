export type Interaction = {
  user: string;
  campus: string;
  input: string;
  output: string;
};

// テスト版: 構造化ログを標準出力へ（Vercel のダッシュボード → Logs で確認できる）。
// 本番で人事評価に使う場合は、この関数の中で DB（Vercel Postgres 等）へ保存する。
export function logInteraction(i: Interaction): void {
  const record = { ts: new Date().toISOString(), ...i };
  try {
    console.log('[CHAT_LOG]', JSON.stringify(record));
  } catch {
    // ログ失敗は本処理を止めない
  }
}
