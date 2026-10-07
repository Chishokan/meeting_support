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

import { buildVocabHint } from '@/lib/transcribeVocab';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.6-flash';

// Vercel の関数実行時間（60秒）に当たる前に自分で打ち切る。
const TIMEOUT_MS = 50000;

// 議事録・面談記録用の文字起こしなので、要約させず・補完させず・前置きも書かせない。
// 末尾に社内用語のヒント（lib/transcribeVocab.ts がナレッジから組み立てる）を足して誤変換を減らす。
// 何の録音か（kind）で冒頭の説明と話者の付け方だけを変える。
export type TranscribeKind = 'meeting' | 'interview';

const PROMPT_HEAD: Record<TranscribeKind, string> = {
  meeting: `この音声は学習塾「智翔館」の部門会議の録音です。長い会議を区切ったうちの一部なので、
途中から始まり途中で終わることがあります。`,
  interview: `この音声は学習塾「智翔館」の面談（講師・教室長と、生徒または保護者との面談）の録音です。
長い面談を区切ったうちの一部なので、途中から始まり途中で終わることがあります。`,
};

const SPEAKER_RULE: Record<TranscribeKind, string> = {
  meeting: '- 話者が聞き分けられる場合のみ「安東：」のように行頭に付ける。分からなければ付けない。',
  interview:
    '- 話者が聞き分けられる場合のみ、行頭に「講師：」「生徒：」「保護者：」のいずれかを付ける。分からなければ付けない。',
};

function promptBase(kind: TranscribeKind): string {
  return `${PROMPT_HEAD[kind]}

聞こえたとおりに日本語で文字起こししてください。次を必ず守ってください。
- 要約・言い換え・整形をしない。話されたとおりに書く。
- 途中で切れている文を勝手に補わない。聞こえたところまでで止める。
- 「以下が文字起こしです」などの前置きや、あなた自身の説明・感想は一切書かない。
- タイムスタンプは書かない。
${SPEAKER_RULE[kind]}
- 聞き取れない部分は【聞き取り不明】と書く。
- 音声に人の声が入っていない場合は、何も書かずに空で返す。
`;
}

// 文字起こしが失敗した理由。画面の文言（lib/useAudioTranscriber.ts の transcribeError）と
// 対になっているので、増やしたら向こうにも足すこと。
//   rate_limited   … 短い時間に送りすぎた。少し待てば通る（画面が自動で待って送り直す）
//   quota_exceeded … 無料枠の1日分を使い切った。待っても今日はもう通らない
//   upstream_busy  … Gemini 側が一時的に不調（5xx）。待てば通ることが多い
//   invalid_key    … キーが無効・権限が無い。全区間が同じ理由で失敗する
export type TranscribeFail =
  | 'not_configured'
  | 'empty'
  | 'unsupported_type'
  | 'blocked'
  | 'timeout'
  | 'invalid_key'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'too_large'
  | 'upstream_busy'
  | 'upstream_error'
  | 'network_error';

export type TranscribeResult =
  | { ok: true; text: string }
  // detail は「HTTP 429 / RESOURCE_EXHAUSTED」のような短い手がかり。
  // 原因が分からないまま何十区間も失敗するのを防ぐため、画面にも出す。
  // retryAfterSec は Gemini が「この秒数だけ待て」と返してきたときだけ入る。
  | { ok: false; reason: TranscribeFail; detail?: string; retryAfterSec?: number };

// Gemini のエラー応答を、画面で扱える理由に分ける。
// 本文をそのまま画面へ出すと分かりにくいうえ量も多いので、
// 返すのは HTTP コードと status（RESOURCE_EXHAUSTED 等）だけにする。
function classifyUpstream(
  status: number,
  body: string,
): { reason: TranscribeFail; detail: string; retryAfterSec?: number } {
  let gStatus = '';
  let message = '';
  let retryAfterSec: number | undefined;
  try {
    const j = JSON.parse(body) as { error?: { status?: unknown; message?: unknown; details?: unknown[] } };
    gStatus = typeof j?.error?.status === 'string' ? j.error.status : '';
    message = typeof j?.error?.message === 'string' ? j.error.message : '';
    const details = Array.isArray(j?.error?.details) ? (j.error!.details as unknown[]) : [];
    for (const d of details) {
      const delay = (d as { retryDelay?: unknown })?.retryDelay;
      if (typeof delay === 'string') {
        const m = delay.match(/([\d.]+)s/);
        if (m) retryAfterSec = Math.ceil(Number(m[1]));
      }
    }
  } catch {}

  const detail = `HTTP ${status}${gStatus ? ` / ${gStatus}` : ''}`;
  if (status === 401 || status === 403) return { reason: 'invalid_key', detail };
  if (status === 413) return { reason: 'too_large', detail };
  if (status === 429) {
    // 「1日あたり」の上限は待っても回復しないので、混雑（数十秒待てば通る）と分けて伝える。
    const perDay = /per\s*day|perday|daily/i.test(message);
    return { reason: perDay ? 'quota_exceeded' : 'rate_limited', detail, retryAfterSec };
  }
  if (status >= 500) return { reason: 'upstream_busy', detail, retryAfterSec };
  return { reason: 'upstream_error', detail };
}

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
  | {
      ok: true;
      model: string;
      modelOk: boolean;
      suggestions: string[];
      // 実際に1回だけ生成を試した結果。キーが有効でも無料枠を使い切っていると
      // 文字起こしは全部失敗するので、音声を送る前にここで分かるようにしている。
      quotaOk?: boolean;
      quotaReason?: TranscribeFail;
      quotaDetail?: string;
    }
  | { ok: false; reason: 'not_configured' | 'invalid_key' | 'timeout' | 'upstream_error' | 'network_error' };

