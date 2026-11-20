import { waitUntil } from '@vercel/functions';
import { listPreshareRows } from '@/lib/deptMinutesPreshareGas';
import { isZoomAccountId } from '@/lib/zoom/accounts';
import { runAuto } from '@/lib/zoom/autoMinutes';
import { findMeetingLink } from '@/lib/zoom/store';
import { urlValidationReply, verifyZoomSignature } from '@/lib/zoom/webhook';

// Zoom からの通知の受け口（Zoom連携）。録画が完了したら、議事録を自動で作って保存する。
//   通知先の URL … https://＜アプリ＞/api/zoom/webhook/1（公式1）、…/2（公式2）
//   環境変数     … ZOOM_1_WEBHOOK_SECRET / ZOOM_2_WEBHOOK_SECRET（Zoom アプリの「Secret Token」）
// Secret Token が未設定のあいだは、通知を受け付けない（手動の［録画から議事録をつくる］は使える）。
//
// Zoom は3秒以内の返事を求めるので、確かめたらすぐ返事をし、下書きづくりは返事のあとに続ける。

export const runtime = 'nodejs';
export const maxDuration = 300;

const BUDGET_MS = 280 * 1000;

async function run(account: '1' | '2', meetingId: string, started: number) {
  try {
    // アプリが作ったミーティングだけを扱う（それ以外の録画には手を出さない）。
    const link = await findMeetingLink(account, meetingId);
    if (!link) return;
    const r = await listPreshareRows();
    if (!r.ok) return;
    const row = r.items.find((x) => x.id === link.preshareId);
    // 議事録を保存済みの会議は作らない。
    if (!row || row.minutesId) return;
    // 文字起こし → 議事録 → 保存を、時間の許すところまで進める（残りは毎朝の見回りが続きから進める）。
    await runAuto(row, started + BUDGET_MS);
  } catch (e) {
    console.error('[ZOOM_WEBHOOK] run', e instanceof Error ? e.message : String(e));
  }
}

export async function POST(req: Request, { params }: { params: { account: string } }) {
  const started = Date.now();
  const account = params.account;
  if (!isZoomAccountId(account)) return new Response('not found', { status: 404 });
  const secret = (process.env[`ZOOM_${account}_WEBHOOK_SECRET`] ?? '').trim();
  if (!secret) return new Response('not configured', { status: 503 });

  const raw = await req.text();
  const ok = verifyZoomSignature(secret, raw, req.headers.get('x-zm-request-timestamp'), req.headers.get('x-zm-signature'));
  if (!ok) return new Response('bad signature', { status: 401 });

  let body: { event?: string; payload?: { plainToken?: string; object?: { id?: number | string } } };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('bad request', { status: 400 });
  }

  // 通知先を登録・確認するときに Zoom が送ってくる。
  if (body.event === 'endpoint.url_validation') {
    return Response.json(urlValidationReply(secret, String(body.payload?.plainToken ?? '')));
  }

  if (body.event === 'recording.completed') {
    const meetingId = String(body.payload?.object?.id ?? '');
    if (meetingId) waitUntil(run(account, meetingId, started));
  }
  return Response.json({ ok: true });
}
