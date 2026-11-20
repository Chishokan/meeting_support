import { getSession } from '@/lib/core/auth';
import { ADMIN_CAMPUS } from '@/lib/core/staff';
import { logInteraction } from '@/lib/core/log';
import { listPreshareRows } from '@/lib/deptMinutesPreshareGas';
import type { PreshareRow } from '@/lib/deptMinutesPreshare';
import { canUseRecording } from '@/lib/zoom/access';
import { advanceJob, inputFromPreshare } from '@/lib/zoom/minutesJob';
import { jobStoreReady, loadJob, type MinutesJob } from '@/lib/zoom/minutesStore';

// Zoom の録画から議事録の下書きを作る（Zoom連携）。
//   GET  ?preshareId=…           … いまの状態と、できている下書きを返す
//   POST { preshareId, redo?, only? } … 下書きづくりを進める（文字起こし → 議事録）
// 文字起こしは数分かかることがあるので、実行時間を長く取る。
// 使えるのは、その会議の部門の人・事前共有した本人・管理部門（lib/zoom/access.ts の canUseRecording）。

export const runtime = 'nodejs';
export const maxDuration = 300;

// 返すまでの持ち時間（maxDuration より少し短く）。
const BUDGET_MS = 280 * 1000;

function view(job: MinutesJob) {
  return {
    status: job.status,
    source: job.source,
    model: job.model,
    attempts: job.attempts,
    transcript: job.transcript,
    minutes: job.minutes,
    error: job.error,
    durationMin: job.durationMin,
    updatedAt: job.updatedAt,
  };
}

type Found = { ok: true; row: PreshareRow; who: { name: string; campus: string } } | { ok: false; res: Response };

async function findRow(preshareId: string): Promise<Found> {
  const session = getSession();
  if (!session) return { ok: false, res: Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 }) };
  if (!preshareId) return { ok: false, res: Response.json({ ok: false, reason: 'bad_request' }, { status: 400 }) };
  if (!jobStoreReady()) return { ok: false, res: Response.json({ ok: false, reason: 'not_configured' }, { status: 503 }) };
  const r = await listPreshareRows();
  if (!r.ok) return { ok: false, res: Response.json({ ok: false, reason: r.reason }, { status: r.status }) };
  const row = r.items.find((x) => x.id === preshareId);
  if (!row || !row.zoomMeetingId) return { ok: false, res: Response.json({ ok: false, reason: 'not_found' }, { status: 404 }) };
  if (!canUseRecording(session, row, ADMIN_CAMPUS)) {
    return { ok: false, res: Response.json({ ok: false, reason: 'forbidden' }, { status: 403 }) };
  }
  return { ok: true, row, who: { name: session.name, campus: session.campus } };
}

export async function GET(req: Request) {
  const f = await findRow(new URL(req.url).searchParams.get('preshareId') ?? '');
  if (!f.ok) return f.res;
  try {
    const job = await loadJob(f.row.zoomAccount ?? '', f.row.zoomMeetingId ?? '');
    return Response.json({ ok: true, job: job ? view(job) : null });
  } catch (e) {
    console.error('[ZOOM_MINUTES] load', e instanceof Error ? e.message : String(e));
    return Response.json({ ok: false, reason: 'db' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const started = Date.now();
  const body = await req.json().catch(() => ({}));
  const f = await findRow(String(body?.preshareId ?? ''));
  if (!f.ok) return f.res;
  // 議事録を保存済みの会議は、作り直しても行き場が無い。
  if (f.row.minutesId) return Response.json({ ok: false, reason: 'has_minutes' }, { status: 409 });

  const input = inputFromPreshare(f.row, {
    startedBy: f.who.name,
    deadline: started + BUDGET_MS,
    redo: body?.redo === true,
    only: typeof body?.only === 'string' ? body.only : undefined,
  });
  if (!input) return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });

  try {
    const r = await advanceJob(input);
    if (!r.ok) return Response.json({ ok: false, reason: r.reason, detail: r.detail, job: r.job ? view(r.job) : null });
    if (r.job.status === 'done') {
      // 文字起こし全文はログに残さない（app/api/dept-minutes と同じ扱い）。
      await logInteraction({
        user: f.who.name,
        campus: f.who.campus,
        input: `[Zoom録画から議事録] ${f.row.title || '（会議名未入力）'}｜文字起こし${r.job.transcript.length}字（${r.job.source}）`,
        output: r.job.minutes,
      }).catch(() => {});
    }
    return Response.json({ ok: true, job: view(r.job) });
  } catch (e) {
    console.error('[ZOOM_MINUTES] run', e instanceof Error ? e.message : String(e));
    return Response.json({ ok: false, reason: 'db' }, { status: 500 });
  }
}
