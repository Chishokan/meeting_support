export type Interaction = {
  user: string;
  campus: string;
  input: string;
  output: string;
};

// 会話ログを Google スプレッドシート（Apps Script Web アプリ）へ転記する。
// APPS_SCRIPT_URL 未設定なら送信せず、標準出力のみ（Vercel → Logs で確認可）。
export async function logInteraction(i: Interaction): Promise<void> {
  const ts = new Date().toISOString();
  // プレビューデプロイ（feat/* ブランチ）は本番と同じスプレッドへ書くため、
  // 後からテスト分だけ除外できるよう入力の先頭に印を付ける。本番では何も付かない。
  if (process.env.VERCEL_ENV === 'preview') {
    i = { ...i, input: `[preview] ${i.input}` };
  }
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
