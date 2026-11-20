// Zoom の録画まるごとの文字起こし（Zoom連携）。サーバ専用。
// -------------------------------------------------------------------------
// 画面からの文字起こし（lib/transcribe.ts）は、ブラウザが音声を短く区切って1区間ずつ送る。
// 録画はサーバが Zoom から直接取り出すので区切れない。ここでは1本まるごと送る。
//
// 文字起こしの任せ先は3つ。順番は lib/zoom/recordingFiles.ts の transcribeOrder で決まる。
//   openai … OpenAI の Transcriptions API。1ファイル 25MB まで（1時間の会議の音声は約40MB で超える）
//   gemini … Gemini。小さければそのまま、大きければ Files API に置いてから読ませる
//   zoom   … Zoom が作った文字起こし（予備）
//
// 【環境変数】
//   OPENAI_API_KEY          … OpenAI のキー（画像生成と共用）。無ければ OpenAI は飛ばす
//   OPENAI_TRANSCRIBE_MODEL … 既定 gpt-transcribe
//   GEMINI_API_KEY ほか     … lib/transcribe.ts と同じ
//   ZOOM_TRANSCRIBE_ORDER   … 試す順番（既定 openai,gemini,zoom）

import { geminiBase, geminiKeys, geminiModel } from '@/lib/transcribe';
import { buildVocabHint } from '@/lib/transcribeVocab';
import type { TranscribeSource } from '@/lib/zoom/recordingFiles';

export type Attempt = { source: TranscribeSource; ok: boolean; reason?: string; detail?: string; model?: string; chars?: number };
export type SourceResult = { ok: true; text: string; model: string } | { ok: false; reason: string; detail?: string };

// OpenAI に送れる大きさの上限（25MB）。少し手前で止める。
export const OPENAI_MAX_BYTES = 24.5 * 1024 * 1024;
// Gemini にそのまま（base64 で）送る上限。リクエスト全体で 20MB までなので、base64 で膨らむ分を見て決める。
const GEMINI_INLINE_MAX_BYTES = 13 * 1024 * 1024;

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_PROMPT_MAX = 1800;

const GEMINI_PROMPT = `この音声は学習塾「智翔館」の会議を Zoom で録画したものです。最初から最後まで、日本語で文字起こししてください。

次を必ず守ってください。
- 要約・言い換え・整形をしない。話されたとおりに書く。途中を省かない。
- 「以下が文字起こしです」などの前置きや、あなた自身の説明・感想は一切書かない。
- タイムスタンプは書かない。
- 話す人が変わったら改行し、行頭に「話者A：」「話者B：」のように付ける。
  会話の中で名前が分かった人は、その名前（例「安東：」）を使う。
- 聞き取れない部分は【聞き取り不明】と書く。
- 人の声が入っていない場合は、何も書かずに空で返す。
`;

