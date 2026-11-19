import { getSession } from '@/lib/core/auth';
import { ADMIN_CAMPUS } from '@/lib/core/staff';
import { logInteraction } from '@/lib/core/log';
import { canDeletePreshare, missingForPreshare, type PreshareRow } from '@/lib/deptMinutesPreshare';
import { listPreshareRows } from '@/lib/deptMinutesPreshareGas';
import { canHostMeeting } from '@/lib/zoom/access';
import { defaultZoomAccount, isZoomAccountId, zoomAccount, zoomAccountOptions, type ZoomAccountId } from '@/lib/zoom/accounts';
import { ZoomError, createMeeting, deleteMeeting, updateMeeting, type MeetingInput } from '@/lib/zoom/client';
import { parseSchedule } from '@/lib/zoom/schedule';
import { deleteMeetingLinks, saveMeetingLink } from '@/lib/zoom/store';

export const runtime = 'nodejs';
// Zoom ミーティングの作成（数秒）とスプレッドシートの読み書き（1〜3秒×2回）が続くことがある。
export const maxDuration = 60;

// 部門会議の事前共有（会議の前に、会議情報と議題・レジュメを全部門へ出しておく）。
//   GET  … 事前共有の一覧（新しい順）。ダッシュボードと「部門会議議事録」画面で使う
//   POST … 事前共有の保存。id を添えると、その事前共有を上書きする
//   DELETE … 事前共有の削除（議事録を保存する前のものだけ。Zoom ミーティングを作ってあれば、それも消す）
// 保存先は Apps Script の「部門会議事前共有」シート（saveDeptPreshare_ / listDeptPreshare_）。
//
// Zoom連携：POST に zoom:{ create:true, account } を添えると、開催日時から Zoom ミーティングを作り
//（作成済みなら更新し）、参加URL・ミーティングID・パスコードを事前共有と一緒に保存する。
// 事前共有カードの［Zoomに参加］［ホストとして開始］は、ここで保存した値を使う。
// Zoom の作成に失敗しても事前共有は保存する（結果は zoom.ok / zoom.reason で返す）。
//
// ★Apps Script が古いまま（この action を知らない）だと、GAS は既定の「会話ログ」へ1行足して
//   ok:true だけを返す。成功と取り違えないよう、返ってきた id / items の有無も確かめる。

const s = (v: unknown) => String(v ?? '');

// 日本時間の今日（'YYYY-MM-DD'）。年を省いた開催日時を何年とみなすかを決めるのに使う。
function jstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function GET() {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized', items: [] }, { status: 401 });

  const r = await listPreshareRows();
  if (!r.ok) return Response.json({ ok: false, reason: r.reason, items: [] }, { status: r.status });

  const items: PreshareRow[] = r.items.map((row) => ({
    ...row,
    // ［ホストとして開始］を出すか。開始のときにもサーバで同じ判定をする（app/api/zoom/meetings/start）。
    canHost: Boolean(row.zoomMeetingId) && canHostMeeting(session, row.campus, ADMIN_CAMPUS),
    // ［削除］を出すか。削除のときにもサーバで同じ判定をする（下の DELETE）。
    canDelete: canDeletePreshare(session, row, ADMIN_CAMPUS),
  }));
  return Response.json({
    ok: true,
    items,
    // 手順1の「Zoom ミーティングを作る」に出す選択肢。接続情報が未設定なら空（画面に出さない）。
    zoom: { accounts: zoomAccountOptions(), defaultAccount: defaultZoomAccount(session.campus) },
  });
}

type ZoomSaved = { account: string; meetingId: string; joinUrl: string; passcode: string };
type ZoomResult =
  | ({ ok: true; action: 'created' | 'updated' } & ZoomSaved)
  | { ok: false; reason: string; detail?: string };

