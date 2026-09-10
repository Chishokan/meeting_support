'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SEGMENT_SECONDS, fmtDuration, splitAudioFile } from '@/lib/audioChunk';
import { templateOutline } from '@/lib/deptMinutesTemplate';
import type { DecisionRow } from '@/app/api/dept-minutes/list/route';

// 録音は1区間ずつ独立したファイルにして、会議中から順に文字起こししていく。
// 会議が終わった時点でほぼ文字起こしが終わっている状態にするための作り。
const REC_SEGMENT_SECONDS = 120;

const REC_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

const STORE_KEY = 'chishokan_dept_minutes_v1';

type Meta = { title: string; date: string; place: string; attendees: string; agenda: string };
type Source = 'record' | 'file' | 'paste';

const EMPTY_META: Meta = { title: '', date: '', place: '', attendees: '', agenda: '' };

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of REC_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {}
  }
  return '';
}

function extFor(mime: string): string {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDate(s: string) {
  const m = s.match(/(\d{1,4})[/-](\d{1,2})[/-](\d{1,2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}` : s;
}

export default function DeptMinutesUI({ name, campus }: { name: string; campus: string }) {
  const [meta, setMeta] = useState<Meta>({ ...EMPTY_META, date: todayLocal() });
  const [source, setSource] = useState<Source>('record');
  const [transcript, setTranscript] = useState('');
  const [draft, setDraft] = useState('');
  const [instruction, setInstruction] = useState('');

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [queued, setQueued] = useState(0); // 文字起こし待ちの区間数
  const [fileProgress, setFileProgress] = useState({ done: 0, total: 0 });
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [decFilter, setDecFilter] = useState('');
  const [showTemplate, setShowTemplate] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const segTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef(false);
  const queueRef = useRef<Blob[]>([]);
  const workingRef = useRef(false);
  const mimeRef = useRef('');
  const loaded = useRef(false);

  // ---- 下書きの保持（会議の録音は取り直せないので、リロードでも消さない） ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        if (j?.meta) setMeta({ ...EMPTY_META, ...j.meta });
        if (typeof j?.transcript === 'string') setTranscript(j.transcript);
        if (typeof j?.draft === 'string') setDraft(j.draft);
      }
    } catch {}
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ meta, transcript, draft }));
    } catch {}
  }, [meta, transcript, draft]);

  // ---- 文字起こしが使える設定か ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/dept-minutes/transcribe');
        const j = await res.json().catch(() => ({}));
        if (alive) setConfigured(Boolean(j?.configured));
      } catch {
        if (alive) setConfigured(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadDecisions = useCallback(async () => {
    try {
      const res = await fetch('/api/dept-minutes/list');
      const j = await res.json().catch(() => ({}));
      if (j?.ok && Array.isArray(j.items)) setDecisions(j.items as DecisionRow[]);
    } catch {}
  }, []);

  useEffect(() => {
    void loadDecisions();
  }, [loadDecisions]);

  // ---- 文字起こし（1区間ずつ順番に送る） ----
  const sendSegment = useCallback(async (blob: Blob, filename: string): Promise<string> => {
    const form = new FormData();
    form.append('audio', blob, filename);
    const res = await fetch('/api/dept-minutes/transcribe', { method: 'POST', body: form });
    const j = await res.json().catch(() => ({}));
    if (j?.ok) return String(j.text ?? '');
    if (j?.reason === 'not_configured') throw new Error('not_configured');
    throw new Error('failed');
  }, []);

  const pump = useCallback(async () => {
    if (workingRef.current) return;
    workingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const blob = queueRef.current[0];
        try {
          const text = await sendSegment(blob, `segment.${extFor(mimeRef.current)}`);
          if (text) setTranscript((prev) => (prev ? `${prev}\n${text}` : text));
        } catch (e) {
          setErr(
            (e as Error).message === 'not_configured'
              ? '音声の自動文字起こしが未設定のため、録音を文字にできませんでした。'
              : '一部の区間の文字起こしに失敗しました。時間をおいて録り直すか、テキストの貼り付けをご利用ください。',
          );
        }
        queueRef.current.shift();
        setQueued(queueRef.current.length);
      }
    } finally {
      workingRef.current = false;
    }
  }, [sendSegment]);

  const enqueue = useCallback(
    (blob: Blob) => {
      if (blob.size === 0) return;
      queueRef.current.push(blob);
      setQueued(queueRef.current.length);
      void pump();
    },
    [pump],
  );

  // ---- 録音 ----
  const beginSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = mimeRef.current;
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      enqueue(new Blob(chunks, { type: mime || 'audio/webm' }));
      if (recordingRef.current) {
        // まだ録音中なら次の区間をすぐ始める（会議は途切れない）。
        beginSegment();
      } else {
        // 終了時のマイク解放は最後の区間を受け取ってから。
        // 先にトラックを止めると、最後の数秒が欠けることがある。
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    recRef.current = rec;
    rec.start();
    segTimer.current = setTimeout(() => {
      try {
        rec.stop();
      } catch {}
    }, REC_SEGMENT_SECONDS * 1000);
  }, [enqueue]);

  const stopRecording = useCallback(() => {
    recordingRef.current = false;
    setRecording(false);
    if (segTimer.current) clearTimeout(segTimer.current);
    if (tickTimer.current) clearInterval(tickTimer.current);
    segTimer.current = null;
    tickTimer.current = null;
    // 録音中なら stop() → onstop で最後の区間を受け取ってからマイクを解放する。
    // 録音していなければここで解放する。
    let stopping = false;
    try {
      if (recRef.current && recRef.current.state !== 'inactive') {
        recRef.current.stop();
        stopping = true;
      }
    } catch {}
    recRef.current = null;
    if (!stopping) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  async function startRecording() {
    setErr('');
    setNote('');
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setErr('このブラウザは録音に対応していません。録音アプリで録った音声ファイルを添付してください。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      mimeRef.current = pickMime();
      recordingRef.current = true;
      setRecording(true);
      setElapsed(0);
      tickTimer.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      beginSegment();
    } catch {
      setErr('マイクを使えませんでした。ブラウザのマイク許可をご確認ください。');
    }
  }

  // 画面を離れるときにマイクを解放する。
  useEffect(() => () => stopRecording(), [stopRecording]);

  // ---- 音声ファイルの添付 ----
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    setNote('音声を読み込んでいます…');
    try {
      const { segments, durationSec } = await splitAudioFile(file);
      setNote(`${fmtDuration(durationSec)}の音声を${segments.length}区間に分けて文字起こしします。`);
      setFileProgress({ done: 0, total: segments.length });
      for (let i = 0; i < segments.length; i++) {
        try {
          const text = await sendSegment(segments[i], `part${i + 1}.wav`);
          if (text) setTranscript((prev) => (prev ? `${prev}\n${text}` : text));
        } catch (ex) {
          if ((ex as Error).message === 'not_configured') {
            setErr('音声の自動文字起こしが未設定です。文字起こしテキストの貼り付けをご利用ください。');
            break;
          }
          setErr(`区間 ${i + 1} の文字起こしに失敗しました。続きを処理します。`);
        }
        setFileProgress({ done: i + 1, total: segments.length });
      }
      setNote('文字起こしが終わりました。内容を確認してから議事録を作成してください。');
    } catch {
      setErr('この音声ファイルを読み込めませんでした。mp3 / m4a / wav などでお試しください。');
      setNote('');
    } finally {
      setFileProgress({ done: 0, total: 0 });
    }
  }

  // ---- 議事録の生成 ----
  async function generate(mode: 'draft' | 'revise') {
    if (generating) return;
    const text = transcript.trim();
    if (!text) {
      setErr('先に会議の文字起こしを用意してください。');
      return;
    }
    if (mode === 'revise' && !instruction.trim()) return;
    setErr('');
    setNote('');
    setGenerating(true);
    setDraft('');
    try {
      const res = await fetch('/api/dept-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, meta, transcript: text, draft, instruction }),
      });
      if (!res.ok || !res.body) throw new Error('failed');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setDraft(acc);
      }
      if (mode === 'revise') setInstruction('');
    } catch {
      setErr('議事録の作成に失敗しました。もう一度お試しください。');
    } finally {
      setGenerating(false);
    }
  }

  // ---- 保存 ----
  async function save() {
    if (saving || !draft.trim()) return;
    setErr('');
    setNote('保存中…');
    setSaving(true);
    try {
      const res = await fetch('/api/dept-minutes/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta, content: draft }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setNote(`保存しました（決定事項 ${j.decisions ?? 0} 件を全社共有に登録）。`);
        void loadDecisions();
      } else if (j?.reason === 'not_configured') {
        setNote('スプレッドシート連携が未設定のため、この端末にのみ保存しました。');
      } else {
        setErr('保存に失敗しました。時間をおいてお試しください。');
        setNote('');
      }
    } catch {
      setErr('保存に失敗しました。通信状況をご確認ください。');
      setNote('');
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    if (!confirm('入力中の会議情報・文字起こし・議事録をすべて消して、新しい会議を始めますか？')) return;
    stopRecording();
    queueRef.current = [];
    setQueued(0);
    setMeta({ ...EMPTY_META, date: todayLocal() });
    setTranscript('');
    setDraft('');
    setInstruction('');
    setNote('');
    setErr('');
  }

  const set = (k: keyof Meta) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setMeta((m) => ({ ...m, [k]: e.target.value }));

  const busyTranscribe = queued > 0 || fileProgress.total > 0;
  const shownDecisions = decisions.filter((d) =>
    decFilter ? d.campus === decFilter : true,
  );
  const campusesInList = Array.from(new Set(decisions.map((d) => d.campus).filter(Boolean)));

  return (
    <div className="dm">
      <div className="page-head">
        <h1>部門会議議事録</h1>
        <p>
          {campus}／{name} さん。会議を録音して文字起こしし、議事録テンプレートに沿って整えます。
          内容を確認して保存すると、決定事項が全部門で見られるようになります。
        </p>
        <button className="reset-chat" onClick={reset} disabled={generating || saving || recording}>
          新しい会議
        </button>
      </div>

      <div className="dm-body">
        <div className="dm-main">
          {/* ---------- 1. 会議情報 ---------- */}
          <section className="dm-step">
            <h2><span className="dm-num">1</span>会議の情報</h2>
            <div className="dm-fields">
              <label>
                <span>会議名</span>
                <input value={meta.title} onChange={set('title')} placeholder="例：小中等部 定例会議" />
              </label>
              <label>
                <span>開催日時</span>
                <input value={meta.date} onChange={set('date')} placeholder="例：2026/9/10 18:00〜19:00" />
              </label>
              <label>
                <span>場所</span>
                <input value={meta.place} onChange={set('place')} placeholder="例：本部会議室 / オンライン" />
              </label>
              <label className="wide">
                <span>出席者</span>
                <input value={meta.attendees} onChange={set('attendees')} placeholder="例：直江、安東、池田、山中" />
              </label>
              <label className="wide">
                <span>予定していた議題（1行1件・任意）</span>
                <textarea
                  value={meta.agenda}
                  onChange={set('agenda')}
                  placeholder={'例：\n9月の生徒数と対策\n中間テスト対策の役割分担\n面談週間の日程'}
                />
              </label>
            </div>
            <p className="dm-hint">
              予定議題を入れておくと、「予定どおり進んだか」「話し合えなかった議題はどれか」まで議事録に出ます。
            </p>
          </section>

          {/* ---------- 2. 音声 → 文字起こし ---------- */}
          <section className="dm-step">
            <h2><span className="dm-num">2</span>会議の音声を文字にする</h2>

            {configured === false && (
              <p className="dm-warn">
                音声の自動文字起こしが未設定です。管理者に環境変数 <code>SPEECH_API_KEY</code> の設定を依頼してください。
                設定までは「文字起こしを貼り付け」をご利用いただけます。
              </p>
            )}

            <div className="dm-tabs">
              <button
                className={`dm-tab ${source === 'record' ? 'active' : ''}`}
                onClick={() => setSource('record')}
                disabled={recording}
              >
                その場で録音
              </button>
              <button
                className={`dm-tab ${source === 'file' ? 'active' : ''}`}
                onClick={() => setSource('file')}
                disabled={recording}
              >
                録音ファイルを添付
              </button>
              <button
                className={`dm-tab ${source === 'paste' ? 'active' : ''}`}
                onClick={() => setSource('paste')}
                disabled={recording}
              >
                文字起こしを貼り付け
              </button>
            </div>

            {source === 'record' && (
              <div className="dm-source">
                <div className="dm-rec">
                  {!recording ? (
                    <button className="dm-rec-btn" onClick={startRecording} disabled={configured === false}>
                      ● 録音を開始
                    </button>
                  ) : (
                    <button className="dm-rec-btn stop" onClick={stopRecording}>
                      ■ 録音を終了
                    </button>
                  )}
                  {recording && <span className="dm-rec-time">録音中 {fmtDuration(elapsed)}</span>}
                  {queued > 0 && <span className="dm-rec-note">文字起こし待ち {queued} 区間</span>}
                </div>
                <p className="dm-hint">
                  録音は{REC_SEGMENT_SECONDS / 60}分ごとに区切って、会議中から順に文字にしていきます。
                  会議が終わるころには文字起こしもほぼ終わっています。画面を閉じると録音は止まります。
                </p>
              </div>
            )}

            {source === 'file' && (
              <div className="dm-source">
                <input type="file" accept="audio/*,video/*" onChange={onPickFile} disabled={configured === false} />
                {fileProgress.total > 0 && (
                  <p className="dm-progress">
                    文字起こし中… {fileProgress.done} / {fileProgress.total} 区間
                  </p>
                )}
                <p className="dm-hint">
                  スマートフォンの録音アプリ等で録った音声（mp3 / m4a / wav など）を選んでください。
                  長い会議は自動で{SEGMENT_SECONDS}秒ずつに分けて処理します。
                </p>
              </div>
            )}

            {source === 'paste' && (
              <div className="dm-source">
                <p className="dm-hint">
                  他のアプリで文字起こし済みのテキストがあれば、下の欄に直接貼り付けてください。
                </p>
              </div>
            )}

            <label className="dm-transcript">
              <span>
                文字起こし（{transcript.length.toLocaleString()}字）
                {busyTranscribe && <em>　処理中…</em>}
              </span>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="ここに会議の文字起こしが入ります。誤変換はここで直せます。"
              />
            </label>

            <div className="dm-actions">
              <button
                className="dm-primary"
                onClick={() => void generate('draft')}
                disabled={generating || !transcript.trim() || recording}
              >
                {generating ? '作成中…' : '議事録を作成'}
              </button>
              {recording && <span className="dm-note">録音を終了してから作成してください。</span>}
            </div>
          </section>

          {/* ---------- 3. 確認・保存 ---------- */}
          <section className="dm-step">
            <h2><span className="dm-num">3</span>内容を確認して保存</h2>
            {!draft && !generating ? (
              <p className="dm-hint">議事録を作成すると、ここに表示されます。そのまま手で直せます。</p>
            ) : (
              <>
                <textarea
                  className="dm-draft"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="議事録を作成しています…"
                />
                <div className="dm-revise">
                  <input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="AIに直してほしいこと（例：決定事項3の担当を池田に）"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && instruction.trim()) void generate('revise');
                    }}
                  />
                  <button onClick={() => void generate('revise')} disabled={generating || !instruction.trim()}>
                    修正を依頼
                  </button>
                </div>
                <div className="dm-actions">
                  <button className="dm-save" onClick={save} disabled={saving || generating || !draft.trim()}>
                    {saving ? '保存中…' : '確認しました・保存する'}
                  </button>
                  <button
                    className="dm-copy"
                    onClick={() => navigator.clipboard?.writeText(draft)}
                    disabled={!draft.trim()}
                  >
                    コピー
                  </button>
                </div>
                <p className="dm-hint">
                  保存すると「■ 決定事項」が1件ずつ切り出され、全部門の決定事項一覧に載ります。
                  決まっていないことが決定事項に混ざっていないか、保存前にご確認ください。
                </p>
              </>
            )}
            {note && <p className="dm-note ok">{note}</p>}
            {err && <p className="dm-note err">{err}</p>}
          </section>
        </div>

        {/* ---------- 右：全部門の決定事項 ---------- */}
        <aside className="dm-side">
          <div className="dm-panel">
            <div className="dm-panel-head">
              <h2>部門横断の決定事項</h2>
              <button className="dm-reload" onClick={() => void loadDecisions()}>更新</button>
            </div>
            {campusesInList.length > 0 && (
              <select className="dm-filter" value={decFilter} onChange={(e) => setDecFilter(e.target.value)}>
                <option value="">すべての部門</option>
                {campusesInList.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            {shownDecisions.length === 0 ? (
              <p className="dm-empty">
                まだ登録された決定事項はありません。議事録を保存すると、ここに全部門分が並びます。
              </p>
            ) : (
              <ul className="dm-dec-list">
                {shownDecisions.slice(0, 40).map((d, i) => (
                  <li key={`${d.ts}-${i}`}>
                    <div className="dm-dec-head">
                      <span className="dm-dec-campus">{d.campus}</span>
                      <span className="dm-dec-date">{fmtDate(d.date || d.ts)}</span>
                    </div>
                    <div className="dm-dec-title">{d.title || d.detail}</div>
                    {d.detail && d.title && <p className="dm-dec-detail">{d.detail}</p>}
                    <div className="dm-dec-meta">
                      {d.owner && <span>担当：{d.owner}</span>}
                      {d.due && <span>期限：{d.due}</span>}
                      {d.related && <span>関係：{d.related}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="dm-panel">
            <div className="dm-panel-head">
              <h2>議事録テンプレート</h2>
              <button className="dm-reload" onClick={() => setShowTemplate((v) => !v)}>
                {showTemplate ? '閉じる' : '見る'}
              </button>
            </div>
            {showTemplate ? (
              <ol className="dm-tpl">
                {templateOutline().map((t) => (
                  <li key={t.heading}>
                    <b>{t.heading}</b>
                    <span>{t.guide}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="dm-empty">
                AIはこのテンプレートに沿って議事録を作り、沿わなかった点を「会議の質チェック」として指摘します。
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
