'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SEGMENT_SECONDS, fmtDuration, splitAudioFile } from '@/lib/audioChunk';
import { templateOutline } from '@/lib/deptMinutesTemplate';
import { extractDecisions, extractSection, summarizeSection } from '@/lib/deptMinutesParse';
import MinutesDetail from '@/components/MinutesDetail';
import { DRAFT_KEY as STORE_KEY, draftFromRow } from '@/lib/deptMinutesDraft';
import type { DecisionRow, MinutesRow } from '@/app/api/dept-minutes/list/route';

// 録音は1区間ずつ独立したファイルにして、会議中から順に文字起こししていく。
// 会議が終わった時点でほぼ文字起こしが終わっている状態にするための作り。
// ★文字起こしに使う Gemini は webm を受け付けないため、録音した区間は送信前に
//   splitAudioFile() で 16kHz モノラルの WAV に変換している。
//   1区間が SEGMENT_SECONDS を超えると変換後に2つに割れるので、同じ長さにそろえておく。
const REC_SEGMENT_SECONDS = SEGMENT_SECONDS;

const REC_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];


type Meta = { title: string; date: string; place: string; attendees: string; agenda: string };
type Source = 'record' | 'file' | 'paste';

// 文字起こしの進み具合。利用者から見て「止まっている」と「処理中」を区別するために持つ。
//   decoding  … ブラウザで音声を読み込み、送れる形（WAV）に変換している
//   uploading … その区間をサーバへ送っている（1区間 約2.9MB）
//   analyzing … サーバ側で Gemini が音声を文字にしている
type Phase = 'idle' | 'decoding' | 'uploading' | 'analyzing';

const PHASE_LABEL: Record<Exclude<Phase, 'idle'>, string> = {
  decoding: '音声を読み込んでいます',
  uploading: 'アップロード中',
  analyzing: '解析中（AIが文字に起こしています）',
};

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

