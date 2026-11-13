// 智翔館AI：回答への評価（👍 / 👎 と、👎 のときのひとこと）を会話ログに残す。
// 回答の質を確かめ、足りない資料や回答方針の直しどころを見つけるのに使う。

import { getSession } from '@/lib/core/auth';
import { logInteraction } from '@/lib/core/log';
import { canUseChishokanAi } from '@/lib/chishokanAi/access';

export const runtime = 'nodejs';

const cut = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  if (!canUseChishokanAi(session.name)) return new Response('forbidden', { status: 403 });
  const body = await req.json().catch(() => ({}));
  const rating = body?.rating === 'up' ? '👍' : body?.rating === 'down' ? '👎' : '';
  if (!rating) return new Response('rating required', { status: 400 });
  const comment = cut(body?.comment, 500).trim();
  const question = cut(body?.question, 1000);
  const conversationId = typeof body?.conversationId === 'string' && /^[\w-]{4,40}$/.test(body.conversationId) ? body.conversationId : '';
  const turn = typeof body?.turn === 'number' && Number.isFinite(body.turn) ? Math.floor(body.turn) : 0;
  const convoNote = conversationId ? `（会話: ${conversationId}${turn ? `・${turn}回目` : ''}）` : '';
  const sources = Array.isArray(body?.sources) ? body.sources.filter((s: unknown) => typeof s === 'string').slice(0, 20).join('、') : '';
  try {
    await logInteraction({
      user: session.name,
      campus: session.campus,
      input: `[智翔館AI・評価]${convoNote} ${rating}${comment ? ` ${comment}` : ''}\n（質問）${question}${sources ? `\n（読んだ資料）${sources}` : ''}`,
      output: cut(body?.answer, 4000),
    });
  } catch {}
  return Response.json({ ok: true });
}
