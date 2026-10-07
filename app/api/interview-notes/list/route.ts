import { getSession } from '@/lib/core/auth';
import { canSeeAllInterviewNotes, canSeeInterviewNote } from '@/lib/interviewNotes/access';
import type { InterviewNoteRow } from '@/lib/interviewNotes/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

type GasRow = Record<string, unknown>;

const s = (v: unknown) => String(v ?? '');

// 保存済みの面談記録を新しい順に返す。
// 見られるのは自分の部門の記録だけ（管理部門は全部門）。範囲は lib/interviewNotes/access.ts。
export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured', items: [] });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'listInterviewNotes',
        token: process.env.APPS_SCRIPT_TOKEN || '',
        // GAS 側でも先に絞る（他部門の記録をそもそも送らせない）。空なら全部門。
        campus: canSeeAllInterviewNotes(session.campus) ? '' : session.campus,
      }),
    });
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true) {
      const rows: GasRow[] = Array.isArray(j.items) ? j.items : [];
      const items: InterviewNoteRow[] = rows
        .map((r) => ({
          id: s(r.id), ts: s(r.ts), campus: s(r.campus), user: s(r.user),
          student: s(r.student), grade: s(r.grade), kind: s(r.kind), date: s(r.date),
          place: s(r.place), interviewer: s(r.interviewer), attendees: s(r.attendees), purpose: s(r.purpose),
          note: s(r.note), checks: s(r.checks), editedAt: s(r.editedAt), editedBy: s(r.editedBy),
        }))
        // GAS が古いまま（絞り込みに対応していない）でも、ここで必ず絞る。
        .filter((r) => canSeeInterviewNote(session.campus, r.campus));
      return Response.json({ ok: true, items });
    }
    return Response.json(
      { ok: false, reason: (j && j.reason) || 'upstream_error', items: [] },
      { status: 502 },
    );
  } catch {
    return Response.json({ ok: false, reason: 'network_error', items: [] }, { status: 502 });
  }
}
