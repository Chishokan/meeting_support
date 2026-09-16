import { getSession } from '@/lib/auth';
import { callGas } from '@/lib/gas';
import { buildProgressPrompt } from '@/lib/progressPrompt';
import { sanitizeHistory } from '@/lib/sanitize';
import { cachedMessages, lastUserText, streamClaude, type Msg } from '@/lib/claudeStream';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 管理部門が保存した「この部門の定例項目」を GAS から取得する。未設定・失敗時は null（＝初期値を使う）。
async function fetchSavedItems(campus: string): Promise<string[] | null> {
  const r = await callGas('getProgressItems');
  if (!r.ok) return null;
  const map = r.data.items && typeof r.data.items === 'object' ? (r.data.items as Record<string, unknown>) : null;
  const arr = map && Array.isArray(map[campus]) ? (map[campus] as unknown[]) : null;
  return arr ? arr.map((s) => String(s)) : null;
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  // 役割漏れ・空メッセージを除去（既に汚れた履歴が送られても自己対話ループを断つ）。
  const messages = sanitizeHistory(raw) as Msg[];
  if (messages.length === 0) return new Response('messages required', { status: 400 });

  const savedItems = await fetchSavedItems(session.campus);

  return streamClaude({
    label: 'progress',
    system: buildProgressPrompt(session.campus, session.name, savedItems),
    messages: cachedMessages(messages),
    // Sonnet 5 はトークナイザが変わり、同じ日本語テキストで約1.3倍のトークンを使う。
    // 旧 4000 のままだと確定ブロック（＝＝＝ 中間報告 ＝＝＝）の途中で切れうるため引き上げる。
    maxTokens: 6000,
    log: { user: session.name, campus: session.campus, input: lastUserText(messages) },
  });
}
