// 音声の文字起こし（会議DX フェーズ2）— Google AI Studio（Gemini API）
// -------------------------------------------------------------------------
// Claude（Anthropic Messages API）は音声を直接受け取れないため、
// 文字起こしだけ Gemini に任せ、その結果を Claude に渡して議事録化する。
//
// Gemini は音声をそのまま読めるので、音声を base64 にして generateContent へ送り、
// 「そのまま文字に起こして」と指示するだけでよい。
//
// 【環境変数】※未設定でもアプリは壊れない（画面が「テキスト貼り付け」を案内する）
//   GEMINI_API_KEY … Google AI Studio（https://aistudio.google.com/apikey）で発行したキー。
//                    これが未設定なら文字起こし機能は無効になる。
//   GEMINI_MODEL   … 使用モデル（既定 gemini-3.6-flash）。新しいモデルに変えたいときだけ設定する。
//   GEMINI_API_URL … エンドポイントの土台（既定 https://generativelanguage.googleapis.com/v1beta）。
//                    通常は設定不要。
//
// 【対応している音声形式】WAV / MP3 / AIFF / AAC / OGG / FLAC
//   ★ブラウザ録音の webm は Gemini が受け付けないため、
//     画面側（lib/audioChunk.ts）で 16kHz モノラルの WAV に変換してから送っている。

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.6-flash';

// Vercel の関数実行時間（60秒）に当たる前に自分で打ち切る。
const TIMEOUT_MS = 50000;

// 議事録用の文字起こしなので、要約させず・補完させず・前置きも書かせない。
// 固有名詞のヒントを添えて誤変換を減らす。
const PROMPT = `この音声は学習塾「智翔館」の部門会議の録音です。長い会議を区切ったうちの一部なので、
途中から始まり途中で終わることがあります。

聞こえたとおりに日本語で文字起こししてください。次を必ず守ってください。
- 要約・言い換え・整形をしない。話されたとおりに書く。
- 途中で切れている文を勝手に補わない。聞こえたところまでで止める。
- 「以下が文字起こしです」などの前置きや、あなた自身の説明・感想は一切書かない。
- タイムスタンプは書かない。
- 話者が聞き分けられる場合のみ「安東：」のように行頭に付ける。分からなければ付けない。
- 聞き取れない部分は【聞き取り不明】と書く。
- 音声に人の声が入っていない場合は、何も書かずに空で返す。

固有名詞のヒント：智翔館、小中等部、RED個別、高等部、LEC、英検、総務、人事、支援、管理、
在籍数、体験授業、面談、講習、模試、退塾、決裁、協議、議事録。`;

export type TranscribeResult =
  | { ok: true; text: string }
  | {
      ok: false;
      reason: 'not_configured' | 'empty' | 'unsupported_type' | 'blocked' | 'timeout' | 'upstream_error' | 'network_error';
    };

// Gemini が受け付ける音声形式（拡張子 → MIME）。webm はここに無い。
const MIME_BY_EXT: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mp3',
  m4a: 'audio/aac',
  aac: 'audio/aac',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
};

// 文字起こしが使える状態か（画面の出し分けに使う）。
export function isTranscribeConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

// ファイル名・MIME から Gemini に渡す MIME を決める。判断できなければ null。
export function resolveAudioMime(filename: string, given: string): string | null {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  const g = (given || '').split(';')[0].trim().toLowerCase();
  if (Object.values(MIME_BY_EXT).includes(g)) return g;
  if (g === 'audio/mpeg') return 'audio/mp3';
  if (g === 'audio/x-wav' || g === 'audio/wave') return 'audio/wav';
  return null;
}

// ---------------------------------------------------------------------------
// 設定の確認（画面の「接続テスト」ボタンから呼ばれる）
// ---------------------------------------------------------------------------
// キーが有効か・設定したモデルが実際に使えるかを、音声を送る前に確かめる。
// モデル名の打ち間違いは「文字起こしに失敗しました」としか出ず原因が分かりにくいので、
// ここで「そのモデルは使えない／使えるのはこれ」と具体的に返す。

export type SetupCheck =
  | { ok: true; model: string; modelOk: boolean; suggestions: string[] }
  | { ok: false; reason: 'not_configured' | 'invalid_key' | 'timeout' | 'upstream_error' | 'network_error' };

