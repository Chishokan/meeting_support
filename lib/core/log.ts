export type Interaction = {
  user: string;
  campus: string;
  input: string;
  output: string;
};

// 会話ログを Google スプレッドシート（Apps Script Web アプリ）へ転記する。
// APPS_SCRIPT_URL 未設定なら送信せず、標準出力のみ（Vercel → Logs で確認可）。
// timeoutMs を渡すと、その時間で送信をあきらめる（時間の上限がある処理で、ログの送信が終わるのを待ちすぎないように）。
export async function logInteraction(i: Interaction, opts: { timeoutMs?: number } = {}): Promise<void> {
  const ts = new Date().toISOString();
  try {
    console.log('[CHAT_LOG]', JSON.stringify({ ts, ...i }));
  } catch {
    // ログ出力失敗は本処理を止めない
  }

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
      body: JSON.stringify({
        action: 'log',
        token: process.env.APPS_SCRIPT_TOKEN || '',
        ts,
        ...i,
      }),
    });
  } catch {
    // 送信失敗は本処理を止めない
  }
}
