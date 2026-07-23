import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 30;

// 中間報告を Google ドキュメント（事前共有ドキュメント）へ転記する。
// Apps Script（APPS_SCRIPT_URL）に action:'appendProgress' を送り、GAS 側で対象 Doc に
// 「【中間報告】部門／報告者／日付」の見出しで追記し、あわせて「中間報告状況」に記録する。
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
    action: 'appendProgress',
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
    // GAS(ContentService)は失敗時も HTTP 200 を返すため、本文の ok/reason を必ず確認する。
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true) return Response.json({ ok: true });
    return Response.json(
      { ok: false, reason: (j && j.reason) || 'upstream_error' },
      { status: 502 },
    );
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }
}
