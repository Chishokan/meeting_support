import { guard } from '@/lib/eventList/api';
import { deleteStudent, saveStudent } from '@/lib/eventList/store';
import { cleanStudentInput } from '@/lib/eventList/model';
import { eventScope } from '@/lib/eventList/access';
import { DEFAULT_DEPT, DEPTS } from '@/lib/eventList/event';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// イベント申込管理：名簿に無い生徒をアプリで足す・直す・外す（RED個別・高校生・外部生など）。
//   POST   … { id?, dept?, campus, school, grade, name, dream, hope } id が無ければ足す、あれば直す（アプリで足した生徒だけ）
//            足す生徒の部門は、ログインした部門（管理部門は dept で選ぶ。無ければ小中等部）。ほかの部門の生徒は直せない・外せない
//   DELETE … { id } 足した生徒を外す（行は残し、印を付けるだけ）
// 名簿のスプレッドシートの生徒は、ここでは変えない（スプレッドシートで直す）。
export async function POST(req: Request) {
  const g = guard();
  if ('res' in g) return g.res;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = cleanStudentInput(b);
  const id = String(b.id ?? '').trim();
  if (!input) return Response.json({ ok: false, reason: 'no_name' }, { status: 400 });
  if (id && !/^A-[0-9a-zA-Z-]{1,40}$/.test(id)) return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  const scope = eventScope(g.session.campus);
  const dept = scope ?? (DEPTS.includes(String(b.dept ?? '')) ? String(b.dept) : DEFAULT_DEPT);
  const r = await saveStudent(id, input, dept, scope, g.session.name);
  return Response.json(r, { status: r.ok ? 200 : r.reason === 'not_found' ? 404 : 502 });
}

export async function DELETE(req: Request) {
  const g = guard();
  if ('res' in g) return g.res;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(b.id ?? '').trim();
  if (!/^A-[0-9a-zA-Z-]{1,40}$/.test(id)) return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  const r = await deleteStudent(id, eventScope(g.session.campus), g.session.name);
  return Response.json(r, { status: r.ok ? 200 : r.reason === 'not_found' ? 404 : 502 });
}
