import { getSession } from '@/lib/auth';
import { buildMinutesPrompt } from '@/lib/minutesPrompt';
import { sanitizeHistory } from '@/lib/sanitize';
import { cachedMessages, lastUserText, streamClaude, type Msg } from '@/lib/claudeStream';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  // 役割漏れ・空メッセージを除去（自己対話ループの再送を断つ）。
  const messages = sanitizeHistory(raw) as Msg[];
  if (messages.length === 0) return new Response('messages required', { status: 400 });

  return streamClaude({
    label: 'minutes',
    system: buildMinutesPrompt(session.campus, session.name),
    messages: cachedMessages(messages),
    // Sonnet 5 はトークナイザが変わり、同じ日本語テキストで約1.3倍のトークンを使う。
    maxTokens: 6000,
    log: { user: session.name, campus: session.campus, input: `[議事録] ${lastUserText(messages)}` },
  });
}
