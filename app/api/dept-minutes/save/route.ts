import { getSession } from '@/lib/core/auth';
import { saveMinutesToSheet } from '@/lib/deptMinutesSave';
import { deleteJobs } from '@/lib/zoom/minutesStore';

export const runtime = 'nodejs';
export const maxDuration = 30;

// 入力者が確認・編集した議事録を保存する（保存の中身は lib/deptMinutesSave.ts）。
// APPS_SCRIPT_URL 未設定でもアプリは壊れない（画面側は localStorage に保持済み）。
export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const content = String(body?.content ?? '').trim();
  if (!content) return Response.json({ ok: false, reason: 'empty' }, { status: 400 });

  // 事前共有した会議なら、その事前共有に議事録を結び付ける（ダッシュボードの事前共有から外れる）。
  const preshareId = String(body?.preshareId ?? '');
  const r = await saveMinutesToSheet({
    id: String(body?.id ?? ''),
    preshareId,
    campus: session.campus,
    user: session.name,
    meta: (body?.meta ?? {}) as Record<string, unknown>,
    content,
  });

  if (r.ok) {
    // 録画から作った下書き（文字起こし全文を含む）は、議事録を保存したら用済みなので消す。
    if (preshareId) await deleteJobs(preshareId);
    return Response.json({ ok: true, decisions: r.decisions, id: r.id, updated: r.updated });
  }
  if (r.reason === 'not_configured') return Response.json({ ok: false, reason: 'not_configured', decisions: r.decisions });
  return Response.json({ ok: false, reason: r.reason }, { status: 502 });
}
