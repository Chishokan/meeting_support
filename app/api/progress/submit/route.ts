import { getSession } from '@/lib/auth';
import { callGas, gasErrorStatus } from '@/lib/gas';

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

  const r = await callGas('appendProgress', {
    ts: new Date().toISOString(),
    campus: session.campus,
    user: session.name,
    content,
  });
  if (!r.ok) return Response.json(r, { status: gasErrorStatus(r.reason) });
  return Response.json({ ok: true });
}