function left(deadline: number, capMs: number): number {
  return Math.max(5000, Math.min(capMs, deadline - Date.now()));
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

async function postOpenAI(key: string, model: string, audio: Uint8Array, filename: string, mime: string, hint: string, timeoutMs: number) {
  const form = new FormData();
  form.append('model', model);
  form.append('file', new Blob([audio as BlobPart], { type: mime }), filename);
  if (hint) {
    form.append('languages[]', 'ja');
    form.append('prompt', hint);
  }
  return fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function transcribeWithOpenAI(audio: Uint8Array, ext: string, deadline: number): Promise<SourceResult> {
  const key = (process.env.OPENAI_API_KEY ?? '').trim();
  if (!key) return { ok: false, reason: 'not_configured' };
  if (audio.byteLength > OPENAI_MAX_BYTES) return { ok: false, reason: 'too_large', detail: `${Math.round(audio.byteLength / 1048576)}MB` };
  const model = (process.env.OPENAI_TRANSCRIBE_MODEL ?? '').trim() || 'gpt-transcribe';
  const mime = ext === 'mp4' ? 'video/mp4' : 'audio/m4a';
  const vocab = await buildVocabHint().catch(() => '');
  const hint = `学習塾「智翔館」の会議の録音です。日本語で話しています。\n${vocab}`.slice(0, OPENAI_PROMPT_MAX);
  try {
    let res = await postOpenAI(key, model, audio, `recording.${ext}`, mime, hint, left(deadline, 240000));
    // ヒントや言語の指定が受け付けられなかったときは、音声だけで送り直す。
    if (res.status === 400) res = await postOpenAI(key, model, audio, `recording.${ext}`, mime, '', left(deadline, 240000));
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      console.error('[ZOOM_TRANSCRIBE] openai', res.status, body);
      const reason = res.status === 401 || res.status === 403 ? 'invalid_key'
        : res.status === 404 ? 'model_not_found'
        : res.status === 413 ? 'too_large'
        : res.status === 429 ? 'rate_limited'
        : res.status >= 500 ? 'upstream_busy' : 'upstream_error';
      return { ok: false, reason, detail: `HTTP ${res.status}` };
    }
    const j = (await res.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof j?.text === 'string' ? j.text.trim() : '';
    return text ? { ok: true, text, model } : { ok: false, reason: 'empty' };
  } catch (e) {
    const name = (e as Error)?.name;
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error' };
  }
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

type GeminiFile = { name: string; uri: string };

// Files API に音声を置く（大きい録音用）。置いたファイルは48時間で自動的に消えるが、使い終わったら自分で消す。
async function uploadToGemini(base: string, key: string, audio: Uint8Array, mime: string, timeoutMs: number): Promise<GeminiFile | null> {
  const origin = new URL(base).origin;
  const start = await fetch(`${origin}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(audio.byteLength),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'zoom-recording' } }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!start.ok || !uploadUrl) return null;
  const put = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: new Blob([audio as BlobPart]),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = (await put.json().catch(() => null)) as { file?: { name?: string; uri?: string; state?: string } } | null;
  if (!put.ok || !j?.file?.name || !j.file.uri) return null;
  // 置いた直後は処理中のことがある。使える状態になるまで少し待つ。
  let state = j.file.state ?? 'ACTIVE';
  for (let i = 0; i < 10 && state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const g = await fetch(`${base}/${j.file.name}`, { headers: { 'x-goog-api-key': key }, cache: 'no-store', signal: AbortSignal.timeout(10000) }).catch(() => null);
    const gj = (await g?.json().catch(() => null)) as { state?: string } | null;
    state = gj?.state ?? state;
  }
  return state === 'FAILED' ? null : { name: j.file.name, uri: j.file.uri };
}

async function deleteFromGemini(base: string, key: string, name: string) {
  await fetch(`${base}/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key }, cache: 'no-store', signal: AbortSignal.timeout(10000) }).catch(() => null);
}

function geminiText(j: unknown): { text: string; blocked: boolean; truncated: boolean } {
  const o = j as { candidates?: { content?: { parts?: { text?: unknown }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  const c = o?.candidates?.[0];
  const text = (c?.content?.parts ?? []).map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
  return { text, blocked: Boolean(o?.promptFeedback?.blockReason), truncated: c?.finishReason === 'MAX_TOKENS' };
}

export async function transcribeWithGemini(audio: Uint8Array, ext: string, deadline: number): Promise<SourceResult> {
  const keys = geminiKeys();
  if (keys.length === 0) return { ok: false, reason: 'not_configured' };
  const base = geminiBase();
  const model = geminiModel();
  const mime = ext === 'mp4' ? 'video/mp4' : 'audio/aac';
  const vocab = await buildVocabHint().catch(() => '');
  const prompt = vocab ? `${GEMINI_PROMPT}\n${vocab}` : GEMINI_PROMPT;
  const inline = audio.byteLength <= GEMINI_INLINE_MAX_BYTES;
  const data = inline ? Buffer.from(audio).toString('base64') : '';

  let last: SourceResult = { ok: false, reason: 'upstream_error' };
  // キーごとの枠（無料枠は1日・1分あたりの回数）に当たったら、次のキーで送り直す。
  for (const key of keys) {
    if (deadline - Date.now() < 20000) return { ok: false, reason: 'timeout' };
    let file: GeminiFile | null = null;
    try {
      if (!inline) {
        file = await uploadToGemini(base, key, audio, mime, left(deadline, 90000));
        if (!file) {
          last = { ok: false, reason: 'upload_failed' };
          continue;
        }
      }
      const res = await fetch(`${base}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              inline ? { inline_data: { mime_type: mime, data } } : { file_data: { mime_type: mime, file_uri: file!.uri } },
            ],
          }],
          // 文字起こしなので創作させない。長い会議でも途中で切れないよう、出力の上限は大きく取る。
          generationConfig: { temperature: 0, maxOutputTokens: 65536 },
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(left(deadline, 240000)),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 300);
        console.error('[ZOOM_TRANSCRIBE] gemini', res.status, body);
        const reason = res.status === 401 || res.status === 403 ? 'invalid_key'
          : res.status === 404 ? 'model_not_found'
          : res.status === 413 ? 'too_large'
          : res.status === 429 ? 'rate_limited'
          : res.status >= 500 ? 'upstream_busy' : 'upstream_error';
        last = { ok: false, reason, detail: `HTTP ${res.status}` };
        // 別のキーで通る見込みがあるのは、枠・キーが原因のときだけ。
        if (reason === 'rate_limited' || reason === 'invalid_key') continue;
        return last;
      }
      const g = geminiText(await res.json().catch(() => null));
      if (g.blocked) return { ok: false, reason: 'blocked' };
      if (!g.text) return { ok: false, reason: 'empty' };
      // 上限で切れたものは最後まで起こせていない。議事録の材料にしない（次の任せ先に回す）。
      if (g.truncated) return { ok: false, reason: 'truncated', detail: `${g.text.length}字` };
      return { ok: true, text: g.text, model };
    } catch (e) {
      const name = (e as Error)?.name;
      return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error' };
    } finally {
      if (file) await deleteFromGemini(base, key, file.name);
    }
  }
  return last;
}
