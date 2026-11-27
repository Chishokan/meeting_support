// 智翔館AI：部門会議の事前共有に、チャットのボタン（［意見を足す］［修正する］）から意見を足す・直す。
//   GET  ?id=… … いまの事前共有（モーダルを開いたときに読み直す。チャットに出た内容は古いことがあるため）
//   POST       … { id, mode: 'opinion', target, text }：選んだ議題の下に意見の1行を足す（保存の直前に最新を読み直して足す）
//               { id, mode: 'edit', fields, base }：会議情報と議題・レジュメを直す。base（開いたときの中身）といまの中身が違えば保存しない
// 保存は「部門会議議事録」画面と同じ Apps Script の saveDeptPreshare（再デプロイは要らない）。議事録を保存した会議は直せない。
// 意見は誰でも足せる。修正（全体の書き換え）は、削除と同じく、その部門の方・事前共有した本人・管理部門の方だけ（canDeletePreshare）。
// Zoom の列は送らないので、保存済みの Zoom ミーティング（参加URLなど）はそのまま残る（日時を変えても Zoom 側の時刻は変わらない）。
// 決まりは lib/chishokanAi/preshareEdit.ts。

import { getSession, verifiedEmail } from '@/lib/core/auth';
import { ADMIN_CAMPUS } from '@/lib/core/staff';
import { canDeletePreshare } from '@/lib/deptMinutesPreshare';
import { AI_DENIED_MESSAGE, canUseChishokanAi } from '@/lib/chishokanAi/access';
import { callGas } from '@/lib/chishokanAi/gas';
import { logAi } from '@/lib/chishokanAi/aiLog';
import {
  agendaTargets,
  checkFields,
  checkOpinion,
  editableMessage,
  insertOpinion,
  sameVersion,
  stampJst,
  type PreshareEditRow,
  type PreshareFields,
} from '@/lib/chishokanAi/preshareEdit';

export const runtime = 'nodejs';
export const maxDuration = 30;

const s = (v: unknown) => String(v ?? '');

type Row = PreshareEditRow & { zoomMeetingId: string };

async function latestRow(id: string): Promise<{ ok: true; row: Row | null } | { ok: false }> {
  const j = await callGas({ action: 'listDeptPreshare' });
  if (!j.ok || !Array.isArray(j.items)) return { ok: false };
  const r = (j.items as Record<string, unknown>[]).find((x) => s(x.id) === id);
  if (!r) return { ok: true, row: null };
  return {
    ok: true,
    row: {
      id: s(r.id), campus: s(r.campus), user: s(r.user), title: s(r.title), date: s(r.date), place: s(r.place),
      attendees: s(r.attendees), agenda: s(r.agenda), editedAt: s(r.editedAt), editedBy: s(r.editedBy), minutesId: s(r.minutesId),
      zoomMeetingId: s(r.zoomMeetingId),
    },
  };
}

type Who = { name: string; campus: string };
const view = (row: Row, who: Who) => {
  const { zoomMeetingId, ...rest } = row;
  return { ...rest, targets: agendaTargets(row.agenda), canEdit: canDeletePreshare(who, row, ADMIN_CAMPUS), hasZoom: Boolean(zoomMeetingId) };
};
const NO_EDIT = '事前共有を修正できるのは、その部門の方・事前共有した本人・管理部門の方です（意見を足すことはできます）。';
const fieldsOf = (row: PreshareEditRow): PreshareFields => ({ title: row.title, date: row.date, place: row.place, attendees: row.attendees, agenda: row.agenda });

function guard() {
  const session = getSession();
  if (!session) return { error: Response.json({ ok: false, message: 'ログインし直してください。' }, { status: 401 }) };
  if (!canUseChishokanAi(session)) return { error: Response.json({ ok: false, message: AI_DENIED_MESSAGE }, { status: 403 }) };
  return { session };
}