// Zoom ミーティングを用意する。同じアカウントで作ってあれば更新し、無ければ作る。
async function ensureMeeting(
  account: ZoomAccountId,
  existing: PreshareRow | undefined,
  input: MeetingInput,
): Promise<ZoomResult> {
  try {
    if (existing?.zoomMeetingId && existing.zoomAccount === account) {
      try {
        await updateMeeting(account, existing.zoomMeetingId, input);
        return {
          ok: true, action: 'updated', account,
          meetingId: existing.zoomMeetingId, joinUrl: s(existing.zoomJoinUrl), passcode: s(existing.zoomPasscode),
        };
      } catch (e) {
        // Zoom 側で消されていたら、作り直す。それ以外の失敗はそのまま返す。
        if (!(e instanceof ZoomError) || e.reason !== 'not_found') throw e;
      }
    }
    const m = await createMeeting(account, input);
    return { ok: true, action: 'created', account, meetingId: m.id, joinUrl: m.joinUrl, passcode: m.passcode };
  } catch (e) {
    const z = e instanceof ZoomError ? e : new ZoomError('upstream');
    console.error('[ZOOM_MEETING_ERROR]', z.reason, z.detail);
    return { ok: false, reason: z.reason, detail: z.detail };
  }
}

export async function POST(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw = (body?.meta ?? {}) as Record<string, unknown>;
  const meta = {
    title: s(raw.title).trim(),
    date: s(raw.date).trim(),
    place: s(raw.place).trim(),
    attendees: s(raw.attendees).trim(),
    agenda: s(raw.agenda).trim(),
  };
  const missing = missingForPreshare(meta);
  if (missing.length > 0) return Response.json({ ok: false, reason: 'empty', missing }, { status: 400 });

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured' });

  const id = s(body?.id);

  // ---- Zoom ミーティングの作成・更新（頼まれたときだけ） ----
  let zoom: ZoomResult | undefined;
  let schedule: ReturnType<typeof parseSchedule> = null;
  // 部門は、最初に事前共有した人の部門（上書きのときは元の行のもの）。対応表に残す。
  let campus = session.campus;
  if (body?.zoom?.create === true) {
    const wanted = body.zoom.account;
    const account = isZoomAccountId(wanted) ? wanted : defaultZoomAccount(session.campus);
    schedule = parseSchedule(meta.date, jstToday());
    if (!account || !zoomAccount(account)) {
      zoom = { ok: false, reason: 'not_configured' };
    } else if (!schedule) {
      zoom = { ok: false, reason: 'bad_date' };
    } else {
      // 先に保存済みの事前共有を読む。
      //  ・Apps Script が古い（Zoom の列を保存できない）ときは、Zoom ミーティングを作らない
      //   （作っても参加URLを残せず、押すたびに使われないミーティングが増えるため）
      //  ・上書きのときは、すでに作ってある Zoom ミーティングを探して更新する（何件も作らないため）
      //   画面から送られてきたミーティングIDは使わない（他の会議を書き換えられないように、保存済みの値を読む）
      const cur = await listPreshareRows();
      const existing = cur.ok && id ? cur.items.find((r) => r.id === id) : undefined;
      if (existing?.campus) campus = existing.campus;
      const input = { topic: meta.title, startTime: schedule.startTime, durationMin: schedule.durationMin };
      zoom = !cur.ok || !cur.zoomColumns
        ? { ok: false, reason: cur.ok ? 'gas_outdated' : cur.reason }
        : await ensureMeeting(account, existing, input);
    }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveDeptPreshare',
        token: process.env.APPS_SCRIPT_TOKEN || '',
        id,
        campus: session.campus,
        user: session.name,
        ...meta,
        // zoom を添えないときは、保存済みの Zoom の列をそのまま残す（Apps Script 側）。
        ...(zoom?.ok
          ? { zoom: { account: zoom.account, meetingId: zoom.meetingId, joinUrl: zoom.joinUrl, passcode: zoom.passcode } }
          : {}),
      }),
    });
    // GAS(ContentService)は失敗時も HTTP 200 を返すため、本文の ok/reason を必ず確認する。
    const j = await res.json().catch(() => null);
    if (res.ok && j && j.ok === true && j.id) {
      if (zoom?.ok) {
        if (j.zoomSaved !== true) {
          // Apps Script が古く、Zoom の列を知らない。事前共有は保存できたが、参加ボタンは出せない。
          zoom = { ok: false, reason: 'gas_outdated' };
        } else if (schedule) {
          await saveMeetingLink({
            account: zoom.account,
            meetingId: zoom.meetingId,
            preshareId: s(j.id),
            campus,
            startTime: schedule.startTime,
            durationMin: schedule.durationMin,
            createdBy: session.name,
          });
        }
      }
      return Response.json({ ok: true, id: s(j.id), updated: j.updated === true, ts: s(j.ts), ...(zoom ? { zoom } : {}) });
    }
    const reason = j && j.ok === true ? 'gas_outdated' : (j && j.reason) || 'upstream_error';
    return Response.json({ ok: false, reason }, { status: 502 });
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }
}