// 文字起こしAPIが返す失敗理由を、そのまま画面に出せる日本語にする。
function transcribeError(reason: string): string {
  switch (reason) {
    case 'not_configured':
      return '音声の自動文字起こしが未設定です。管理者に GEMINI_API_KEY の設定を依頼してください。';
    case 'unsupported_type':
      return 'この音声形式には対応していません。mp3 / m4a / wav などでお試しください。';
    case 'blocked':
      return '文字起こしが安全フィルタで止められました。該当の区間だけ手で入力してください。';
    case 'timeout':
      return '文字起こしに時間がかかりすぎました。時間をおいてもう一度お試しください。';
    default:
      return '文字起こしに失敗しました。時間をおいてお試しください。';
  }
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
  // 会議中に人が取ったメモ（任意）。音声と一緒にAIへ渡す。
  const [memo, setMemo] = useState('');
  const [draft, setDraft] = useState('');
  const [instruction, setInstruction] = useState('');

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [queued, setQueued] = useState(0); // 文字起こし待ちの区間数
  const [fileProgress, setFileProgress] = useState({ done: 0, total: 0 });
  // いま何をしているか（無反応に見えないよう画面に出す）。
  const [phase, setPhase] = useState<Phase>('idle');
  const [uploadPct, setUploadPct] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState('');
  const [checkOk, setCheckOk] = useState(false);

  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [meetings, setMeetings] = useState<MinutesRow[]>([]);
  const [panelTab, setPanelTab] = useState<'meetings' | 'decisions'>('meetings');
  const [openMeeting, setOpenMeeting] = useState<MinutesRow | null>(null);
  // 保存済みの議事録を［修正］で開いているときだけ入る。
  // これを付けて保存すると新しい行を作らず、元の議事録を上書きする。
  const [editingId, setEditingId] = useState('');
  const [decFilter, setDecFilter] = useState('');
  const [showTemplate, setShowTemplate] = useState(false);
  // 文字起こしは普段は隠しておく（必要なときだけ開く）。
  const [showTranscript, setShowTranscript] = useState(false);

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
        if (typeof j?.memo === 'string') setMemo(j.memo);
        if (typeof j?.editingId === 'string') setEditingId(j.editingId);
        if (typeof j?.draft === 'string') setDraft(j.draft);
      }
    } catch {}
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ meta, transcript, memo, draft, editingId }));
    } catch {}
  }, [meta, transcript, memo, draft, editingId]);

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

  // 音声を送る前に、キーとモデル名が正しいかを確かめる。
  async function checkSetup() {
    if (checking) return;
    setChecking(true);
    setCheckMsg('確認中…');
    setCheckOk(false);
    try {
      const res = await fetch('/api/dept-minutes/transcribe?check=1');
      const j = await res.json().catch(() => ({}));
      setConfigured(Boolean(j?.configured));
      if (j?.ok && j?.modelOk) {
        setCheckOk(true);
        setCheckMsg(`接続できました。モデル「${j.model}」で文字起こしします。`);
      } else if (j?.ok) {
        const s = Array.isArray(j.suggestions) ? j.suggestions.slice(0, 4).join(' / ') : '';
        setCheckMsg(
          `キーは有効ですが、モデル「${j.model}」が使えません。`
          + `環境変数 GEMINI_MODEL を次のいずれかに変えてください：${s || '（候補を取得できませんでした）'}`,
        );
      } else if (j?.reason === 'not_configured') {
        setCheckMsg('GEMINI_API_KEY が設定されていません。');
      } else if (j?.reason === 'invalid_key') {
        setCheckMsg('APIキーが無効か、権限がありません。Google AI Studio のキーをご確認ください。');
      } else if (j?.reason === 'timeout') {
        setCheckMsg('応答がありませんでした。時間をおいてお試しください。');
      } else {
        setCheckMsg('確認に失敗しました。時間をおいてお試しください。');
      }
    } catch {
      setCheckMsg('確認に失敗しました。通信状況をご確認ください。');
    } finally {
      setChecking(false);
    }
  }

  // 保存済みの議事録（会議ごと）と決定事項（1件ずつ）をまとめて読み込む。
  const loadSaved = useCallback(async () => {
    try {
      const [decRes, minRes] = await Promise.all([
        fetch('/api/dept-minutes/list'),
        fetch('/api/dept-minutes/list?scope=minutes'),
      ]);
      const jd = await decRes.json().catch(() => ({}));
      if (jd?.ok && Array.isArray(jd.items)) setDecisions(jd.items as DecisionRow[]);
      const jm = await minRes.json().catch(() => ({}));
      if (jm?.ok && Array.isArray(jm.items)) setMeetings(jm.items as MinutesRow[]);
    } catch {}
  }, []);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  // ---- 文字起こし（1区間ずつ順番に送る） ----
  // 1区間は約2.9MB あり、回線によっては送信だけで時間がかかる。
  // 「アップロード中」と「解析中」を画面で区別するため、fetch ではなく
  // XMLHttpRequest を使って送信の進み具合（upload.onprogress）を拾う。
  const sendSegment = useCallback((blob: Blob, filename: string): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const form = new FormData();
      form.append('audio', blob, filename);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/dept-minutes/transcribe');

      // 進捗イベントが来ない環境でも表示が前の段階のまま固まらないよう、
      // 送信を始める時点で「アップロード中」にしておく。
      setPhase('uploading');
      setUploadPct(0);

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        setPhase('uploading');
        setUploadPct(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      };
      // 送り終わったらサーバ側（Gemini）の処理待ちに変わる。
      xhr.upload.onload = () => {
        setUploadPct(100);
        setPhase('analyzing');
      };
      xhr.onload = () => {
        let j: { ok?: boolean; text?: unknown; reason?: unknown } = {};
        try {
          j = JSON.parse(xhr.responseText);
        } catch {}
        if (j?.ok) resolve(String(j.text ?? ''));
        // 失敗理由をそのまま投げ、呼び出し側で日本語にして表示する。
        else reject(new Error(String(j?.reason ?? 'failed')));
      };
      xhr.onerror = () => reject(new Error('network_error'));
      xhr.onabort = () => reject(new Error('aborted'));
      xhr.send(form);
    });
  }, []);

  const pump = useCallback(async () => {
    if (workingRef.current) return;
    workingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const blob = queueRef.current[0];
        try {
          // 録音そのままの形式（webm 等）は文字起こし側が受け付けないため、WAV に変換して送る。
          setPhase('decoding');
          const { segments } = await splitAudioFile(blob);
          for (let i = 0; i < segments.length; i++) {
            const text = await sendSegment(segments[i], `rec${i + 1}.wav`);
            if (text) setTranscript((prev) => (prev ? `${prev}\n${text}` : text));
          }
        } catch (e) {
          setErr(transcribeError((e as Error).message));
        }
        queueRef.current.shift();
        setQueued(queueRef.current.length);
      }
    } finally {
      workingRef.current = false;
      // 待ち行列が空になったら進捗表示を畳む。
      setPhase('idle');
      setUploadPct(0);
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
    setNote('');
    try {
      // 1時間の音声だと読み込み（WAVへの変換）だけで数十秒かかる。無反応に見えないよう状態を出す。
      setPhase('decoding');
      const { segments, durationSec } = await splitAudioFile(file);
      setNote(`${fmtDuration(durationSec)}の音声を${segments.length}区間に分けて文字起こしします。`);
      setFileProgress({ done: 0, total: segments.length });
      for (let i = 0; i < segments.length; i++) {
        try {
          const text = await sendSegment(segments[i], `part${i + 1}.wav`);
          if (text) setTranscript((prev) => (prev ? `${prev}\n${text}` : text));
        } catch (ex) {
          const reason = (ex as Error).message;
          // 設定そのものが無い場合は続けても全区間失敗するので、そこで止める。
          if (reason === 'not_configured' || reason === 'unsupported_type') {
            setErr(transcribeError(reason));
            break;
          }
          setErr(`区間 ${i + 1} でつまずきました（${transcribeError(reason)}）続きを処理します。`);
        }
        setFileProgress({ done: i + 1, total: segments.length });
      }
      setNote('文字起こしが終わりました。「議事録を作成」を押してください。');
    } catch {
      setErr('この音声ファイルを読み込めませんでした。mp3 / m4a / wav などでお試しください。');
      setNote('');
    } finally {
      setPhase('idle');
      setUploadPct(0);
      setFileProgress({ done: 0, total: 0 });
    }
  }

  // ---- 議事録の生成 ----
  async function generate(mode: 'draft' | 'revise') {
    if (generating) return;
    const text = transcript.trim();
    const memoText = memo.trim();
    if (mode === 'revise') {
      if (!instruction.trim()) return;
      // 保存済みの議事録を［修正］で開いたときは文字起こしが無い。議事録本文が材料になる。
      if (!draft.trim()) {
        setErr('先に議事録を作成してください。');
        return;
      }
    } else if (!text && !memoText) {
      // 録音が無くメモだけの会議もあるので、どちらか一方あれば作れる。
      setErr('先に会議の音声か議事録メモを用意してください。');
      return;
    }
    setErr('');
    setNote('');
    setGenerating(true);
    setDraft('');
    try {
      const res = await fetch('/api/dept-minutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, meta, transcript: text, memo: memoText, draft, instruction }),
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
        body: JSON.stringify({ meta, content: draft, id: editingId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        setNote(
          j.updated
            ? `保存しました（${name} が修正／決定事項 ${j.decisions ?? 0} 件を入れ替え）。`
            : `保存しました（決定事項 ${j.decisions ?? 0} 件を全社共有に登録）。`,
        );
        // 続けて直せるよう、保存後も同じ議事録を編集中のままにする。
        if (j.id) setEditingId(String(j.id));
        void loadSaved();
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

  // 保存済みの議事録を［修正］で編集画面へ読み込む。
  // 上書き保存できるよう editingId を持ったままにする。
  function startEdit(row: MinutesRow) {
    if (draft.trim() && !confirm('編集中の議事録を破棄して、保存済みの議事録を読み込みますか？')) return;
    const d = draftFromRow(row);
    setMeta({ ...EMPTY_META, ...d.meta });
    setTranscript(d.transcript);
    setMemo(d.memo);
    setDraft(d.draft);
    setEditingId(d.editingId);
    setOpenMeeting(null);
    setErr('');
    setNote(
      d.editingId
        ? '保存済みの議事録を読み込みました。直して「確認しました・保存する」を押すと上書きされます。'
        : '保存済みの議事録を読み込みました。※この議事録には識別子が無いため、保存すると新しい記録として追加されます。',
    );
    // 議事録の欄（手順3）まで送る。
    setTimeout(() => document.querySelector('.dm-draft')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }

  function reset() {
    if (!confirm('入力中の会議情報・文字起こし・議事録をすべて消して、新しい会議を始めますか？')) return;
    stopRecording();
    queueRef.current = [];
    setQueued(0);
    setMeta({ ...EMPTY_META, date: todayLocal() });
    setTranscript('');
    setMemo('');
    setDraft('');
    setEditingId('');
    setInstruction('');
    setNote('');
    setErr('');
  }

  const set = (k: keyof Meta) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setMeta((m) => ({ ...m, [k]: e.target.value }));

  // 音声の読み込み中は区間数がまだ決まっていないので、phase も見て「処理中」と判断する
  //（ここを落とすと、1時間の音声の読み込み中だけ画面が無反応に見える）。
  const busyTranscribe = phase !== 'idle' || queued > 0 || fileProgress.total > 0;
  const shownDecisions = decisions.filter((d) => (decFilter ? d.campus === decFilter : true));
  const shownMeetings = meetings.filter((m) => (decFilter ? m.campus === decFilter : true));
  // 絞り込みの選択肢は、議事録と決定事項の両方に出てくる部門から作る。
  const campusesInList = Array.from(
    new Set([...meetings.map((m) => m.campus), ...decisions.map((d) => d.campus)].filter(Boolean)),
  );

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
            <h2><span className="dm-num">2</span>会議の音声を取り込む</h2>

            {configured === false && (
              <p className="dm-warn">
                音声の自動文字起こしが未設定です。管理者に環境変数 <code>GEMINI_API_KEY</code>（Google AI Studio のAPIキー）
                の設定を依頼してください。設定までは「文字起こしを貼り付け」をご利用いただけます。
              </p>
            )}

            <div className="dm-check">
              <button onClick={() => void checkSetup()} disabled={checking || recording}>
                文字起こしの接続テスト
              </button>
              {checkMsg && <span className={`dm-check-msg ${checkOk ? 'ok' : ''}`}>{checkMsg}</span>}
            </div>

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
                </div>
                <p className="dm-hint">
                  録音は{REC_SEGMENT_SECONDS / 60}分ごとに区切って、会議中から順に文字にしていきます。
                  会議が終わるころには文字起こしもほぼ終わっています。画面を閉じると録音は止まります。
                </p>
              </div>
            )}

            {source === 'file' && (
              <div className="dm-source">
                <input
                  type="file"
                  accept="audio/*,video/*"
                  onChange={onPickFile}
                  disabled={configured === false || phase !== 'idle'}
                />
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

            {/* 文字起こしは画面に出さず内部で保持する。
                40〜60分の会議では数万字になり、直すのは議事録の方なので普段は見せない。
                ただし「貼り付け」は入力欄そのものなので、そのときだけ常に表示する。 */}
            {source === 'paste' ? (
              <label className="dm-transcript">
                <span>文字起こしを貼り付け（{transcript.length.toLocaleString()}字）</span>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="他のアプリで文字起こししたテキストをここに貼り付けてください。"
                />
              </label>
            ) : (
              <>
                {busyTranscribe ? (
                  /* いま何をしているか（読み込み／アップロード／解析）と、どこまで進んだかを出す */
                  <div className="dm-work">
                    <div className="dm-work-head">
                      <span className="dm-spinner" aria-hidden="true" />
                      <span className="dm-work-phase">
                        {phase === 'idle' ? '処理中' : PHASE_LABEL[phase]}
                        {phase === 'uploading' && ` ${uploadPct}%`}
                      </span>
                      {/* 読み込みが終わるまで区間数は決まらないので、決まってから出す */}
                      {fileProgress.total > 0 ? (
                        <span className="dm-work-count">
                          {fileProgress.done} / {fileProgress.total} 区間
                        </span>
                      ) : queued > 0 ? (
                        <span className="dm-work-count">残り {queued} 区間</span>
                      ) : null}
                    </div>
                    <div className="dm-bar">
                      <div
                        className={`dm-bar-fill ${fileProgress.total > 0 ? '' : 'indet'}`}
                        style={
                          fileProgress.total > 0
                            ? { width: `${Math.round((fileProgress.done / fileProgress.total) * 100)}%` }
                            : undefined
                        }
                      />
                    </div>
                    <p className="dm-work-note">
                      {transcript.trim()
                        ? `ここまでに ${transcript.length.toLocaleString()} 字を文字にしました。`
                        : '最初の区間の結果が出るまで少しお待ちください。'}
                      {phase === 'analyzing' && ' 画面を閉じずにお待ちください。'}
                    </p>
                  </div>
                ) : (
                  <div className="dm-tstatus">
                    <span>
                      {transcript.trim()
                        ? `文字起こし完了（${transcript.length.toLocaleString()}字）`
                        : '音声を取り込むと、ここで文字起こしが進みます'}
                    </span>
                    {transcript.trim() && (
                      <button className="dm-tlink" onClick={() => setShowTranscript((v) => !v)}>
                        {showTranscript ? '閉じる' : '文字起こしを確認'}
                      </button>
                    )}
                  </div>
                )}
                {showTranscript && (
                  <label className="dm-transcript">
                    <span>文字起こし（通常は直す必要はありません。議事録は次の欄で直せます）</span>
                    <textarea
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                    />
                  </label>
                )}
              </>
            )}

            {/* 会議中に手で取ったメモ。録音と一緒に渡すと、聞き取れなかった数字や
                固有名詞をメモ側から補える。録音が無い会議はメモだけでも作れる。 */}
            <label className="dm-memo">
              <span>
                議事録メモ（任意）
                {memo.trim() && <em>　{memo.length.toLocaleString()}字</em>}
              </span>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder={'会議中に取ったメモがあれば貼り付けてください。箇条書き・断片のままで構いません。\n例：\n・サイトク 9/12開始で決定（池田）\n・バス18:50発に変更 → 総務へ依頼\n・冬期料金は次回持ち越し'}
              />
              <small>
                メモは文字起こしより正確なものとして扱います。数字・固有名詞・担当者名が
                録音と食い違うときはメモのほうを採用します。
              </small>
            </label>

            <div className="dm-actions">
              <button
                className="dm-primary"
                onClick={() => void generate('draft')}
                disabled={generating || (!transcript.trim() && !memo.trim()) || recording}
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
                {generating && (
                  <div className="dm-work-line">
                    <span className="dm-spinner" aria-hidden="true" />
                    <span>
                      {draft ? '議事録を作成中…（下に書き出しています）' : 'AIが議事録を作成しています…'}
                    </span>
                  </div>
                )}
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
                      // 日本語入力の変換確定でも Enter が来るため、単独の Enter では送らない。
                      // 他の画面と同じく ⌘/Ctrl + Enter で送信する。
                      // isComposing は変換中かどうか（変換中の確定キーを弾く）。
                      if (
                        e.key === 'Enter'
                        && (e.metaKey || e.ctrlKey)
                        && !e.nativeEvent.isComposing
                        && instruction.trim()
                      ) {
                        e.preventDefault();
                        void generate('revise');
                      }
                    }}
                  />
                  <button
                    onClick={() => void generate('revise')}
                    disabled={generating || !instruction.trim()}
                    title="⌘・Ctrl + Enter でも送信できます"
                  >
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

        {/* ---------- 右：保存済みの議事録・決定事項 ---------- */}
        <aside className="dm-side">
          <div className="dm-panel">
            <div className="dm-panel-head">
              <h2>保存済みの議事録</h2>
              <button className="dm-reload" onClick={() => void loadSaved()}>更新</button>
            </div>

            <div className="dm-panel-tabs">
              <button
                className={panelTab === 'meetings' ? 'active' : ''}
                onClick={() => setPanelTab('meetings')}
              >
                会議ごと{meetings.length > 0 && `（${meetings.length}）`}
              </button>
              <button
                className={panelTab === 'decisions' ? 'active' : ''}
                onClick={() => setPanelTab('decisions')}
              >
                決定事項{decisions.length > 0 && `（${decisions.length}）`}
              </button>
            </div>

            {campusesInList.length > 0 && (
              <select className="dm-filter" value={decFilter} onChange={(e) => setDecFilter(e.target.value)}>
                <option value="">すべての部門</option>
                {campusesInList.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}

            {/* 会議ごと：日付・会議名・議題が見え、［詳細］で議事録全体を開く */}
            {panelTab === 'meetings' && (
              shownMeetings.length === 0 ? (
                <p className="dm-empty">
                  まだ保存された議事録はありません。議事録を保存すると、ここに全部門分が会議ごとに並びます。
                </p>
              ) : (
                <ul className="dm-meet-list">
                  {shownMeetings.slice(0, 40).map((m, i) => {
                    const agenda = summarizeSection(extractSection(m.minutes, '議題') || m.agenda, 3);
                    const decCount = extractDecisions(m.minutes).length;
                    return (
                      <li key={`${m.ts}-${i}`}>
                        <div className="dm-meet-head">
                          <span className="dm-meet-date">{fmtDate(m.date || m.ts)}</span>
                          <span className="dm-dec-campus">{m.campus}</span>
                        </div>
                        <div className="dm-meet-title">{m.title || '（会議名なし）'}</div>
                        {agenda.length > 0 && (
                          <ul className="dm-meet-agenda">
                            {agenda.map((a, k) => <li key={k}>{a}</li>)}
                          </ul>
                        )}
                        <div className="dm-meet-foot">
                          <span className="dm-meet-count">
                            決定 {decCount} 件{m.user && ` ／ ${m.user}`}
                          </span>
                          <button className="dm-detail" onClick={() => setOpenMeeting(m)}>詳細</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            )}

            {/* 決定事項：部門をまたいだ決め事を1件ずつ並べる */}
            {panelTab === 'decisions' && (
              shownDecisions.length === 0 ? (
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
                      {d.meeting && <div className="dm-dec-from">{d.meeting}</div>}
                    </li>
                  ))}
                </ul>
              )
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

      {/* 議事録の詳細（ポップアップ）。ダッシュボードと同じ部品を使う。 */}
      {openMeeting && (
        <MinutesDetail
          row={openMeeting}
          onClose={() => setOpenMeeting(null)}
          onEdit={() => startEdit(openMeeting)}
        />
      )}
    </div>
  );
}
