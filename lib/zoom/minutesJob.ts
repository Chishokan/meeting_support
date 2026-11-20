// Zoom の録画 → 文字起こし → 議事録の下書き（Zoom連携）。サーバ専用。
// -------------------------------------------------------------------------
// 1回の呼び出しで最後まで行けないことがある（長い会議は文字起こしだけで数分かかり、
// サーバの1回の実行時間は5分まで）。そのため、途中経過をデータベースに置き、
// 呼ばれるたびに「続きから」進める作りにしている。
//   ① 録画の音声を Zoom から取り出して文字起こし → 保存（status: transcribed）
//   ② 文字起こしから議事録の下書きを作る → 保存（status: done）
// 画面は transcribed が返ってきたら、もう一度呼んで ② を進める。

import Anthropic from '@anthropic-ai/sdk';
import { MODEL, THINKING } from '@/lib/systemPrompt';
import { buildDeptMinutesPrompt, buildDraftRequest, type MeetingMeta } from '@/lib/deptMinutesPrompt';
import { stripRoleBleed } from '@/lib/core/sanitize';
import { downloadRecordingFile, getRecording, ZoomError, type RecordingFile } from '@/lib/zoom/client';
import type { PreshareRow } from '@/lib/deptMinutesPreshare';
import { isZoomAccountId } from '@/lib/zoom/accounts';
import type { ZoomAccountId } from '@/lib/zoom/accounts';
import { pickAudio, pickZoomTranscript, stillProcessing, transcribeOrder } from '@/lib/zoom/recordingFiles';
import { transcribeWithGemini, transcribeWithOpenAI, type Attempt, type SourceResult } from '@/lib/zoom/transcribeRecording';
import { looksJapanese, vttToText } from '@/lib/zoom/vtt';
import { loadJob, purgeOldJobs, saveJob, type MinutesJob } from '@/lib/zoom/minutesStore';

// 取り出す音声の上限。音声だけなら1時間で約40MB なので、4時間の会議まで入る。
const MAX_AUDIO_BYTES = 180 * 1024 * 1024;
const MAX_VTT_BYTES = 5 * 1024 * 1024;
// 議事録づくりに渡す文字起こしの上限（app/api/dept-minutes と同じ）。
const MAX_TRANSCRIPT = 120000;
// 「作成中」のまま止まった下書きを、やり直せるようにするまでの時間。
const STALE_MS = 6 * 60 * 1000;
// 議事録づくりに残しておく時間。これより残りが少なければ、次の呼び出しに回す。
const MINUTES_BUDGET_MS = 150 * 1000;

const STOP = ['\n\nus', '\n\nUs', '\n\nassistant', '\n\nAssistant', '\n\nhuman', '\n\nHuman'];

export type JobInput = {
  account: ZoomAccountId;
  meetingId: string;
  preshareId: string;
  campus: string; // 会議の部門
  owner: string; // 事前共有した人（議事録の担当として入る）
  meta: MeetingMeta;
  startedBy: string;
  redo?: boolean; // 文字起こしからやり直す
  only?: string; // 文字起こしの任せ先を1つに決める（openai / gemini / zoom）
  deadline: number; // この時刻（ミリ秒）までに返す
};

// 下書きが無いまま終わる理由。
//   no_recording … 録画が無い（録画していない・Zoom 側で消した）
//   processing   … 録画はあるが Zoom がまだ処理中
//   busy         … ほかの人（または通知）が作成中
export type JobOutcome =
  | { ok: true; job: MinutesJob }
  | { ok: false; reason: 'no_recording' | 'processing' | 'busy' | 'not_configured' | 'zoom' | 'transcribe_failed'; detail?: string; job?: MinutesJob };

async function fromZoom(account: ZoomAccountId, files: RecordingFile[]): Promise<SourceResult> {
  const f = pickZoomTranscript(files);
  if (!f) return { ok: false, reason: 'no_transcript' };
  try {
    const bytes = await downloadRecordingFile(account, f, MAX_VTT_BYTES, 30000);
    const text = vttToText(new TextDecoder('utf-8').decode(bytes));
    if (!text) return { ok: false, reason: 'empty' };
    // 日本語の会議が英語として処理されていることがある。その結果は使わない。
    if (!looksJapanese(text)) return { ok: false, reason: 'not_japanese' };
    return { ok: true, text, model: 'zoom' };
  } catch (e) {
    return { ok: false, reason: 'download_failed', detail: e instanceof ZoomError ? e.detail : undefined };
  }
}

