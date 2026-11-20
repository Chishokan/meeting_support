'use client';

// 手順2に出す「Zoom の録画から議事録をつくる」（Zoom連携）。
// 事前共有から Zoom ミーティングを作った会議を読み込んでいるときだけ出す。
//   ・押すと、サーバが録画の音声を取り出して文字起こしし、議事録の下書きまで作る（数分かかる）
//   ・できた文字起こしと下書きを画面に読み込み、あとはいつもどおり手順3で確認・保存する
// 録画完了の通知で自動的に作られていた場合は、開いた時点で「下書きができています」と出る。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreshareRow } from '@/lib/deptMinutesPreshare';
import { failedAttemptsText, jobErrorText, sourceLabel, type AttemptLike } from '@/lib/zoom/minutesText';

type JobView = {
  status: 'running' | 'transcribed' | 'done' | 'error';
  source: string;
  attempts: AttemptLike[];
  transcript: string;
  minutes: string;
  error: string;
  durationMin: number;
};

// サーバは1回で最後まで行けないことがある（文字起こし → 議事録の2段階）。続きを呼ぶ回数の上限。
const MAX_ROUNDS = 4;
const POLL_MS = 10000;

export default function ZoomMinutesBox({
  row,
  disabled,
  onLoad,
}: {
  row: PreshareRow;
  disabled: boolean; // 録音・文字起こし・保存の途中は押せないようにする
  onLoad: (transcript: string, minutes: string, sourceText: string) => boolean; // 読み込んだら true
}) {
  const [job, setJob] = useState<JobView | null>(null);
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [only, setOnly] = useState('');
  const alive = useRef(true);
  const preshareId = row.id;

  const fetchJob = useCallback(async (): Promise<JobView | null> => {
    const res = await fetch(`/api/zoom/minutes?preshareId=${encodeURIComponent(preshareId)}`, { cache: 'no-store' });
    const j = await res.json().catch(() => null);
    return j?.ok ? (j.job as JobView | null) : null;
  }, [preshareId]);

  useEffect(() => {
    alive.current = true;
    setJob(null);
    setMsg('');
    setErr('');
    void fetchJob().then((j) => {
      if (alive.current) setJob(j);
    }).catch(() => {});
    return () => {
      alive.current = false;
    };
  }, [fetchJob]);

  // ほかの人（または録画完了の通知）が作成中のときは、終わるまで様子を見る。
  useEffect(() => {
    if (working || job?.status !== 'running') return;
    const t = setInterval(() => {
      void fetchJob().then((j) => {
        if (alive.current && j) setJob(j);
      }).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [working, job?.status, fetchJob]);

  function load(j: JobView) {
    const used = sourceLabel(j.source);
    if (onLoad(j.transcript, j.minutes, used)) setMsg('下の手順3に読み込みました。内容を確認して保存してください。');
  }

  async function run(redo: boolean) {
    if (working || disabled) return;
    if (redo && !confirm('録画の文字起こしからやり直します。数分かかります。よろしいですか？')) return;
    setErr('');
    setMsg('録画を取り出して文字起こししています…（会議の長さによって数分かかります。このままお待ちください）');
    setWorking(true);
    try {
      for (let i = 0; i < MAX_ROUNDS; i++) {
        const res = await fetch('/api/zoom/minutes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preshareId, redo: redo && i === 0, only: only || undefined }),
        });
        const j = await res.json().catch(() => null);
        if (!alive.current) return;
        if (!j?.ok) {
          if (j?.job) setJob(j.job as JobView);
          setMsg('');
          setErr(jobErrorText(j?.reason));
          return;
        }
        const next = j.job as JobView;
        setJob(next);
        if (next.status === 'done') {
          setMsg('');
          load(next);
          return;
        }
        if (next.status === 'error') {
          setMsg('');
          setErr(jobErrorText(next.error));
          return;
        }
        // 文字起こしまで済んだ。続けて議事録を作らせる。
        setMsg(`文字起こしができました（${sourceLabel(next.source)}・${next.transcript.length.toLocaleString()}字）。議事録を作成しています…`);
      }
      setMsg('');
      setErr(jobErrorText('minutes_failed'));
    } catch {
      if (alive.current) {
        setMsg('');
        // 通信が切れてもサーバ側は続いていることがある。状態を取り直して出す。
        const j = await fetchJob().catch(() => null);
        if (j) setJob(j);
        setErr(j?.status === 'running' ? jobErrorText('busy') : jobErrorText(''));
      }
    } finally {
      if (alive.current) setWorking(false);
    }
  }

  const failed = failedAttemptsText(job?.attempts);
  const status = job?.status;

  return (
    <div className="dm-zoomrec">
      <div className="dm-zoomrec-head">
        <strong>Zoom の録画から作る</strong>
        <span>この会議は Zoom ミーティングで開いています。録画があれば、音声の取り込みは不要です。</span>
      </div>

      {status === 'done' && !working && (
        <p className="dm-zoomrec-done">
          議事録の下書きができています（文字起こし：{sourceLabel(job?.source)}
          {job?.durationMin ? `・録画 ${job.durationMin}分` : ''}）。
        </p>
      )}
      {status === 'running' && !working && <p className="dm-zoomrec-note">{jobErrorText('busy')}</p>}

      <div className="dm-zoomrec-actions">
        {status === 'done' ? (
          <button className="dm-zoomrec-btn" onClick={() => job && load(job)} disabled={disabled || working}>
            下書きを読み込む
          </button>
        ) : (
          <button className="dm-zoomrec-btn" onClick={() => void run(false)} disabled={disabled || working || status === 'running'}>
            {working ? '作成中…' : status === 'transcribed' ? '続きから作る' : '録画から議事録をつくる'}
          </button>
        )}
        {(status === 'done' || status === 'error' || status === 'transcribed') && (
          <>
            <select value={only} onChange={(e) => setOnly(e.target.value)} disabled={working} aria-label="文字起こしの任せ先">
              <option value="">文字起こし：おまかせ</option>
              <option value="openai">OpenAI で</option>
              <option value="gemini">Gemini で</option>
              <option value="zoom">Zoom の文字起こしで（予備）</option>
            </select>
            <button className="dm-zoomrec-sub" onClick={() => void run(true)} disabled={disabled || working}>
              文字起こしからやり直す
            </button>
          </>
        )}
      </div>

      {msg && <p className="dm-zoomrec-note">{msg}</p>}
      {err && <p className="dm-zoomrec-err">{err}</p>}
      {failed && !working && <p className="dm-zoomrec-fine">うまくいかなかった方法：{failed}</p>}
    </div>
  );
}