// 事前共有の削除。
//   ・消せるのは、その部門の人・事前共有した本人・管理部門（lib/deptMinutesPreshare.ts の canDeletePreshare）
//   ・議事録を保存済みの事前共有は消せない
//   ・Zoom ミーティングを作ってあれば、それも消す。Zoom だけ失敗しても事前共有は消し、結果を zoom.ok / zoom.reason で返す
//   ・誰がいつ消したかを会話ログに残す
export async function DELETE(req: Request) {
  const session = getSession();
  if (!session) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = s(body?.id);
  if (!id) return Response.json({ ok: false, reason: 'bad_request' }, { status: 400 });

  const url = process.env.APPS_SCRIPT_URL;
  if (!url) return Response.json({ ok: false, reason: 'not_configured' });

  // 画面から送られてきた内容ではなく、保存済みの行で判定する。
  const cur = await listPreshareRows();
  if (!cur.ok) return Response.json({ ok: false, reason: cur.reason }, { status: cur.status });
  const row = cur.items.find((r) => r.id === id);
  if (!row) return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  if (row.minutesId) return Response.json({ ok: false, reason: 'has_minutes' }, { status: 409 });
  if (!canDeletePreshare(session, row, ADMIN_CAMPUS)) {
    return Response.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteDeptPreshare', token: process.env.APPS_SCRIPT_TOKEN || '', id }),
    });
    const j = await res.json().catch(() => null);
    if (!(res.ok && j && j.ok === true && j.deleted === true)) {
      // 古い Apps Script は、知らない action に ok:true だけを返す（deleted の印が無い）。
      const reason = j && j.ok === true ? 'gas_outdated' : (j && j.reason) || 'upstream_error';
      return Response.json({ ok: false, reason }, { status: 502 });
    }
  } catch {
    return Response.json({ ok: false, reason: 'network_error' }, { status: 502 });
  }

  // ここから先は失敗しても、事前共有はもう消えている。
  let zoom: { ok: true } | { ok: false; reason: string } | undefined;
  if (row.zoomMeetingId && isZoomAccountId(row.zoomAccount)) {
    try {
      await deleteMeeting(row.zoomAccount, row.zoomMeetingId);
      zoom = { ok: true };
    } catch (e) {
      const z = e instanceof ZoomError ? e : new ZoomError('upstream');
      // Zoom 側ですでに消されていたら、消せたのと同じ。
      if (z.reason === 'not_found') zoom = { ok: true };
      else {
        console.error('[ZOOM_DELETE_ERROR]', z.reason, z.detail);
        zoom = { ok: false, reason: z.reason };
      }
    }
    await deleteMeetingLinks(id);
  }

  await logInteraction(
    {
      user: session.name,
      campus: session.campus,
      input: `[事前共有/削除] ${row.title || '（会議名なし）'}｜${row.campus}｜${row.date}｜共有：${row.user}`,
      output: row.zoomMeetingId ? `Zoom ミーティングID ${row.zoomMeetingId}：${zoom?.ok ? '削除' : '削除できず'}` : 'Zoom なし',
    },
    { timeoutMs: 5000 },
  );

  return Response.json({ ok: true, id, ...(zoom ? { zoom } : {}) });
}
