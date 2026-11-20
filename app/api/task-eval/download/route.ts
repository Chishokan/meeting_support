import { getSession } from '@/lib/core/auth';
import { contentDisposition, TASK_EVAL_DEPT } from '@/lib/taskEval';
import { downloadEvalFile } from '@/lib/taskEvalStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 重要タスク評価のファイルを渡す。?id=（一覧にあるファイル）&format=xlsx（評価シート）| pdf（A4版）
// 一覧に無い ID は渡さない（評価フォルダの外のファイルは出さない）。
export async function GET(req: Request) {
  const s = getSession();
  if (!s) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (s.campus !== TASK_EVAL_DEPT) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const r = await downloadEvalFile(searchParams.get('id') ?? '', searchParams.get('format') ?? '');
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: r.status });
  return new Response(new Uint8Array(r.body), {
    headers: {
      'Content-Type': r.contentType,
      'Content-Disposition': contentDisposition(r.filename),
      'Cache-Control': 'no-store',
    },
  });
}
