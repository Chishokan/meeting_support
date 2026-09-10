import { getSession } from '@/lib/auth';

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

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured' });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveReview',
        token: process.env.APPS_SCRIPT_TOKEN || '',
        ts: new Date().toISOString(),
        campus: session.campus,
        user: session.name,
        content,
      }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true) return Response.json({ ok: true });
    return Response.json({ ok: false, reason: (j && j.reason) || 'upstream_error' }, { status: 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }
}