// 音声を渡して文字起こしさせるのに向くモデルだけを候補として残す。
function isUsableModel(name: string, methods: string[]): boolean {
  if (!methods.includes('generateContent')) return false;
  return !/(tts|embedding|imagen|image-|aqa)/i.test(name);
}

export async function checkTranscribeSetup(): Promise<SetupCheck> {
  if (!isTranscribeConfigured()) return { ok: false, reason: 'not_configured' };

  const base = process.env.GEMINI_API_URL || DEFAULT_BASE;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${base}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY as string },
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'invalid_key' };
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      try {
        console.error('[TRANSCRIBE] check', res.status, detail);
      } catch {}
      return { ok: false, reason: 'upstream_error' };
    }

    const j = (await res.json().catch(() => null)) as {
      models?: { name?: unknown; supportedGenerationMethods?: unknown }[];
    } | null;
    const rows = Array.isArray(j?.models) ? j!.models! : [];

    const usable: string[] = [];
    for (const m of rows) {
      // name は "models/gemini-..." の形で返る。設定に使う短い名前へ直す。
      const full = typeof m?.name === 'string' ? m.name : '';
      const short = full.replace(/^models\//, '');
      const methods = Array.isArray(m?.supportedGenerationMethods)
        ? (m.supportedGenerationMethods as unknown[]).map((x) => String(x))
        : [];
      if (short && isUsableModel(short, methods)) usable.push(short);
    }

    return {
      ok: true,
      model,
      modelOk: usable.includes(model),
      // 使えない場合に画面へ出す候補（flash 系を優先して数件だけ）。
      suggestions: [...usable.filter((n) => n.includes('flash')), ...usable.filter((n) => !n.includes('flash'))].slice(0, 8),
    };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    try {
      console.error('[TRANSCRIBE] check', aborted ? 'timeout' : String(e));
    } catch {}
    return { ok: false, reason: aborted ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}

// 返ってきた候補からテキストだけを拾う（parts が複数に割れることがあるので全部つなぐ）。
function readText(j: unknown): string {
  const root = j as {
    candidates?: { content?: { parts?: { text?: unknown }[] } }[];
  } | null;
  const parts = root?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

export async function transcribeAudio(file: Blob, filename: string): Promise<TranscribeResult> {
  if (!isTranscribeConfigured()) return { ok: false, reason: 'not_configured' };
  if (!file || file.size === 0) return { ok: false, reason: 'empty' };

  const mime = resolveAudioMime(filename, file.type);
  if (!mime) return { ok: false, reason: 'unsupported_type' };

  const base = process.env.GEMINI_API_URL || DEFAULT_BASE;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `${base}/models/${model}:generateContent`;

  const data = Buffer.from(await file.arrayBuffer()).toString('base64');
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data } }],
      },
    ],
    // 文字起こしなので創作させない。
    generationConfig: { temperature: 0 },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // キーはヘッダで渡す（URL に付けるとログや履歴に残りやすいため）。
        'x-goog-api-key': process.env.GEMINI_API_KEY as string,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      // 失敗理由はサーバのログにだけ残す（APIキーが画面に出る事故を避ける）。
      const detail = (await res.text().catch(() => '')).slice(0, 400);
      try {
        console.error('[TRANSCRIBE] gemini', res.status, detail);
      } catch {}
      return { ok: false, reason: 'upstream_error' };
    }

    const j = (await res.json().catch(() => null)) as {
      promptFeedback?: { blockReason?: string };
      candidates?: { finishReason?: string }[];
    } | null;

    // 安全フィルタ等で止められた場合は、空文字ではなく理由を返す。
    const blocked = j?.promptFeedback?.blockReason;
    const finish = j?.candidates?.[0]?.finishReason;
    if (blocked || (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS')) {
      try {
        console.error('[TRANSCRIBE] gemini blocked', blocked || finish);
      } catch {}
      return { ok: false, reason: 'blocked' };
    }

    return { ok: true, text: readText(j) };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    try {
      console.error('[TRANSCRIBE] gemini', aborted ? 'timeout' : String(e));
    } catch {}
    return { ok: false, reason: aborted ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}
