// 智翔館AI：議題の追加（AI が出した案の［議題に追加する］を押したとき）。
// 次の部門会議の事前共有があれば、その議題・レジュメの末尾に1行足す。無ければ「議題の候補」に残す（Apps Script の addDeptAgenda_）。
// 案の作り方は lib/chishokanAi/meetingRecords.ts（propose_agenda_item）。誰でも、どの部門の会議にも足せる（足した人と日付が行に残る）。

import { getSession, verifiedEmail } from '@/lib/core/auth';
import { AI_DENIED_MESSAGE, canUseChishokanAi } from '@/lib/chishokanAi/access';
import { callGas } from '@/lib/chishokanAi/gas';
import { logAi } from '@/lib/chishokanAi/aiLog';
import { checkAgendaInput } from '@/lib/chishokanAi/meetingRecords';
import { normalizeDept } from '@/lib/chishokanAi/meetingRecordsRun';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, message: 'ログインし直してください。' }, { status: 401 });
  if (!canUseChishokanAi(session)) return Response.json({ ok: false, message: AI_DENIED_MESSAGE }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const c = checkAgendaInput({ dept: body?.dept, item: body?.item, detail: body?.detail, meeting_id: body?.meetingId });
  if (!c.ok) return Response.json({ ok: false, message: c.message }, { status: 400 });
  const v = { ...c.value, dept: normalizeDept(c.value.dept) };
  const j = await callGas({ action: 'addDeptAgenda', campus: v.dept, item: v.item, detail: v.detail, preshareId: v.meetingId, user: session.name });
  if (!j.ok) return Response.json({ ok: false, message: '議題を追加できませんでした。時間をおいてもう一度押してください。' }, { status: 502 });
  if (j.saved !== 'agenda') {
    return Response.json({ ok: false, message: 'Apps Script が古いため追加できません。管理者に Apps Script の再デプロイを依頼してください。' }, { status: 502 });
  }
  const target = j.target === 'preshare' ? 'preshare' : 'candidate';
  void logAi(
    {
      user: session.name,
      campus: session.campus,
      email: verifiedEmail() ?? '',
      kind: '議題',
      conversationId: typeof body?.conversationId === 'string' ? body.conversationId.slice(0, 40) : '',
      question: `${v.dept}｜${target === 'preshare' ? `${String(j.title ?? '')} ${String(j.date ?? '')}` : '議題の候補'}｜${String(j.line ?? v.item)}`,
    },
    { input: `[智翔館AI 議題の追加] ${v.dept} ${v.item}`, output: target },
    { timeoutMs: 8000 },
  );
  return Response.json({ ok: true, target, title: String(j.title ?? ''), date: String(j.date ?? ''), line: String(j.line ?? '') });
}
