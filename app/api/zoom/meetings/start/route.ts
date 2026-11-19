// Zoom ミーティングを「ホストとして開始」するためのURLを返す（Zoom連携）。
//
//   POST { preshareId } → { ok:true, url }
//
// 自動クラウド録画はホストが開始したときに始まる。会議室のPCで Zoom アカウントにサインインし直さなくて
// 済むよう、押したときに Zoom から開始用URLを取り直して返す。
// 開始用URLを持つ人はホストとして会議を操作できるので、
//   ・出す相手は、管理部門（全部門の会議）と部門長権限者（自分の部門の会議）に限る（lib/zoom/access.ts）
//   ・URLは保存しない（毎回 Zoom から取り直す）
//   ・誰がいつ開始したかを会話ログに残す

import { getSession } from '@/lib/core/auth';
import { logInteraction } from '@/lib/core/log';
import { ADMIN_CAMPUS } from '@/lib/core/staff';
import { listPreshareRows } from '@/lib/deptMinutesPreshareGas';
import { canHostMeeting } from '@/lib/zoom/access';
import { isZoomAccountId } from '@/lib/zoom/accounts';
import { ZoomError, getMeeting } from '@/lib/zoom/client';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const preshareId = String(body?.preshareId ?? '');
  if (!preshareId) return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 });

  const r = await listPreshareRows();
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: r.status });
  const row = r.items.find((x) => x.id === preshareId);
  if (!row || !row.zoomMeetingId || !isZoomAccountId(row.zoomAccount)) {
    return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  }
  if (!canHostMeeting(session, row.campus, ADMIN_CAMPUS)) {
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  }

  try {
    const m = await getMeeting(row.zoomAccount, row.zoomMeetingId);
    if (!m.startUrl) return Response.json({ ok: false, reason: 'upstream' }, { status: 502 });
    // URLそのものは残さない（ログを見た人がホストになれてしまうため）。
    await logInteraction(
      {
        user: session.name,
        campus: session.campus,
        input: `[Zoom/ホストとして開始] ${row.title || '（会議名なし）'}｜${row.campus}｜${row.date}`,
        output: `ミーティングID ${row.zoomMeetingId}`,
      },
      { timeoutMs: 5000 },
    );
    return Response.json({ ok: true, url: m.startUrl }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const z = e instanceof ZoomError ? e : new ZoomError('upstream');
    console.error('[ZOOM_START_ERROR]', z.reason, z.detail);
    return Response.json({ ok: false, reason: z.reason }, { status: z.reason === 'not_found' ? 404 : 502 });
  }
}
