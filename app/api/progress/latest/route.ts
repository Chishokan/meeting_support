import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ダッシュボード用：直近の中間報告者（部門・報告者・日時）の一覧を GAS から取得する。
// 「中間報告状況」シートを新しい順に返す（GAS action:'listProgress'）。
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured', items: [] });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'listProgress', token: process.env.APPS_SCRIPT_TOKEN || '' }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true) return Response.json({ ok: true, items: j.items ?? [] });
    return Response.json({ ok: false, reason: (j && j.reason) || 'upstream_error', items: [] }, { status: 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error', items: [] }, { status: 502 });
  }
}
