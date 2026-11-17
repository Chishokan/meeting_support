import { randomUUID } from 'crypto';
import { examById, forgetExam, guard, rememberExams } from '@/lib/moshi/api';
import { cleanExam, type MoshiExam } from '@/lib/moshi/model';
import { deleteExam, loadAll, saveExam } from '@/lib/moshi/store';

export const runtime = 'nodejs';
export const maxDuration = 60;

// 回の設定（模試名・実施日・配点と分野・時間割・持ち物・注意事項・会場）の作成と更新。
// id を付けて送ると更新、付けなければ新しい回を作る。
export async function POST(req: Request) {
  const g = guard();
  if ('res' in g) return g.res;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const c = cleanExam(body);
  if (!c.ok) return Response.json(c, { status: 400 });

  const id = String(body.id ?? '').trim();
  let base: Pick<MoshiExam, 'id' | 'createdAt' | 'createdBy'> = { id: randomUUID(), createdAt: '', createdBy: '' };
  if (id) {
    const cur = await examById(id);
    if (cur === 'error') return Response.json({ ok: false, reason: 'upstream_error' }, { status: 502 });
    if (!cur) return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
    base = { id: cur.id, createdAt: cur.createdAt, createdBy: cur.createdBy };
  }
  const r = await saveExam({ ...c.value, ...base, updatedAt: '', updatedBy: g.session.name }, g.session.name);
  if (!r.ok) return Response.json(r, { status: 502 });
  rememberExams([r.exam]);
  return Response.json(r);
}

// 回を消す。成績が入っている回は force=1 のときだけ（画面で2回確かめてから送る）。
export async function DELETE(req: Request) {
  const g = guard();
  if ('res' in g) return g.res;
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  if (!id) return Response.json({ ok: false, reason: 'bad_id' }, { status: 400 });
  if (url.searchParams.get('force') !== '1') {
    const all = await loadAll();
    if (!all.ok) return Response.json(all, { status: 502 });
    const n = all.results.filter((r) => r.examId === id).length;
    if (n) return Response.json({ ok: false, reason: 'has_results', count: n }, { status: 409 });
  }
  const r = await deleteExam(id, g.session.name);
  if (!r.ok) return Response.json(r, { status: r.reason === 'not_found' ? 404 : 502 });
  forgetExam(id);
  return Response.json({ ok: true });
}
