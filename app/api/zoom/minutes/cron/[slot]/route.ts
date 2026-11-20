import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { logInteraction } from '@/lib/core/log';
import { listPreshareRows } from '@/lib/deptMinutesPreshareGas';
import { jstNow, meetingIsOver } from '@/lib/zoom/due';
import { advanceJob, inputFromPreshare } from '@/lib/zoom/minutesJob';
import { jobStatuses, jobStoreReady } from '@/lib/zoom/minutesStore';
import { parseSchedule } from '@/lib/zoom/schedule';

// 毎朝の見回り：終わった会議の Zoom 録画から、議事録の下書きを自動で作る（Zoom連携）。
// -------------------------------------------------------------------------
//   ・Vercel Cron（vercel.json）が毎日、深夜と明け方に叩く（…/cron/1、…/cron/2）。
//     Vercel は Authorization: Bearer <CRON_SECRET> を付けて来る。CRON_SECRET が未設定なら受け付けない
//   ・対象：事前共有から Zoom ミーティングを作った会議のうち、終わっていて（lib/zoom/due.ts）、
//     議事録がまだ保存されておらず、下書きもできていないもの
//   ・1回の実行（最大5分）で作れるのは1〜2件。残りがあれば、自分自身をもう一度呼んで続きを進める
//   ・できた下書きは、事前共有のカードに「録画から下書きあり」と出る。人が確認して保存する
//
// 返事はすぐ返し、作業は返事のあとに続ける（呼び出し元を待たせない）。

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BUDGET_MS = 280 * 1000;
// 次の会議に取りかかるのに残しておく時間。これより残りが少なければ、続きは次の呼び出しに回す。
const START_MARGIN_MS = 170 * 1000;
// 自分自身を呼び直す回数の上限（止まらなくなるのを防ぐ）。
const MAX_DEPTH = 15;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  const h = req.headers.get('authorization') || '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// skip … この見回りですでに試した会議（うまくいかなかったものを、同じ見回りの中で何度も試さない）
async function work(self: string, started: number, skip: string[], depth: number) {
  const tried = new Set(skip);
  const summary = { made: [] as string[], failed: [] as string[], waiting: 0, left: 0 };
  try {
    const r = await listPreshareRows();
    if (!r.ok) {
      console.error('[ZOOM_CRON] list', r.reason);
      return;
    }
    const now = jstNow(Date.now());
    const over = r.items.filter(
      (row) => row.zoomMeetingId && !row.minutesId && meetingIsOver(parseSchedule(row.date, now.today), now),
    );
    const status = await jobStatuses(over.map((row) => row.id));
    // 下書きができているものは済み。古い会議から順に。
    const todo = over.filter((row) => status.get(row.id) !== 'done' && !tried.has(row.id)).reverse();

    for (const row of todo) {
      if (started + BUDGET_MS - Date.now() < START_MARGIN_MS) break;
      let finished = false;
      // 文字起こし → 議事録。1回で終わらなければ、時間の許すかぎり続きを進める。
      for (let i = 0; i < 2; i++) {
        const input = inputFromPreshare(row, { startedBy: '自動', deadline: started + BUDGET_MS });
        if (!input) break;
        const out = await advanceJob(input);
        if (!out.ok) {
          // 録画が無い・まだ処理中・ほかで作成中。次の見回りでまた見る。
          if (out.reason === 'no_recording' || out.reason === 'processing' || out.reason === 'busy') summary.waiting++;
          else summary.failed.push(`${row.title}(${out.reason})`);
          finished = true;
          break;
        }
        if (out.job.status === 'done') {
          summary.made.push(row.title);
          await logInteraction({
            user: '自動',
            campus: row.campus,
            input: `[Zoom録画から議事録・自動] ${row.title || '（会議名未入力）'}｜文字起こし${out.job.transcript.length}字（${out.job.source}）`,
            output: out.job.minutes,
          }).catch(() => {});
          finished = true;
          break;
        }
        if (out.job.status === 'error') {
          summary.failed.push(`${row.title}(${out.job.error})`);
          finished = true;
          break;
        }
        // 文字起こしはできたが、議事録づくりに失敗した。この見回りでは繰り返さない（次の見回りでやり直す）。
        if (out.job.error) {
          summary.failed.push(`${row.title}(${out.job.error})`);
          finished = true;
          break;
        }
        // 文字起こしまで済んだ。残り時間が足りなければ、議事録は次の呼び出しで作る。
        if (started + BUDGET_MS - Date.now() < 150000) break;
      }
      if (finished) tried.add(row.id);
    }
    summary.left = todo.filter((row) => !tried.has(row.id)).length;
  } catch (e) {
    console.error('[ZOOM_CRON] run', e instanceof Error ? e.message : String(e));
  }
  try {
    console.log('[ZOOM_CRON]', JSON.stringify({ depth, ...summary }));
  } catch {}

  // 残りがあれば、自分自身を呼んで続きを進める（返事はすぐ返ってくる）。
  if (summary.left > 0 && depth < MAX_DEPTH) {
    await fetch(self, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET || ''}` },
      body: JSON.stringify({ skip: Array.from(tried), depth: depth + 1 }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    }).catch((e) => console.error('[ZOOM_CRON] chain', e instanceof Error ? e.message : String(e)));
  }
}

async function handle(req: Request, skip: string[], depth: number) {
  const started = Date.now();
  if (!authorized(req)) return Response.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  if (!jobStoreReady()) return Response.json({ ok: false, reason: 'not_configured' }, { status: 503 });
  const u = new URL(req.url);
  waitUntil(work(`${u.origin}${u.pathname}`, started, skip, depth));
  return Response.json({ ok: true, started: true });
}

// Vercel Cron は GET で叩く。
export async function GET(req: Request) {
  return handle(req, [], 0);
}

// 続きの呼び出し（自分自身から）。
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const skip = Array.isArray(body?.skip) ? body.skip.filter((x: unknown) => typeof x === 'string').slice(0, 200) : [];
  const depth = Number.isInteger(body?.depth) ? Math.max(0, body.depth) : MAX_DEPTH;
  return handle(req, skip, depth);
}