// prev … やり直しのときの、いまある下書き。やり直しが失敗したら、これを残す（うまくいった下書きを失わない）。
async function transcribe(input: JobInput, prev: MinutesJob | null): Promise<JobOutcome | { transcribed: true }> {
  const key = { account: input.account, meetingId: input.meetingId };
  let rec;
  try {
    rec = await getRecording(input.account, input.meetingId);
  } catch (e) {
    if (e instanceof ZoomError && e.reason === 'not_found') return { ok: false, reason: 'no_recording' };
    if (e instanceof ZoomError && e.reason === 'not_configured') return { ok: false, reason: 'not_configured' };
    return { ok: false, reason: 'zoom', detail: e instanceof ZoomError ? `${e.reason} ${e.detail ?? ''}`.trim() : undefined };
  }
  const audio = pickAudio(rec.files);
  const hasVtt = pickZoomTranscript(rec.files) !== null;
  if (!audio && !hasVtt) return { ok: false, reason: stillProcessing(rec.files) ? 'processing' : 'no_recording' };

  const keep = Boolean(prev?.transcript);
  await saveJob(key, {
    recordingUuid: rec.uuid, preshareId: input.preshareId, campus: input.campus, status: 'running', error: '',
    audioBytes: audio?.file.size ?? 0, durationMin: rec.durationMin, startedBy: input.startedBy,
    ...(keep ? {} : { source: '', model: '', attempts: [], transcript: '', minutes: '' }),
  });

  const order = transcribeOrder(process.env.ZOOM_TRANSCRIBE_ORDER, input.only);
  const attempts: Attempt[] = [];
  let bytes: Uint8Array | null = null;
  let downloadError = '';
  if (audio && order.some((s) => s !== 'zoom')) {
    try {
      bytes = await downloadRecordingFile(input.account, audio.file, MAX_AUDIO_BYTES, 120000);
    } catch (e) {
      downloadError = e instanceof ZoomError ? (e.detail ?? e.reason) : 'download';
    }
  }

  for (const source of order) {
    let r: SourceResult;
    if (source === 'zoom') r = await fromZoom(input.account, rec.files);
    else if (!audio || !bytes) r = { ok: false, reason: audio ? 'download_failed' : 'no_audio', detail: downloadError || undefined };
    else if (source === 'openai') r = await transcribeWithOpenAI(bytes, audio.ext, input.deadline - 15000);
    else r = await transcribeWithGemini(bytes, audio.ext, input.deadline - 15000);

    if (r.ok) {
      attempts.push({ source, ok: true, model: r.model, chars: r.text.length });
      await saveJob(key, { status: 'transcribed', source, model: r.model, attempts, transcript: r.text, minutes: '', error: '' });
      return { transcribed: true };
    }
    attempts.push({ source, ok: false, reason: r.reason, detail: r.detail });
    // 設定が無いだけの任せ先は静かに飛ばす。それ以外は、どこで落ちたかを記録に残す。
    if (r.reason !== 'not_configured') console.error('[ZOOM_MINUTES] transcribe failed', source, r.reason, r.detail ?? '');
  }
  if (keep && prev) {
    // やり直しが全部失敗した。前の下書きはそのまま残し、失敗したことだけ伝える。
    await saveJob(key, { status: prev.minutes ? 'done' : 'transcribed' });
    return { ok: false, reason: 'transcribe_failed', job: { ...prev, attempts } };
  }
  await saveJob(key, { status: 'error', attempts, error: 'transcribe_failed' });
  const job = await loadJob(input.account, input.meetingId);
  return job ? { ok: true, job } : { ok: false, reason: 'zoom' };
}

async function writeMinutes(input: JobInput, transcript: string): Promise<string> {
  const client = new Anthropic();
  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: 12000,
      thinking: THINKING,
      system: [{ type: 'text', text: buildDeptMinutesPrompt(input.campus, input.owner), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildDraftRequest(input.meta, transcript.slice(0, MAX_TRANSCRIPT)) }],
      stop_sequences: STOP,
    },
    { timeout: Math.max(20000, input.deadline - Date.now() - 5000) },
  );
  const msg = await stream.finalMessage();
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return stripRoleBleed(text).trim();
}

/** 下書きづくりを、いまの状態から進められるところまで進める。 */
export async function advanceJob(input: JobInput): Promise<JobOutcome> {
  const key = { account: input.account, meetingId: input.meetingId };
  void purgeOldJobs();
  let job = await loadJob(input.account, input.meetingId);

  // ほかの呼び出しが作成中なら、二重に走らせない（止まったままのものは時間で解放する）。
  if (job?.status === 'running' && Date.now() - new Date(job.updatedAt).getTime() < STALE_MS) {
    return { ok: false, reason: 'busy', job };
  }

  if (input.redo || !job || !job.transcript) {
    const r = await transcribe(input, input.redo ? job : null);
    if (!('transcribed' in r)) return r;
    job = await loadJob(input.account, input.meetingId);
    if (!job) return { ok: false, reason: 'zoom' };
  }
  if (job.status === 'done' && job.minutes) return { ok: true, job };

  // 残り時間が少なければ、議事録づくりは次の呼び出しに回す（文字起こしは保存済み）。
  if (input.deadline - Date.now() < MINUTES_BUDGET_MS) {
    if (job.status !== 'transcribed') await saveJob(key, { status: 'transcribed' });
    return { ok: true, job: { ...job, status: 'transcribed' } };
  }

  await saveJob(key, { status: 'running', error: '' });
  try {
    const minutes = await writeMinutes(input, job.transcript);
    if (!minutes) throw new Error('empty');
    await saveJob(key, { status: 'done', minutes, error: '' });
  } catch (e) {
    console.error('[ZOOM_MINUTES] minutes failed', e instanceof Error ? e.message : String(e));
    // 文字起こしは残す。次に呼ばれたら議事録づくりだけをやり直す。
    await saveJob(key, { status: 'transcribed', error: 'minutes_failed' });
  }
  const done = await loadJob(input.account, input.meetingId);
  return done ? { ok: true, job: done } : { ok: false, reason: 'zoom' };
}

/** 事前共有の行から、下書きづくりに渡す内容を組み立てる。Zoom ミーティングが無い行は null。 */
export function inputFromPreshare(
  row: PreshareRow,
  opts: { startedBy: string; deadline: number; redo?: boolean; only?: string },
): JobInput | null {
  if (!row.zoomMeetingId || !isZoomAccountId(row.zoomAccount ?? '')) return null;
  return {
    account: row.zoomAccount as ZoomAccountId,
    meetingId: row.zoomMeetingId,
    preshareId: row.id,
    campus: row.campus,
    owner: row.user,
    meta: { title: row.title, date: row.date, place: row.place, attendees: row.attendees, agenda: row.agenda },
    startedBy: opts.startedBy,
    redo: opts.redo,
    only: opts.only,
    deadline: opts.deadline,
  };
}
