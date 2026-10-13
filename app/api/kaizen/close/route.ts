// つきいち改善の投票を早めに締め切る／受付を再開する（管理部門のみ）。POST { month, closed }。
// 締め切れるのは投票受付中の月（先月）だけ。それより前の月は月末で自動的に締まっている。
// 締め切ると、得票と優秀賞が全員に見えるようになる。

import { getSession } from '@/lib/core/auth';
import { ADMIN_CAMPUS } from '@/lib/core/staff';
import { addMonths, normalizeMonth, todayJst } from '@/lib/kaizen/model';
import { setClose } from '@/lib/kaizen/store';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (session.campus !== ADMIN_CAMPUS) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { month?: unknown; closed?: unknown };
  const month = normalizeMonth(String(body.month ?? ''));
  if (!month || month !== addMonths(todayJst().slice(0, 7), -1)) {
    return Response.json({ ok: false, reason: 'bad_month', message: '締め切れるのは投票受付中の月だけです。' }, { status: 400 });
  }
  const r = await setClose(month, body.closed === true, session.name);
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: r.reason === 'not_configured' ? 200 : 502 });
  return Response.json({ ok: true });
}
