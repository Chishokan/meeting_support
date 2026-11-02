import { getSession } from '@/lib/core/auth';
import { cleanPlan, COACH_DEPT, COACH_SCHOOLS, planDates } from '@/lib/taskCoach';
import { appendPlan } from '@/lib/taskCoachStore';

export const runtime = 'nodejs';
export const maxDuration = 30;

// AI壁打ちの「行動計画の案」を、秋～冬行動計画の該当セル（校舎×区分×日付）に「★行動」として書き足す。
// 今ある文は消さない。同じ文がすでにあるセルには書かない（二度押し対策）。書いた内容は「AI壁打ち書き込み」シートにも残る。
export async function POST(req: Request) {
  const s = getSession();
  if (!s) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (s.campus !== COACH_DEPT) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const school = String(body?.school ?? '');
  if (!COACH_SCHOOLS.includes(school)) return Response.json({ ok: false, reason: 'bad_school' }, { status: 400 });
  const plan = cleanPlan(body?.plan, planDates().map((d) => d.value), true);
  if (!plan.ok) return Response.json(plan, { status: 400 });
  const r = await appendPlan(school, plan.plan.actions, { campus: s.campus, user: s.name });
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
