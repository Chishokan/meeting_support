import { getSession } from '@/lib/auth';
import { callGas, gasErrorStatus } from '@/lib/gas';

export const runtime = 'nodejs';
export const maxDuration = 30;

// 全体会議の振り返り（感想・気づき・やろうと思ったこと）をスプレッドシートへ記録する。
// Apps Script（APPS_SCRIPT_URL）に action:'saveReview' を送り、「全体会議振り返り」シートに1行追加する。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const content = String(body?.content ?? '').trim();
  if (!content) return Response.json({ ok: false, reason: 'empty' }, { status: 400 });

  const r = await callGas('saveReview', {
    ts: new Date().toISOString(),
    campus: session.campus,
    user: session.name,
    content,
  });
  if (!r.ok) return Response.json(r, { status: gasErrorStatus(r.reason) });
  return Response.json({ ok: true });
}
