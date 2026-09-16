import { getSession } from '@/lib/auth';
import { callGas, gasErrorStatus } from '@/lib/gas';

export const runtime = 'nodejs';

// 議事録を Google スプレッドシートへ保存する。
// 既存のログ用 Apps Script（APPS_SCRIPT_URL）に action:'saveMinutes' を送る。
// APPS_SCRIPT_URL 未設定でもアプリは壊れない（フロント側は localStorage に保持済み）。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const r = await callGas('saveMinutes', {
    ts: new Date().toISOString(),
    campus: session.campus,
    user: session.name,
    title: String(body?.title ?? ''),
    content: String(body?.content ?? ''),
  });
  if (!r.ok) return Response.json(r, { status: gasErrorStatus(r.reason) });
  return Response.json({ ok: true });
}
