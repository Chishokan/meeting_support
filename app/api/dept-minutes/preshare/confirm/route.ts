import { getSession } from '@/lib/core/auth';
import { isAttendee } from '@/lib/attendees';
import { listPreshareRows } from '@/lib/deptMinutesPreshareGas';
import { confirmStoreReady, listConfirms, setConfirm } from '@/lib/preshareConfirmStore';

// 事前共有の「確認しました」。出席者が、会議の前に議題を見たことを残す。
//   POST { id, on } … on:true で付ける、false で外す。付けられるのは、その会議の出席者に入っている本人だけ。
// 返事には、いまの確認者の一覧を入れる（画面はそれで表示を入れ替える）。

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? '');
  if (!id) return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  if (!confirmStoreReady()) return Response.json({ ok: false, reason: 'not_configured' }, { status: 503 });

  const r = await listPreshareRows();
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: r.status });
  const row = r.items.find((x) => x.id === id);
  if (!row) return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  if (!isAttendee(session.name, row.attendees)) return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });

  try {
    await setConfirm(id, session.name, session.campus, body?.on !== false);
    const confirmed = (await listConfirms([id])).get(id) ?? [];
    return Response.json({ ok: true, confirmed });
  } catch (e) {
    console.error('[PRESHARE_CONFIRM]', e instanceof Error ? e.message : String(e));
    return Response.json({ ok: false, reason: 'db' }, { status: 500 });
  }
}
