'use client';

// 録音・音声ファイルの取り込み → 区間ごとに文字起こし、の画面側の仕組み（会議DX フェーズ2）。
// 「部門会議議事録」（components/DeptMinutesUI.tsx）と「面談記録」（components/InterviewNotesUI.tsx）の
// 両方がこれを使う。録音の区切り方・送り直し・失敗時の案内を直すときはここだけを直せばよい。
//
// 録音は1区間ずつ独立したファイルにして、録音中から順に文字起こししていく。
// 終わった時点でほぼ文字起こしが終わっている状態にするための作り。
// ★文字起こしに使う Gemini は webm を受け付けないため、録音した区間は送信前に
//   splitAudioFile() で 16kHz モノラルの WAV に変換している。
//   1区間が SEGMENT_SECONDS を超えると変換後に2つに割れるので、同じ長さにそろえておく。

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { SEGMENT_SECONDS, audioFileProblem, fmtDuration, fmtSize, splitAudioFile } from '@/lib/audioChunk';

export const REC_SEGMENT_SECONDS = SEGMENT_SECONDS;

const REC_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

// 文字起こしの進み具合。利用者から見て「止まっている」と「処理中」を区別するために持つ。
//   decoding  … ブラウザで音声を読み込み、送れる形（WAV）に変換している
//   uploading … その区間をサーバへ送っている（1区間 約2.9MB）
//   analyzing … サーバ側で Gemini が音声を文字にしている
//   waiting   … 送りすぎで断られたので、少し待ってから同じ区間を送り直す
export type Phase = 'idle' | 'decoding' | 'uploading' | 'analyzing' | 'waiting';

export const PHASE_LABEL: Record<Exclude<Phase, 'idle'>, string> = {
  decoding: '音声を読み込んでいます',
  uploading: 'アップロード中',
  analyzing: '解析中（AIが文字に起こしています）',
  waiting: '混み合っているため待っています',
};

// 送信が断られたときに待つ秒数（Gemini が待ち時間を指定してきたらそちらを使う）。
// 無料枠は短い時間に続けて送ると断られるので、あきらめずに待って送り直す。
const RETRY_WAITS = [10, 25, 60];

// 待てば通る見込みのある失敗か。
function isRetryable(reason: string): boolean {
  return reason === 'rate_limited' || reason === 'upstream_busy' || reason === 'network_error';
}

// これが出たら残りの区間を送っても同じ結果にしかならない（＝すぐ止める）。
function isFatal(reason: string): boolean {
  return (
    reason === 'not_configured'
    || reason === 'unsupported_type'
    || reason === 'invalid_key'
    || reason === 'quota_exceeded'
  );
}

// 1区間を送った結果。失敗は例外にせず、理由を持ったまま呼び出し側へ返す。
type SegResult =
  | { ok: true; text: string }
  | { ok: false; reason: string; detail?: string; retryAfterSec?: number };

// 何区間が文字にできて、何区間が落ちたか。終わったときの案内はこれだけを見て決める。
export type RunTally = {
  total: number; // 区間の総数
  done: number; // 送り終えた区間数（打ち切ったときは総数より少ない）
  ok: number;
  failed: number;
  reason: string;
  detail: string;
};

const EMPTY_TALLY: RunTally = { total: 0, done: 0, ok: 0, failed: 0, reason: '', detail: '' };

// 画面ごとに変わる言い回し（「議事録を作成」「議事録メモ」など）。
export type TranscriberLabels = {
  action: string; // 文字起こしの後に押すボタン名（例：議事録を作成）
  memo: string; // 取りこぼしを補う手書きメモ欄の名前（例：議事録メモ）
  output: string; // できあがるもの（例：議事録）
};

