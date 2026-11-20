// 録画から作った議事録の下書きの置き場（Zoom連携）。サーバ専用。
// テーブルは supabase/migrations/0005_zoom_minutes_jobs.sql。

import { supabaseAdmin } from '@/lib/core/supabase';
import type { Attempt } from '@/lib/zoom/transcribeRecording';

// running … 作成中 / transcribed … 文字起こしまで済み（議事録はこれから）/ done … 下書きまで完成 / error … 失敗
export type JobStatus = 'running' | 'transcribed' | 'done' | 'error';

export type MinutesJob = {
  account: string;
  meetingId: string;
  recordingUuid: string;
  preshareId: string;
  campus: string;
  status: JobStatus;
  source: string;
  model: string;
  attempts: Attempt[];
  transcript: string;
  minutes: string;
  error: string;
  audioBytes: number;
  durationMin: number;
  startedBy: string;
  updatedAt: string;
};

// 文字起こし全文を持つので、長くは置かない。
export const JOB_KEEP_DAYS = 14;

const TABLE = 'zoom_minutes_jobs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRow(r: any): MinutesJob {
  return {
    account: String(r.account ?? ''),
    meetingId: String(r.meeting_id ?? ''),
    recordingUuid: String(r.recording_uuid ?? ''),
    preshareId: String(r.preshare_id ?? ''),
    campus: String(r.campus ?? ''),
    status: (['running', 'transcribed', 'done', 'error'].includes(r.status) ? r.status : 'error') as JobStatus,
    source: String(r.source ?? ''),
    model: String(r.model ?? ''),
    attempts: Array.isArray(r.attempts) ? (r.attempts as Attempt[]) : [],
    transcript: String(r.transcript ?? ''),
    minutes: String(r.minutes ?? ''),
    error: String(r.error ?? ''),
    audioBytes: Number(r.audio_bytes) || 0,
    durationMin: Number(r.duration_min) || 0,
    startedBy: String(r.started_by ?? ''),
    updatedAt: String(r.updated_at ?? ''),
  };
}

export function jobStoreReady(): boolean {
  return supabaseAdmin() !== null;
}

export async function loadJob(account: string, meetingId: string): Promise<MinutesJob | null> {
  const db = supabaseAdmin();
  if (!db) return null;
  const { data, error } = await db.from(TABLE).select('*').eq('account', account).eq('meeting_id', meetingId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

/** 下書きを書き込む（同じミーティングは上書き）。渡した項目だけを変える。 */
export async function saveJob(
  key: { account: string; meetingId: string },
  patch: Partial<Omit<MinutesJob, 'account' | 'meetingId' | 'updatedAt'>>,
): Promise<void> {
  const db = supabaseAdmin();
  if (!db) throw new Error('not_configured');
  const row: Record<string, unknown> = { account: key.account, meeting_id: key.meetingId, updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    recordingUuid: 'recording_uuid', preshareId: 'preshare_id', campus: 'campus', status: 'status', source: 'source',
    model: 'model', attempts: 'attempts', transcript: 'transcript', minutes: 'minutes', error: 'error',
    audioBytes: 'audio_bytes', durationMin: 'duration_min', startedBy: 'started_by',
  };
  for (const [k, v] of Object.entries(patch)) if (map[k] && v !== undefined) row[map[k]] = v;
  const { error } = await db.from(TABLE).upsert(row, { onConflict: 'account,meeting_id' });
  if (error) throw new Error(error.message);
}

/** 事前共有ごとの下書きの状態（一覧のカードに「下書きあり」を出すため）。失敗したら空。 */
export async function jobStatuses(preshareIds: string[]): Promise<Map<string, JobStatus>> {
  const out = new Map<string, JobStatus>();
  const db = supabaseAdmin();
  const ids = preshareIds.filter(Boolean);
  if (!db || ids.length === 0) return out;
  try {
    const { data } = await db.from(TABLE).select('preshare_id, status').in('preshare_id', ids);
    for (const r of data ?? []) out.set(String(r.preshare_id), fromRow(r).status);
  } catch {}
  return out;
}

/** 事前共有を削除したとき・議事録を作り直すときに消す。失敗しても呼び出し元は止めない。 */
export async function deleteJobs(preshareId: string): Promise<void> {
  const db = supabaseAdmin();
  if (!db || !preshareId) return;
  try {
    await db.from(TABLE).delete().eq('preshare_id', preshareId);
  } catch {}
}

/** 古い下書きを消す（文字起こし全文を長く残さない）。失敗しても呼び出し元は止めない。 */
export async function purgeOldJobs(): Promise<void> {
  const db = supabaseAdmin();
  if (!db) return;
  try {
    const before = new Date(Date.now() - JOB_KEEP_DAYS * 86400000).toISOString();
    await db.from(TABLE).delete().lt('updated_at', before);
  } catch {}
}
