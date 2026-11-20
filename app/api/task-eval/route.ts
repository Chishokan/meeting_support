import { getSession } from '@/lib/core/auth';
import { TASK_EVAL_DEPT } from '@/lib/taskEval';
import { listEvalWeeks } from '@/lib/taskEvalStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 重要タスク評価のダウンロード画面用。評価フォルダにある評価シートと A4版を、週ごとにまとめて返す。
export async function GET() {
  const s = getSession();
  if (!s) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (s.campus !== TASK_EVAL_DEPT) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  const r = await listEvalWeeks();
  if (!r.ok) return Response.json(r, { status: 502 });
  return Response.json(r, { headers: { 'Cache-Control': 'no-store' } });
}
