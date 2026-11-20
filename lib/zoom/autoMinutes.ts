// Zoom の録画から、議事録を自動で作って保存する（Zoom連携）。サーバ専用。
// 毎朝の見回り（app/api/zoom/minutes/cron）と、録画完了の通知（app/api/zoom/webhook）が使う。
//   ① 録画の音声を文字起こしし、議事録を作る（lib/zoom/minutesJob.ts。途中からでも続きを進める）
//   ② できた議事録を、そのままスプレッドシートに保存する（人の確認を待たない）
// 保存した議事録の先頭には「自動で作成した」ことを書く。誤りは、議事録の［修正する］で直せる。
//
// 画面の［録画から議事録をつくる］は、これまでどおり人が確認してから保存する（ここは通らない）。

import { logInteraction } from '@/lib/core/log';
import type { PreshareRow } from '@/lib/deptMinutesPreshare';
import { saveMinutesToSheet } from '@/lib/deptMinutesSave';
import { advanceJob, inputFromPreshare } from '@/lib/zoom/minutesJob';
import { saveJob, type MinutesJob } from '@/lib/zoom/minutesStore';
import { sourceLabel } from '@/lib/zoom/minutesText';

// saved   … 議事録を保存した
// waiting … 録画が無い・Zoom が処理中・ほかで作成中（次の見回りでまた見る）
// pending … 途中まで進んだ（時間切れ。続きは次の呼び出しで）
export type AutoResult = 'saved' | 'waiting' | 'pending' | { failed: string };

// 議事録づくりに取りかかるのに要る残り時間。
const MINUTES_MARGIN_MS = 150 * 1000;

async function autoSave(row: PreshareRow, job: MinutesJob): Promise<AutoResult> {
  const key = { account: job.account, meetingId: job.meetingId };
  // 保存のあいだは「作成中」にして、ほかの呼び出しが同じ議事録を二重に保存しないようにする。
  await saveJob(key, { status: 'running' });
  const used = sourceLabel(job.source).replace('（予備）', '');
  const r = await saveMinutesToSheet({
    preshareId: row.id,
    campus: row.campus,
    user: row.user,
    meta: { title: row.title, date: row.date, place: row.place, attendees: row.attendees, agenda: row.agenda },
    content: job.minutes,
    note: `※ Zoom の録画から自動で作成した議事録です${used ? `（文字起こし：${used}）` : ''}。内容に誤りがあれば［修正する］で直してください。`,
  });
  // 文字起こしは、保存した議事録を見直すときのために期限（14日）まで残す。
  await saveJob(key, { status: 'done' });
  if (!r.ok) {
    console.error('[ZOOM_AUTO] save failed', row.id, r.reason);
    return { failed: `save_${r.reason}` };
  }
  await logInteraction({
    user: '自動',
    campus: row.campus,
    input: `[Zoom録画から議事録・自動保存] ${row.title || '（会議名未入力）'}｜文字起こし${job.transcript.length}字（${job.source}）｜決定事項${r.decisions}件`,
    output: job.minutes,
  }).catch(() => {});
  return 'saved';
}

/** 1つの会議について、議事録の作成から保存までを、時間の許すところまで進める。 */
export async function runAuto(row: PreshareRow, deadline: number): Promise<AutoResult> {
  for (let i = 0; i < 2; i++) {
    const input = inputFromPreshare(row, { startedBy: '自動', deadline });
    if (!input) return { failed: 'no_zoom' };
    const out = await advanceJob(input);
    if (!out.ok) {
      if (out.reason === 'no_recording' || out.reason === 'processing' || out.reason === 'busy') return 'waiting';
      return { failed: out.reason };
    }
    const job = out.job;
    if (job.status === 'done' && job.minutes) return autoSave(row, job);
    if (job.status === 'error') return { failed: job.error || 'error' };
    // 文字起こしはできたが、議事録づくりに失敗した。続けては繰り返さない（次の見回りでやり直す）。
    if (job.error) return { failed: job.error };
    // 文字起こしまで済んだ。残り時間が足りなければ、議事録は次の呼び出しで作る。
    if (deadline - Date.now() < MINUTES_MARGIN_MS) return 'pending';
  }
  return 'pending';
}
