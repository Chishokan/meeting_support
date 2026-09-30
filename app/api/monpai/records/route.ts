// 門配管理の記録（1行＝ある日・ある学校での門配1回。計画と実績を同じ行で持つ）。全部門が利用できる。
//   GET    ?months=2026-10,2026-11 … その月の記録
//   POST   … 新規登録
//   PUT    … 更新（body.id）
//   DELETE ?id= … 削除（シートでは「削除」列に印を付けるだけで、行は消さない）
import { getSession } from '@/lib/core/auth';
import { validateRecord } from '@/lib/monpai/model';
import { deleteRecord, listRecords, saveRecord } from '@/lib/monpai/store';

export const runtime = 'nodejs';
export const maxDuration = 30;

const statusOf = (reason: string) =>
  reason === 'not_configured' ? 200 : reason === 'not_found' ? 404 : 502;

export async function GET(req: Request) {
  if (!getSession()) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const months = (new URL(req.url).searchParams.get('months') ?? '')
    .split(',')
    .filter((m) => /^\d{4}-\d{2}$/.test(m))
    .slice(0, 3);
  if (!months.length) return Response.json({ ok: false, reason: 'bad_month', items: [] }, { status: 400 });
  const r = await listRecords(months);
  if (!r.ok) return Response.json({ ok: false, reason: r.reason, items: [] }, { status: statusOf(r.reason) });
  return Response.json(r);
}

async function save(req: Request, isNew: boolean) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = isNew ? '' : String(body?.id ?? '').trim();
  if (!isNew && !id) return Response.json({ ok: false, reason: 'bad_id' }, { status: 400 });
  const v = validateRecord(body);
  if (!v.ok) return Response.json({ ok: false, reason: 'invalid', errors: v.errors }, { status: 400 });
  const r = await saveRecord(id, v.value, session.name);
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: statusOf(r.reason) });
  return Response.json(r);
}

export const POST = (req: Request) => save(req, true);
export const PUT = (req: Request) => save(req, false);

export async function DELETE(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!id) return Response.json({ ok: false, reason: 'bad_id' }, { status: 400 });
  const r = await deleteRecord(id, session.name);
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: statusOf(r.reason) });
  return Response.json({ ok: true });
}
