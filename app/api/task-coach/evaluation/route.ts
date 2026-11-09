import { getSession } from '@/lib/core/auth';
import { COACH_DEPT, COACH_SCHOOLS, planDates } from '@/lib/taskCoach';
import { getEvaluation } from '@/lib/taskCoachStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// AI壁打ちの画面用。選んだ校舎の評価（重要タスク評価シートの校舎タブ）と、行動計画に書ける日付を返す。
// 校舎を選び直したときは評価シートを読み直す（fresh=1）。
export async function GET(req: Request) {
  const s = getSession();
  if (!s) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (s.campus !== COACH_DEPT) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const school = searchParams.get('school') ?? '';
  if (!COACH_SCHOOLS.includes(school)) return Response.json({ ok: false, reason: 'bad_school' }, { status: 400 });
  const r = await getEvaluation(school, searchParams.get('fresh') === '1');
  if (!r.ok) return Response.json(r, { status: 502 });
  return Response.json({ ok: true, evaluation: r.evaluation, dates: planDates() });
}
