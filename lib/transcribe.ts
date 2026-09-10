// 音声の文字起こし（会議DX フェーズ2）
// -------------------------------------------------------------------------
// Claude（Anthropic Messages API）は音声を直接受け取れないため、
// 文字起こしだけは外部の音声認識サービスに任せ、その結果を Claude に渡して議事録化する。
//
// 対応するのは「OpenAI 互換の /v1/audio/transcriptions」を持つサービス。
// OpenAI（whisper-1 / gpt-4o-transcribe）、Groq、Azure OpenAI、自前の faster-whisper など、
// 多くのサービスがこの形をしているので、環境変数の URL を差し替えるだけで乗り換えられる。
//
// 【環境変数】※未設定でもアプリは壊れない（画面が「テキスト貼り付け」を案内する）
//   SPEECH_API_URL   … 例 https://api.openai.com/v1/audio/transcriptions（未設定ならこの既定値）
//   SPEECH_API_KEY   … サービスのAPIキー。これが未設定なら文字起こし機能は無効
//   SPEECH_MODEL     … 例 whisper-1（既定）
//   SPEECH_LANGUAGE  … 例 ja（既定）。会議は日本語なので ja のままでよい

const DEFAULT_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-1';
const DEFAULT_LANGUAGE = 'ja';

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'not_configured' | 'empty' | 'upstream_error' | 'network_error'; detail?: string };

// 文字起こしが使える状態か（画面の出し分けに使う）。
export function isTranscribeConfigured(): boolean {
  return Boolean(process.env.SPEECH_API_KEY);
}

// 誤変換を減らすための固有名詞ヒント。会社・部門名を渡しておく。
// ※ OpenAI 互換 API の prompt パラメータ（直前の文脈として使われる）。
const VOCAB_HINT = '智翔館の部門会議です。小中等部、RED個別、高等部、LEC、英検、総務、人事、支援、管理、'
  + '在籍数、体験授業、面談、講習、模試、退塾、決裁、協議、議事録。';

export async function transcribeAudio(file: Blob, filename: string): Promise<TranscribeResult> {
  if (!isTranscribeConfigured()) return { ok: false, reason: 'not_configured' };
  if (!file || file.size === 0) return { ok: false, reason: 'empty' };

  const url = process.env.SPEECH_API_URL || DEFAULT_URL;
  const form = new FormData();
  form.append('file', file, filename);
  form.append('model', process.env.SPEECH_MODEL || DEFAULT_MODEL);
  form.append('language', process.env.SPEECH_LANGUAGE || DEFAULT_LANGUAGE);
  form.append('response_format', 'json');
  form.append('prompt', VOCAB_HINT);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SPEECH_API_KEY}` },
      body: form,
    });
    if (!res.ok) {
      // 失敗理由はサーバのログにだけ残す（APIキーが本文に混ざる事故を避けるため画面には出さない）。
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      try {
        console.error('[TRANSCRIBE] upstream', res.status, detail);
      } catch {}
      return { ok: false, reason: 'upstream_error', detail: `status=${res.status}` };
    }
    const j = (await res.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof j?.text === 'string' ? j.text.trim() : '';
    return { ok: true, text };
  } catch (e) {
    try {
      console.error('[TRANSCRIBE] network', String(e));
    } catch {}
    return { ok: false, reason: 'network_error' };
  }
}
