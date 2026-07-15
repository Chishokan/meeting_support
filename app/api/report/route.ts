import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

// 事前報告を Google ドキュメントへ転記する。
// Apps Script（APPS_SCRIPT_URL）に action:'appendReport' を送り、GAS 側で対象 Doc に追記する。
// APPS_SCRIPT_URL 未設定なら not_configured を返す（アプリは壊れない）。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const content = String(body?.content ?? '').trim();
  if (!content) return Response.json({ ok: false, reason: 'empty' }, { status: 400 });

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured' });

  const payload = {
    action: 'appendReport',
    token: process.env.APPS_SCRIPT_TOKEN || '',
    ts: new Date().toISOString(),
    campus: session.campus,
    user: session.name,
    content,
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
