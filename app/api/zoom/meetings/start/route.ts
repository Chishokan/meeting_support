// Zoom ミーティングを「ホストとして開始」するためのURLを返す（Zoom連携）。
//
//   POST { preshareId, force? } → { ok:true, url }
//
// 自動クラウド録画はホストが開始したときに始まる。会議室のPCで Zoom アカウントにサインインし直さなくて
// 済むよう、押したときに Zoom から開始用URLを取り直して返す。
// 開始用URLを持つ人は、Zoom のアカウント（公式1・公式2）そのものとして会議に入る。何人も入ると混乱するので、
//   ・出す相手は、その会議のホスト担当の1人だけ（lib/zoom/access.ts）
//   ・すでに開かれている会議には出さない（already_started）。回線が切れて入り直すときだけ force:true で出す
//   ・URLは保存しない（毎回 Zoom から取り直す）
//   ・誰がいつ開始したかを、データベース（確実）と会話ログ（返事のあとに送る）の両方に残す

import { waitUntil } from '@vercel/functions';
import { getSession } from '@/lib/core/auth';
import { logInteraction } from '@/lib/core/log';
import { listPreshareRows } from '@/lib/deptMinutesPreshareGas';
import { canHostMeeting, hostOf } from '@/lib/zoom/access';
import { isZoomAccountId } from '@/lib/zoom/accounts';
import { ZoomError, getMeeting } from '@/lib/zoom/client';
import { markMeetingStarted, meetingHosts } from '@/lib/zoom/store';

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
  const host = hostOf(row, (await meetingHosts([row.id])).get(row.id));
  if (!canHostMeeting(session, host)) {
    return Response.json({ ok: false, reason: 'forbidden', host }, { status: 403 });
  }

  try {
    const m = await getMeeting(row.zoomAccount, row.zoomMeetingId);
    if (!m.startUrl) return Response.json({ ok: false, reason: 'upstream' }, { status: 502 });
    // すでに開かれている会議に、もう一度ホストとして入ると、Zoom 側で入れ替わりや確認が起きる。
    // 画面で「入り直す」と確かめたとき（force）だけ通す。
    if (m.status === 'started' && body?.force !== true) {
      return Response.json({ ok: false, reason: 'already_started' }, { status: 409 });
    }
    await markMeetingStarted(row.zoomAccount, row.zoomMeetingId, session.name);
    // URLそのものは残さない（ログを見た人がホストになれてしまうため）。
    // 会話ログ（スプレッドシート）は数秒かかることがあるので、返事のあとに、打ち切らずに送る。
    waitUntil(
      logInteraction({
        user: session.name,
        campus: session.campus,
        input: `[Zoom/ホストとして開始${m.status === 'started' ? '・入り直し' : ''}] ${row.title || '（会議名なし）'}｜${row.campus}｜${row.date}`,
        output: `ミーティングID ${row.zoomMeetingId}`,
      }),
    );
    return Response.json({ ok: true, url: m.startUrl }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const z = e instanceof ZoomError ? e : new ZoomError('upstream');
    console.error('[ZOOM_START_ERROR]', z.reason, z.detail);
    return Response.json({ ok: false, reason: z.reason }, { status: z.reason === 'not_found' ? 404 : 502 });
  }
}