export async function GET(req: Request) {
  const g = guard();
  if (g.error) return g.error;
  const id = new URL(req.url).searchParams.get('id')?.trim() ?? '';
  if (!id) return Response.json({ ok: false, message: '事前共有の番号がありません。' }, { status: 400 });
  const l = await latestRow(id);
  if (!l.ok) return Response.json({ ok: false, message: '事前共有を読めませんでした。時間をおいてもう一度開いてください。' }, { status: 502 });
  if (!l.row) return Response.json({ ok: false, message: editableMessage(null) }, { status: 404 });
  return Response.json({ ok: true, item: view(l.row, g.session!), locked: editableMessage(l.row) });
}

export async function POST(req: Request) {
  const g = guard();
  if (g.error) return g.error;
  const session = g.session!;
  const body = await req.json().catch(() => ({}));
  const id = s(body?.id).trim();
  const mode = body?.mode === 'edit' ? 'edit' : body?.mode === 'opinion' ? 'opinion' : '';
  if (!id || !mode) return Response.json({ ok: false, message: '送る中身が足りません。' }, { status: 400 });

  // 入力を先に確かめる（Apps Script を呼ぶ前に）
  const op = mode === 'opinion' ? checkOpinion(body) : null;
  if (op && !op.ok) return Response.json({ ok: false, message: op.message }, { status: 400 });
  const ed = mode === 'edit' ? checkFields(body?.fields) : null;
  if (ed && !ed.ok) return Response.json({ ok: false, message: ed.message }, { status: 400 });

  const l = await latestRow(id);
  if (!l.ok) return Response.json({ ok: false, message: '事前共有を読めませんでした。時間をおいてもう一度押してください。' }, { status: 502 });
  const lock = editableMessage(l.row);
  if (lock || !l.row) return Response.json({ ok: false, message: lock }, { status: l.row ? 409 : 404 });
  const row = l.row;

  let next: PreshareFields;
  if (op && op.ok) {
    next = { ...fieldsOf(row), agenda: insertOpinion(row.agenda, op.value.target, op.value.text, session.name, stampJst()) };
  } else if (ed && ed.ok) {
    if (!canDeletePreshare(session, row, ADMIN_CAMPUS)) return Response.json({ ok: false, message: NO_EDIT }, { status: 403 });
    if (!sameVersion(fieldsOf(row), (body?.base ?? {}) as PreshareFields)) {
      return Response.json(
        { ok: false, conflict: true, message: '開いてから保存するまでに、ほかの人がこの事前共有を直しました。最新を読み込み直してから、もう一度直してください。', item: view(row, session) },
        { status: 409 },
      );
    }
    next = ed.value;
  } else {
    return Response.json({ ok: false, message: '送る中身が足りません。' }, { status: 400 });
  }

  const j = await callGas({ action: 'saveDeptPreshare', id, campus: session.campus, user: session.name, ...next });
  if (!j.ok || !j.id) {
    return Response.json({ ok: false, message: j.ok ? 'Apps Script が古いため保存できません。管理者に再デプロイを依頼してください。' : '保存できませんでした。時間をおいてもう一度押してください。' }, { status: 502 });
  }
  void logAi(
    {
      user: session.name,
      campus: session.campus,
      email: verifiedEmail() ?? '',
      kind: '事前共有',
      conversationId: typeof body?.conversationId === 'string' ? body.conversationId.slice(0, 40) : '',
      question: `${row.campus}｜${row.title}（${row.date}）｜${mode === 'opinion' && op?.ok ? `意見：${op.value.target ? `「${op.value.target.slice(0, 40)}」へ ` : ''}${op.value.text}` : '修正'}`,
    },
    { input: `[智翔館AI 事前共有の${mode === 'opinion' ? '意見' : '修正'}] ${row.campus} ${row.title}`, output: 'saved' },
    { timeoutMs: 8000 },
  );
  return Response.json({ ok: true, item: view({ ...row, ...next, editedBy: session.name }, session) });
}