// 文字起こしが一通り終わったときの案内文。
// 「終わりました」とだけ出して中身が空、という状態を作らないための分岐。
function runSummary(t: RunTally, labels: TranscriberLabels): { note: string; warn: string; err: string } {
  if (t.ok === 0) {
    const why = transcribeError(t.reason || 'failed');
    const tail = t.detail ? `（${t.detail}）` : '';
    // 途中で打ち切ったときは「全部試した」と誤解させない書き方にする。
    const head = t.done < t.total
      ? `文字起こしできませんでした。${t.total}区間のうち${t.done}区間を試した時点で中止しました。`
      : `文字起こしできませんでした（${t.total}区間すべて）。`;
    return { note: '', err: `${head}${why}${tail}`, warn: '' };
  }
  if (t.failed > 0) {
    return {
      note: `文字起こしが終わりました（${t.total}区間中${t.ok}区間）。「${labels.action}」を押してください。`,
      warn: `${t.failed}区間は文字にできませんでした（${transcribeError(t.reason)}）。`
        + `その部分は${labels.output}に入りません。足りないところは「${labels.memo}」に書き足してください。`,
      err: '',
    };
  }
  return { note: `文字起こしが終わりました。「${labels.action}」を押してください。`, warn: '', err: '' };
}

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
// 「何が起きたか」と「次にどうすればよいか」が分かる文にすること
//（原因が分からないまま全区間が失敗すると、画面上は空っぽになるだけで理由が追えない）。
export function transcribeError(reason: string): string {
  switch (reason) {
    case 'not_configured':
      return '音声の自動文字起こしが未設定です。管理者に GEMINI_API_KEY の設定を依頼してください。';
    case 'invalid_key':
      return 'APIキーが無効か、権限がありません。管理者に GEMINI_API_KEY の確認を依頼してください。';
    case 'quota_exceeded':
      return 'Gemini の1日あたりの利用枠を使い切りました。日付が変わると戻ります。'
        + '急ぐ場合は、他のアプリで文字起こしして「文字起こしを貼り付け」から入れてください。';
    case 'rate_limited':
      return '短い時間に送りすぎて断られました（無料枠の制限）。時間をおいてお試しください。';
    case 'upstream_busy':
      return 'Gemini 側が混み合っています。時間をおいてお試しください。';
    case 'too_large':
      return '音声の区間が大きすぎて送れませんでした。管理者にご連絡ください。';
    case 'unsupported_type':
      return 'この音声形式には対応していません。mp3 / m4a / wav などでお試しください。';
    case 'blocked':
      return '文字起こしが安全フィルタで止められました。該当の区間だけ手で入力してください。';
    case 'timeout':
      return '文字起こしに時間がかかりすぎました。時間をおいてもう一度お試しください。';
    default:
      return '原因を特定できませんでした。時間をおいてもう一度お試しください。';
  }
}

export type TranscriberOptions = {
  // 文字起こし API（GET で設定確認、POST で1区間の文字起こし）。
  endpoint: string;
  labels: TranscriberLabels;
  // 1区間分の文字が取れるたびに呼ばれる（画面側で文字起こしの末尾に足す）。
  onText: (text: string) => void;
  // 画面の案内（緑・黄・赤）。生成・保存の案内と同じ欄に出すので、置き場所は画面が持つ。
  setNote: (s: string) => void;
  setWarn: (s: string) => void;
  setErr: (s: string) => void;
};

