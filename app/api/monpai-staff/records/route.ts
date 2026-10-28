// 門配スタッフ用：自分が担当の門配だけを読み、実績を報告する。
// 社員用の /api/monpai/records と違い、他の人の記録は返さず、計画（日付・学校・部数など）は変えられない。
//   GET ?months=2026-10,2026-11 … その月の自分の担当の記録
//   PUT { id, month, done, memo, reason, cancel } … 実績の報告（配った部数・反応・中止）
import { isMine, todayJst, validateRecord } from '@/lib/monpai/model';
import { listRecords, saveRecord } from '@/lib/monpai/store';
import { currentStaff } from '@/lib/monpai/staffSession';

export const runtime = 'nodejs';
export const maxDuration = 30;

const statusOf = (reason: string) =>
  reason === 'not_configured' ? 200 : reason === 'not_found' ? 404 : reason === 'forbidden' ? 403 : 502;

const MONTH = /^\d{4}-\d{2}$/;

export async function GET(req: Request) {
  const me = await currentStaff();
  if (!me) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });
  const months = (new URL(req.url).searchParams.get('months') ?? '').split(',').filter((m) => MONTH.test(m)).slice(0, 3);
  if (!months.length) return Response.json({ ok: false, reason: 'bad_month', items: [] }, { status: 400 });
  const r = await listRecords(months);
  if (!r.ok) return Response.json({ ok: false, reason: r.reason, items: [] }, { status: statusOf(r.reason) });
  return Response.json({ ok: true, items: r.items.filter((x) => isMine(x, me.name)) });
}

export async function PUT(req: Request) {
  const me = await currentStaff();
  if (!me) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(b.id ?? '').trim();
  const month = String(b.month ?? '');
  if (!id || !MONTH.test(month)) return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 });

  // 保存されている記録をもとにする（画面から来た計画の値は使わない）
  const list = await listRecords([month]);
  if (!list.ok) return Response.json({ ok: false, reason: list.reason }, { status: statusOf(list.reason) });
  const cur = list.items.find((x) => x.id === id);
  if (!cur) return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  if (!isMine(cur, me.name)) return Response.json({ ok: false, reason: 'not_mine' }, { status: 403 });
  if (cur.date > todayJst()) return Response.json({ ok: false, reason: 'future' }, { status: 400 });

  const cancel = b.cancel === true;
  const v = validateRecord({
    ...cur,
    done: cancel ? 0 : b.done,
    status: cancel ? '中止' : '予定',
    reason: b.reason ?? cur.reason,
    memo: b.memo ?? cur.memo,
  });
  if (!v.ok) return Response.json({ ok: false, reason: 'invalid', errors: v.errors }, { status: 400 });
  if (!cancel && v.value.done == null) {
    return Response.json({ ok: false, reason: 'invalid', errors: ['配った部数を入力してください。'] }, { status: 400 });
  }
  const r = await saveRecord(id, v.value, me.name);
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: statusOf(r.reason) });
  return Response.json(r);
}
