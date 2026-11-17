import { guard, rememberExams } from '@/lib/moshi/api';
import { loadAll } from '@/lib/moshi/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 本番レベル模試：すべての回の設定と成績を返す（画面側で回・校舎に絞り、集計する）。
export async function GET() {
  const g = guard();
  if ('res' in g) return g.res;
  const r = await loadAll();
  if (!r.ok) return Response.json(r, { status: r.reason === 'not_configured' ? 200 : 502 });
  rememberExams(r.exams);
  return Response.json(r);
}
