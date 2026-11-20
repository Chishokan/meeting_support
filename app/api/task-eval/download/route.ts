import { getSession } from '@/lib/core/auth';
import { contentDisposition, TASK_EVAL_DEPT } from '@/lib/taskEval';
import { downloadEvalPdf } from '@/lib/taskEvalStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 重要タスク評価の A4版（PDF）を渡す。?id=（一覧にある A4版の ID）
// 一覧に無い ID は渡さない（評価フォルダの外のファイルや、評価シートは出さない）。
export async function GET(req: Request) {
  const s = getSession();
  if (!s) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (s.campus !== TASK_EVAL_DEPT) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const r = await downloadEvalPdf(searchParams.get('id') ?? '');
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: r.status });
  return new Response(new Uint8Array(r.body), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(r.filename),
      'Cache-Control': 'no-store',
    },
  });
}
