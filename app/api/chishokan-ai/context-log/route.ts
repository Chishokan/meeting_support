// 智翔館AI：コンテキスト欄の追加・置き換え・前の版に戻す・削除を、会話ログに1行残す（名前・字数・はじめの200字）。
// 全文は質問のたびには記録しない（スプレッドシートが大きくなりすぎないように）。決まりは lib/chishokanAi/pinnedContext.ts。

import { getSession } from '@/lib/core/auth';
import { logInteraction } from '@/lib/core/log';
import { canUseChishokanAi } from '@/lib/chishokanAi/access';
import { checkPinLog, pinLogEntry } from '@/lib/chishokanAi/pinnedContext';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return new Response('unauthorized', { status: 401 });
  if (!canUseChishokanAi(session.name)) return new Response('forbidden', { status: 403 });
  const entry = checkPinLog(await req.json().catch(() => null));
  if (!entry) return new Response('bad request', { status: 400 });
  try {
    await logInteraction({ user: session.name, campus: session.campus, ...pinLogEntry(entry) });
  } catch {}
  return Response.json({ ok: true });
}
