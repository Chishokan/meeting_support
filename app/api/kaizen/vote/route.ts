// つきいち改善の投票。POST { month, ids }。
// 投票者はログインしている本人（名前を選んで代わりに入れることはできない）。
// 1人3票まで・自分の改善には入れられない・締め切りまでは入れ直せる（ids が空なら取り消し）。

import { getSession } from '@/lib/core/auth';
import { checkVote, normalizeMonth, nowJstText, todayJst } from '@/lib/kaizen/model';
import { loadKaizen, saveVote } from '@/lib/kaizen/store';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { month?: unknown; ids?: unknown };
  const month = normalizeMonth(String(body.month ?? ''));
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (!month) return Response.json({ ok: false, reason: 'bad_month' }, { status: 400 });

  const r = await loadKaizen();
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: r.reason === 'not_configured' ? 200 : 502 });
  const c = checkVote({ month, ids, voter: session.name, items: r.items, today: todayJst(), closes: r.closes });
  if (!c.ok) return Response.json({ ok: false, reason: c.reason, message: c.message }, { status: 400 });

  const votedAt = nowJstText();
  const s = await saveVote({ month, voter: session.name, dept: session.campus, ids: c.ids, votedAt });
  if (!s.ok) return Response.json({ ok: false, reason: s.reason }, { status: s.reason === 'not_configured' ? 200 : 502 });
  return Response.json({ ok: true, month, ids: c.ids, votedAt: c.ids.length ? votedAt : '' });
}
