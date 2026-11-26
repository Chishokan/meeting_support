// Zoom ミーティングのホスト担当を替える（Zoom連携）。
//
//   POST { preshareId, host } → { ok:true, host }
//
// ホストとして開始できるのは、会議ごとに決めた1人だけ（lib/zoom/access.ts）。当日その人が来られなくなったときなどに、
// その部門の人・事前共有した本人・管理部門が、ここで替える。替えたことは会話ログに残す。

import { getSession } from '@/lib/core/auth';
import { logInteraction } from '@/lib/core/log';
import { ADMIN_CAMPUS, STAFF } from '@/lib/core/staff';
import { listPreshareRows } from '@/lib/deptMinutesPreshareGas';
import { canSetHost } from '@/lib/zoom/access';
import { isZoomAccountId } from '@/lib/zoom/accounts';
import { setMeetingHost } from '@/lib/zoom/store';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const preshareId = String(body?.preshareId ?? '');
  const host = String(body?.host ?? '').trim();
  // ホスト担当にできるのは、職員の一覧にある人だけ。
  if (!preshareId || !STAFF.some((g) => g.names.includes(host))) {
    return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }

  const r = await listPreshareRows();
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: r.status });
  const row = r.items.find((x) => x.id === preshareId);
  if (!row || !row.zoomMeetingId || !isZoomAccountId(row.zoomAccount)) {
    return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  }
  if (!canSetHost(session, row, ADMIN_CAMPUS)) {
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  }

  const saved = await setMeetingHost(
    { account: row.zoomAccount, meetingId: row.zoomMeetingId, preshareId: row.id, campus: row.campus },
    host,
  );
  if (!saved) return Response.json({ ok: false, reason: 'db' }, { status: 500 });

  await logInteraction(
    {
      user: session.name,
      campus: session.campus,
      input: `[Zoom/ホスト担当を変更] ${row.title || '（会議名なし）'}｜${row.campus}｜${row.date}`,
      output: `ホスト担当：${host}`,
    },
    { timeoutMs: 8000 },
  );
  return Response.json({ ok: true, host });
}