// 音声を渡して文字起こしさせるのに向くモデルだけを候補として残す。
function isUsableModel(name: string, methods: string[]): boolean {
  if (!methods.includes('generateContent')) return false;
  return !/(tts|embedding|imagen|image-|aqa)/i.test(name);
}

// 文字起こしと同じ経路で1回だけ生成させ、「いま実際に使えるか」を確かめる。
// モデル一覧（ListModels）は枠を消費しないため、1日の無料枠を使い切っていても
// 「接続できました」と出てしまう。それを防ぐための確認なので、
// ここでは意図的に generateContent を1回だけ呼ぶ。
async function probeQuota(base: string, model: string): Promise<{ ok: boolean; reason?: TranscribeFail; detail?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${base}/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY as string,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ok' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 1 },
      }),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true };
    const body = (await res.text().catch(() => '')).slice(0, 600);
    try {
      console.error('[TRANSCRIBE] probe', res.status, body);
    } catch {}
    const c = classifyUpstream(res.status, body);
    return { ok: false, reason: c.reason, detail: c.detail };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    return { ok: false, reason: aborted ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
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

    const modelOk = usable.includes(model);
    // モデル名が合っているときだけ、枠が残っているかまで確かめる
    //（名前が違えば必ず失敗するので、確かめる意味がない）。
    const quota = modelOk ? await probeQuota(base, model) : null;

    return {
      ok: true,
      model,
      modelOk,
      // 使えない場合に画面へ出す候補（flash 系を優先して数件だけ）。
      suggestions: [...usable.filter((n) => n.includes('flash')), ...usable.filter((n) => !n.includes('flash'))].slice(0, 8),
      ...(quota ? { quotaOk: quota.ok, quotaReason: quota.reason, quotaDetail: quota.detail } : {}),
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

// ---------------------------------------------------------------------------
// 混雑時の予備モデル
// ---------------------------------------------------------------------------
// Gemini の無料枠は「モデルごと」に混雑（503）や回数制限（429）がかかる。
// 設定したモデルが断られたら、同じ区間をすぐ別の flash 系モデルで送り直す
//（画面側で何十秒も待つより早く、ほとんどの場合そのまま通る）。
//   GEMINI_FALLBACK_MODELS … 予備のモデル名をカンマ区切りで指定（任意）。
//                            未設定なら、キーで使えるモデルの一覧から flash 系を自動で2つまで選ぶ。
//                            「none」にすると予備を使わない。

// 予備に回す理由。これ以外（キーが無効・形式が違う等）はどのモデルでも同じ結果になる。
const FALLBACK_REASONS: TranscribeFail[] = ['rate_limited', 'quota_exceeded', 'upstream_busy'];
const MAX_FALLBACKS = 2;
// 予備に回すのは、残り時間がこれ以上あるときだけ（90秒の区間の文字起こしにかかる時間の目安）。
const MIN_TIME_FOR_TRY_MS = 15000;

let autoFallback: { at: number; models: string[] } | null = null;

// 予備モデルの候補を並べる。安定版（preview / exp でない）→ flash → flash-lite の順に好む。
function rankFallbacks(names: string[], primary: string): string[] {
  const score = (n: string) =>
    (/preview|exp/i.test(n) ? 2 : 0) + (/lite/i.test(n) ? 1 : 0) + (/flash/i.test(n) ? 0 : 10);
  return names
    .filter((n) => n !== primary && /flash/i.test(n) && !/(live|audio|tts|image|thinking)/i.test(n))
    .sort((a, b) => score(a) - score(b) || b.localeCompare(a))
    .slice(0, MAX_FALLBACKS);
}

async function fallbackModels(base: string, primary: string): Promise<string[]> {
  const env = process.env.GEMINI_FALLBACK_MODELS?.trim();
  if (env) {
    if (env.toLowerCase() === 'none') return [];
    return env.split(',').map((m) => m.trim()).filter((m) => m && m !== primary).slice(0, MAX_FALLBACKS);
  }
  // モデル一覧は枠を消費しない。6時間は覚えておく（区間ごとに問い合わせないため）。
  if (autoFallback && Date.now() - autoFallback.at < 6 * 3600 * 1000) return autoFallback.models;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${base}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY as string },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const j = (await res.json().catch(() => null)) as {
      models?: { name?: unknown; supportedGenerationMethods?: unknown }[];
    } | null;
    const names: string[] = [];
    for (const m of Array.isArray(j?.models) ? j!.models! : []) {
      const short = (typeof m?.name === 'string' ? m.name : '').replace(/^models\//, '');
      const methods = Array.isArray(m?.supportedGenerationMethods)
        ? (m.supportedGenerationMethods as unknown[]).map((x) => String(x))
        : [];
      if (short && isUsableModel(short, methods)) names.push(short);
    }
    autoFallback = { at: Date.now(), models: rankFallbacks(names, primary) };
    return autoFallback.models;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// 1つのモデルに1回だけ送る。
async function callModel(
  base: string,
  model: string,
  body: unknown,
  timeoutMs: number,
): Promise<TranscribeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/models/${model}:generateContent`, {
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
      // 本文はログに残し、画面へ返すのは理由と短い手がかりだけにする。
      const text = (await res.text().catch(() => '')).slice(0, 600);
      try {
        console.error('[TRANSCRIBE] gemini', model, res.status, text);
      } catch {}
      return { ok: false, ...classifyUpstream(res.status, text) };
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
        console.error('[TRANSCRIBE] gemini blocked', model, blocked || finish);
      } catch {}
      return { ok: false, reason: 'blocked' };
    }

    return { ok: true, text: readText(j) };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    try {
      console.error('[TRANSCRIBE] gemini', model, aborted ? 'timeout' : String(e));
    } catch {}
    return aborted
      ? { ok: false, reason: 'timeout' }
      // サーバから Gemini へつながらなかった（スマホ側の通信とは別）。
      : { ok: false, reason: 'network_error', detail: 'サーバ→Gemini の接続失敗' };
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeAudio(
  file: Blob,
  filename: string,
  kind: TranscribeKind = 'meeting',
): Promise<TranscribeResult> {
  if (!isTranscribeConfigured()) return { ok: false, reason: 'not_configured' };
  if (!file || file.size === 0) return { ok: false, reason: 'empty' };

  const mime = resolveAudioMime(filename, file.type);
  if (!mime) return { ok: false, reason: 'unsupported_type' };

  const started = Date.now();
  const base = process.env.GEMINI_API_URL || DEFAULT_BASE;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  const data = Buffer.from(await file.arrayBuffer()).toString('base64');
  // 社内用語のヒントはナレッジ（GLOSSARY.md / 10_理念・方針/COMPANY.md）から毎回組み立てる。
  // 読めなくても文字起こし自体は止めない。
  let vocab = '';
  try {
    vocab = await buildVocabHint();
  } catch {}

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: vocab ? `${promptBase(kind)}\n${vocab}` : promptBase(kind) },
          { inline_data: { mime_type: mime, data } },
        ],
      },
    ],
    // 文字起こしなので創作させない。
    generationConfig: { temperature: 0 },
  };

  // まず設定したモデル。混雑・回数制限で断られたら予備のモデルへ。
  const first = await callModel(base, model, body, TIMEOUT_MS);
  if (first.ok || !FALLBACK_REASONS.includes(first.reason)) return first;

  const tried: string[] = [`${model}: ${first.detail || first.reason}`];
  let last: TranscribeResult = first;
  let allQuota = first.reason === 'quota_exceeded';
  for (const fb of await fallbackModels(base, model)) {
    const left = TIMEOUT_MS - (Date.now() - started);
    if (left < MIN_TIME_FOR_TRY_MS) break;
    const r = await callModel(base, fb, body, left);
    if (r.ok) {
      try {
        console.log('[TRANSCRIBE] fallback used', fb, 'after', tried.join(' / '));
      } catch {}
      return r;
    }
    tried.push(`${fb}: ${r.detail || r.reason}`);
    last = r;
    if (r.reason !== 'quota_exceeded') allQuota = false;
    if (!FALLBACK_REASONS.includes(r.reason)) break;
  }
  if (last.ok) return last;
  // どのモデルも断った。1日の枠切れが混ざっていても、混雑で断ったモデルがあれば「待てば通る」扱いにする。
  const reason: TranscribeFail = allQuota ? 'quota_exceeded' : last.reason === 'quota_exceeded' ? 'rate_limited' : last.reason;
  return {
    ok: false,
    reason,
    detail: tried.join(' → '),
    retryAfterSec: last.retryAfterSec ?? first.retryAfterSec,
  };
}
