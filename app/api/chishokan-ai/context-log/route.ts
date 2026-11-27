// 智翔館AI：コンテキスト欄の追加・置き換え・前の版に戻す・削除を、会話ログに1行残す（名前・字数・はじめの200字）。
// 全文は質問のたびには記録しない（スプレッドシートが大きくなりすぎないように）。決まりは lib/chishokanAi/pinnedContext.ts。

import { getSession } from '@/lib/core/auth';
import { logAi } from '@/lib/chishokanAi/aiLog';
import { canUseChishokanAi } from '@/lib/chishokanAi/access';
import { checkPinLog, pinLogEntry } from '@/lib/chishokanAi/pinnedContext';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  if (!canUseChishokanAi(session)) return new Response('forbidden', { status: 403 });
  const entry = checkPinLog(await req.json().catch(() => null));
  if (!entry) return new Response('bad request', { status: 400 });
  const e = pinLogEntry(entry);
  try {
    await logAi(
      {
        user: session.name,
        campus: session.campus,
        email: session.email,
        kind: 'コンテキスト',
        conversationId: entry.conversationId,
        question: e.input.replace(/^\[[^\]]*\](（会話: [^）]*）)?\s*/, ''),
        answer: e.output,
      },
      e,
    );
  } catch {}
  return Response.json({ ok: true });
}
