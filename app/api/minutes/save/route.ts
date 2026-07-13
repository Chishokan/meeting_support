import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

// 議事録を Google スプレッドシートへ保存する。
// 既存のログ用 Apps Script（APPS_SCRIPT_URL）に action:'saveMinutes' を送る。
// APPS_SCRIPT_URL 未設定でもアプリは壊れない（フロント側は localStorage に保持済み）。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured' });

  const body = await req.json().catch(() => ({}));
  const payload = {
    action: 'saveMinutes',
    token: process.env.APPS_SCRIPT_TOKEN || '',
    ts: new Date().toISOString(),
    campus: session.campus,
    user: session.name,
    title: String(body?.title ?? ''),
    content: String(body?.content ?? ''),
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return Response.json({ ok: false, reason: 'upstream_error' }, { status: 502 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }
}