export function useAudioTranscriber(opts: TranscriberOptions) {
  const { endpoint } = opts;
  // 呼び出し側は毎回新しい関数を渡してくるので、最新のものを ref で持つ
  //（useCallback の依存に入れると録音中に関数が作り直され、区切りの処理がずれる）。
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [queued, setQueued] = useState(0); // 文字起こし待ちの区間数
  const [fileProgress, setFileProgress] = useState({ done: 0, total: 0 });
  // いま何をしているか（無反応に見えないよう画面に出す）。
  const [phase, setPhase] = useState<Phase>('idle');
  const [uploadPct, setUploadPct] = useState(0);
  // 送り直しの待ち時間（残り秒）。止まっているように見えないよう画面に出す。
  const [waitLeft, setWaitLeft] = useState(0);
  // 処理中の取りこぼし件数。1件ごとに赤字を出すと「うまくいっているのに警告が出る」ので、
  // 途中は件数だけ控えめに見せ、終わったときにまとめて1行で伝える。
  const [failedSegs, setFailedSegs] = useState(0);
  // 直前の取り込み結果。手順2の行にも結果を出すために持つ
  //（赤い案内は手順3の下に出るので、長い音声だと気づかないまま終わってしまう）。
  const [lastRun, setLastRun] = useState<RunTally | null>(null);

  // 添付したファイル（名前と大きさを画面に出して、選び間違いに気づけるようにする）。
  const [picked, setPicked] = useState<{ name: string; size: string } | null>(null);
  // 録音中に画面が隠れた（画面ロック・他のアプリへの切り替え）か。
  // スマホのブラウザは画面が隠れるとマイクを止めるので、その間の音声は入らない。
  const [interrupted, setInterrupted] = useState(false);

  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState('');
  const [checkOk, setCheckOk] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const segTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef(false);
  const queueRef = useRef<Blob[]>([]);
  const workingRef = useRef(false);
  // 録音は区切りごとに何度も pump() を通るので、成否の数はここにためる。
  const tallyRef = useRef<RunTally>({ ...EMPTY_TALLY });
  const mimeRef = useRef('');

  // ---- 文字起こしが使える設定か ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(endpoint);
        const j = await res.json().catch(() => ({}));
        if (alive) setConfigured(Boolean(j?.configured));
      } catch {
        if (alive) setConfigured(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [endpoint]);

  // 音声を送る前に、キーとモデル名が正しいかを確かめる。
  const checkSetup = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setCheckMsg('確認中…');
    setCheckOk(false);
    try {
      const res = await fetch(`${endpoint}?check=1`);
      const j = await res.json().catch(() => ({}));
      setConfigured(Boolean(j?.configured));
      if (j?.ok && j?.modelOk && j?.quotaOk === false) {
        // キーもモデル名も正しいのに、実際に送ると断られる状態
        //（1日の無料枠を使い切っているときはこれになる）。
        setCheckOk(false);
        setCheckMsg(
          `モデル「${j.model}」は使えますが、いま文字起こしは通りません。`
          + `${transcribeError(String(j.quotaReason || 'failed'))}`
          + `${j.quotaDetail ? `（${j.quotaDetail}）` : ''}`,
        );
      } else if (j?.ok && j?.modelOk) {
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
  }, [checking, endpoint]);

  // ---- 文字起こし（1区間ずつ順番に送る） ----
  // 1区間は約2.9MB あり、回線によっては送信だけで時間がかかる。
  // 「アップロード中」と「解析中」を画面で区別するため、fetch ではなく
  // XMLHttpRequest を使って送信の進み具合（upload.onprogress）を拾う。
  const sendSegment = useCallback((blob: Blob, filename: string): Promise<SegResult> => {
    return new Promise<SegResult>((resolve) => {
      const form = new FormData();
      form.append('audio', blob, filename);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint);

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
        let j: { ok?: boolean; text?: unknown; reason?: unknown; detail?: unknown; retryAfterSec?: unknown } = {};
        try {
          j = JSON.parse(xhr.responseText);
        } catch {}
        if (j?.ok) {
          resolve({ ok: true, text: String(j.text ?? '') });
          return;
        }
        // 失敗は例外にせず結果として返す。1区間の失敗で全体を止めないため。
        resolve({
          ok: false,
          reason: String(j?.reason ?? 'failed'),
          detail: typeof j?.detail === 'string' ? j.detail : '',
          retryAfterSec: typeof j?.retryAfterSec === 'number' ? j.retryAfterSec : 0,
        });
      };
      xhr.onerror = () => resolve({ ok: false, reason: 'network_error' });
      xhr.onabort = () => resolve({ ok: false, reason: 'aborted' });
      xhr.send(form);
    });
  }, [endpoint]);

  // 断られた区間は、少し待ってから同じものを送り直す。
  // 無料枠は短い時間に続けて送ると断られるため、ここで粘らないと
  // 1区間の失敗がそのまま全区間の失敗に広がってしまう。
  const sendWithRetry = useCallback(
    async (blob: Blob, filename: string): Promise<SegResult> => {
      for (let attempt = 0; ; attempt++) {
        const r = await sendSegment(blob, filename);
        if (r.ok || !isRetryable(r.reason) || attempt >= RETRY_WAITS.length) return r;
        // Gemini が「この秒数だけ待て」と言ってきたらそれに従う（長すぎる指定は切り詰める）。
        const wait = r.retryAfterSec && r.retryAfterSec > 0 ? Math.min(r.retryAfterSec, 90) : RETRY_WAITS[attempt];
        setPhase('waiting');
        for (let left = wait; left > 0; left--) {
          setWaitLeft(left);
          await new Promise((done) => setTimeout(done, 1000));
        }
        setWaitLeft(0);
      }
    },
    [sendSegment],
  );

  const pump = useCallback(async () => {
    if (workingRef.current) return;
    workingRef.current = true;
    // 録音中はこの関数が何度も呼ばれるので、結果は ref にためて最後にまとめて伝える。
    const tally = tallyRef.current;
    try {
      while (queueRef.current.length > 0) {
        const blob = queueRef.current[0];
        try {
          // 録音そのままの形式（webm 等）は文字起こし側が受け付けないため、WAV に変換して送る。
          setPhase('decoding');
          const { segments } = await splitAudioFile(blob);
          for (let i = 0; i < segments.length; i++) {
            const r = await sendWithRetry(segments[i], `rec${i + 1}.wav`);
            tally.total += 1;
            if (r.ok) {
              tally.ok += 1;
              if (r.text) optsRef.current.onText(r.text);
            } else {
              tally.failed += 1;
              tally.reason = r.reason;
              tally.detail = r.detail || '';
              setFailedSegs(tally.failed);
            }
          }
        } catch {
          // WAV への変換そのものに失敗した区間（壊れた録音など）。
          tally.total += 1;
          tally.failed += 1;
          tally.reason = tally.reason || 'decode_failed';
          setFailedSegs(tally.failed);
        }
        queueRef.current.shift();
        setQueued(queueRef.current.length);
      }
      // 区切りごとに赤字を出すと録音中ずっと警告が出てしまうので、
      // 待ち行列が空になった時点で一度だけまとめて伝える。
      if (tally.failed > 0) {
        const sum = runSummary({ ...tally, done: tally.total }, optsRef.current.labels);
        optsRef.current.setWarn(sum.warn);
        optsRef.current.setErr(sum.err);
      }
      if (tally.total > 0) setLastRun({ ...tally, done: tally.total });
    } finally {
      workingRef.current = false;
      // 待ち行列が空になったら進捗表示を畳む。
      setPhase('idle');
      setUploadPct(0);
      setWaitLeft(0);
    }
  }, [sendWithRetry]);

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
        // まだ録音中なら次の区間をすぐ始める（録音は途切れない）。
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

  // 新しく取り込みを始める前に、前回の案内と集計を消す。
  function clearRun() {
    const o = optsRef.current;
    o.setErr('');
    o.setWarn('');
    o.setNote('');
    setFailedSegs(0);
    setLastRun(null);
  }

  async function startRecording() {
    clearRun();
    setInterrupted(false);
    tallyRef.current = { ...EMPTY_TALLY };
    const o = optsRef.current;
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      o.setErr('このブラウザは録音に対応していません。録音アプリで録った音声ファイルを添付してください。');
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
      o.setErr('マイクを使えませんでした。ブラウザのマイク許可をご確認ください。');
    }
  }

  // 画面を離れるときにマイクを解放する。
  useEffect(() => () => stopRecording(), [stopRecording]);

  // 録音中に画面が隠れたら覚えておく（戻ってきたときに注意を出す）。
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && recordingRef.current) setInterrupted(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ---- 音声ファイルの添付 ----
  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    clearRun();
    setPicked({ name: file.name || '（名前なし）', size: fmtSize(file.size) });
    const o = optsRef.current;
    try {
      // 1時間の音声だと読み込み（WAVへの変換）だけで数十秒かかる。無反応に見えないよう状態を出す。
      setPhase('decoding');
      const { segments, durationSec } = await splitAudioFile(file);
      o.setNote(`${fmtDuration(durationSec)}の音声を${segments.length}区間に分けて文字起こしします。`);
      setFileProgress({ done: 0, total: segments.length });

      // 1区間ごとに赤字を出すと、ほとんど成功していても警告だらけに見える。
      // 数だけ数えておいて、終わったときに一度だけまとめて伝える。
      const tally: RunTally = { ...EMPTY_TALLY, total: segments.length };
      for (let i = 0; i < segments.length; i++) {
        const r = await sendWithRetry(segments[i], `part${i + 1}.wav`);
        tally.done = i + 1;
        if (r.ok) {
          tally.ok += 1;
          if (r.text) optsRef.current.onText(r.text);
        } else {
          tally.failed += 1;
          tally.reason = r.reason;
          tally.detail = r.detail || '';
          setFailedSegs(tally.failed);
          // 残りを送っても同じ理由で落ちるだけの失敗は、ここで打ち切る
          //（枠切れのまま40区間送り続けても時間を使うだけなので）。
          if (isFatal(r.reason)) {
            setFileProgress({ done: tally.done, total: segments.length });
            break;
          }
        }
        setFileProgress({ done: i + 1, total: segments.length });
      }

      // 「終わりました」と出すのは、実際に文字が取れたときだけ。
      const sum = runSummary(tally, optsRef.current.labels);
      o.setNote(sum.note);
      o.setWarn(sum.warn);
      o.setErr(sum.err);
      setLastRun(tally);
    } catch {
      o.setErr(
        audioFileProblem(file) === 'amr'
          ? 'この録音は AMR 形式（.amr / .3gp）のため、ブラウザで読み込めません。'
            + '録音アプリの設定で保存形式を「M4A」「MP3」「AAC」などに変えて録り直すか、'
            + '他のアプリで文字起こしして「文字起こしを貼り付け」から入れてください。'
          : 'この音声ファイルを読み込めませんでした。mp3 / m4a / wav などでお試しください。'
            + '長い録音で読み込めない場合は、録音アプリで2〜3つに分けて書き出し、順番に添付してください。',
      );
      o.setNote('');
    } finally {
      setPhase('idle');
      setUploadPct(0);
      setWaitLeft(0);
      setFileProgress({ done: 0, total: 0 });
    }
  }

  // 「新しい会議／面談」で全部消すときに、録音と待ち行列も止める。
  const resetAll = useCallback(() => {
    stopRecording();
    queueRef.current = [];
    setQueued(0);
    setFailedSegs(0);
    setLastRun(null);
    setPicked(null);
    setInterrupted(false);
  }, [stopRecording]);

  // 音声の読み込み中は区間数がまだ決まっていないので、phase も見て「処理中」と判断する
  //（ここを落とすと、1時間の音声の読み込み中だけ画面が無反応に見える）。
  const busy = phase !== 'idle' || queued > 0 || fileProgress.total > 0;

  // 録音中・文字起こしの処理中は、スマホの画面が自動で消えないようにする（Screen Wake Lock）。
  // 画面が消えるとブラウザが止まり、録音も送信も途切れるため。
  // 対応していない端末では何もしない（画面の案内で「画面を消さないで」と伝えている）。
  const keepAwake = recording || busy;
  useEffect(() => {
    if (!keepAwake) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> } };
    if (!nav.wakeLock) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    const acquire = async () => {
      try {
        const l = await nav.wakeLock!.request('screen');
        if (alive) lock = l;
        else void l.release();
      } catch {}
    };
    // 画面を切り替えるとロックは自動で外れるので、戻ってきたら取り直す。
    const onVis = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVis);
      if (lock) void lock.release().catch(() => {});
    };
  }, [keepAwake]);

  return {
    configured,
    recording,
    elapsed,
    queued,
    fileProgress,
    phase,
    uploadPct,
    waitLeft,
    failedSegs,
    lastRun,
    busy,
    picked,
    interrupted,
    checking,
    checkMsg,
    checkOk,
    checkSetup,
    startRecording,
    stopRecording,
    onPickFile,
    resetAll,
  };
}

export type AudioTranscriber = ReturnType<typeof useAudioTranscriber>;
