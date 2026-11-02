import { getSession } from '@/lib/core/auth';
import { todayText } from '@/lib/core/companyKnowledge';
import { cleanPlan, COACH_DEPT, COACH_SCHOOLS, planDates } from '@/lib/taskCoach';
import { planDocx } from '@/lib/taskCoachDoc';

export const runtime = 'nodejs';

// AI壁打ちの「行動計画の案」を Word ファイルにして返す（その場でダウンロード。どこにも保存しない）。
export async function POST(req: Request) {
  const s = getSession();
  if (!s) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (s.campus !== COACH_DEPT) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const school = String(body?.school ?? '');
  if (!COACH_SCHOOLS.includes(school)) return Response.json({ ok: false, reason: 'bad_school' }, { status: 400 });
  const dates = planDates().map((d) => d.value);
  const plan = cleanPlan(body?.plan, dates, true);
  if (!plan.ok) return Response.json(plan, { status: 400 });
  const buf = await planDocx({
    school, itemLabel: String(body?.itemLabel ?? '全体').slice(0, 60), author: s.name,
    today: todayText(), plan: plan.plan, dateOrder: dates,
  });
  const name = `行動計画の案_${school}.docx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="plan.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  });
}
