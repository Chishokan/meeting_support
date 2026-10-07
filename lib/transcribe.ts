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
//   GEMINI_API_KEY_2 … 予備のキー（任意。_3 _4 _5 まで足せる）。
//                    1本目が1日の枠を使い切った／制限に当たったときは、自動で次のキーへ回す。
//                    ★無料枠は Google のプロジェクト単位なので、予備は別の Google アカウントで
//                      発行したキーにしないと枠は増えない（同じアカウントの2本目は同じ枠を使う）。
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

// 議事録用の文字起こしなので、要約させず・補完させず・前置きも書かせない。
// 末尾に社内用語のヒント（lib/transcribeVocab.ts がナレッジから組み立てる）を足して誤変換を減らす。
const PROMPT_BASE = `この音声は学習塾「智翔館」の部門会議の録音です。長い会議を区切ったうちの一部なので、
途中から始まり途中で終わることがあります。

聞こえたとおりに日本語で文字起こししてください。次を必ず守ってください。
- 要約・言い換え・整形をしない。話されたとおりに書く。
- 途中で切れている文を勝手に補わない。聞こえたところまでで止める。
- 「以下が文字起こしです」などの前置きや、あなた自身の説明・感想は一切書かない。
- タイムスタンプは書かない。
- 話者が聞き分けられる場合のみ「安東：」のように行頭に付ける。分からなければ付けない。
- 聞き取れない部分は【聞き取り不明】と書く。
- 音声に人の声が入っていない場合は、何も書かずに空で返す。
`;

// 文字起こしが失敗した理由。画面の文言（components/DeptMinutesUI.tsx の transcribeError）と
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
  | 'model_not_found'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'too_large'
  | 'upstream_busy'
  | 'upstream_error'
  | 'network_error';

export type TranscribeResult =
  // keyNo は何本目のキーで通った／落ちたか（1始まり）。keysTried は試した本数。
  | { ok: true; text: string; keyNo?: number }
  // detail は「HTTP 429 / RESOURCE_EXHAUSTED」のような短い手がかり。
  // 原因が分からないまま何十区間も失敗するのを防ぐため、画面にも出す。
  // retryAfterSec は Gemini が「この秒数だけ待て」と返してきたときだけ入る。
  | { ok: false; reason: TranscribeFail; detail?: string; retryAfterSec?: number; keyNo?: number; keysTried?: number };

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
  if (status === 404) return { reason: 'model_not_found', detail };
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

// 予備キーは GEMINI_API_KEY_2 〜 _5 まで見る。
const MAX_KEY_SLOTS = 5;

// 設定されている Gemini のキーを順番に並べて返す。
// GEMINI_API_KEY にカンマ区切りで複数書く形にも対応している
//（Vercel の環境変数を増やさずに予備を足したいとき用）。
export function geminiKeys(): string[] {
  const out: string[] = [];
  const add = (v: string | undefined) => {
    for (const piece of String(v || '').split(/[,\s]+/)) {
      const k = piece.trim();
      if (k && !out.includes(k)) out.push(k);
    }
  };
  add(process.env.GEMINI_API_KEY);
  for (let i = 2; i <= MAX_KEY_SLOTS; i++) add(process.env[`GEMINI_API_KEY_${i}`]);
  return out;
}

// 直前に通ったキー（0始まり）。次の区間はここから試すので、
// 枠を使い切ったキーに毎回当たりに行かずに済む。
// サーバが入れ替わると 0 に戻るが、そのときは1回だけ余分に弾かれるだけで実害はない。
let preferredKey = 0;

// 次のキーに回す意味がある失敗か。
// Gemini 側の不調（5xx）やタイムアウトはどのキーでも同じ結果になるので回さない。
function shouldSwitchKey(reason: TranscribeFail): boolean {
  return reason === 'quota_exceeded' || reason === 'rate_limited' || reason === 'invalid_key';
}

// 文字起こしが使える状態か（画面の出し分けに使う）。
export function isTranscribeConfigured(): boolean {
  return geminiKeys().length > 0;
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

// キー1本ぶんの確認結果。何本目がどういう状態かを画面にそのまま並べる。
export type KeyCheck = { no: number; ok: boolean; reason?: TranscribeFail; detail?: string };

export type SetupCheck =
  | {
      ok: true;
      model: string;
      // キーごとに実際に1回だけ生成を試した結果。キーが有効でも無料枠を使い切っていると
      // 文字起こしは全部失敗するので、音声を送る前にここで分かるようにしている。
      keys: KeyCheck[];
      usable: number; // いま文字起こしに使えるキーの本数
      modelOk: boolean;
      suggestions: string[];
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
async function probeQuota(base: string, model: string, key: string): Promise<{ ok: boolean; reason?: TranscribeFail; detail?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${base}/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
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
  const keys = geminiKeys();
  if (keys.length === 0) return { ok: false, reason: 'not_configured' };

  const base = process.env.GEMINI_API_URL || DEFAULT_BASE;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  // キーごとに、設定したモデルで実際に1回だけ生成させてみる。
  // この1回で「キーが有効か」「モデル名が合っているか」「枠が残っているか」が同時に分かる。
  const rows: KeyCheck[] = [];
  for (let i = 0; i < keys.length; i++) {
    const r = await probeQuota(base, model, keys[i]);
    rows.push({ no: i + 1, ok: r.ok, reason: r.reason, detail: r.detail });
  }
  const usable = rows.filter((r) => r.ok).length;

  // どのキーでも「そのモデルは無い」と言われたときだけ、使えるモデル名の候補を取りに行く。
  const badModel = usable === 0 && rows.some((r) => r.reason === 'model_not_found');
  let suggestions: string[] = [];
  if (badModel) {
    // モデル一覧は枠を消費しないので、キーが有効でさえあれば引ける。
    const key = keys[rows.findIndex((r) => r.reason === 'model_not_found')] || keys[0];
    suggestions = await listUsableModels(base, key);
  }

  return { ok: true, model, keys: rows, usable, modelOk: !badModel, suggestions };
}

// 設定に使えるモデル名の候補（flash 系を優先して数件だけ）。
async function listUsableModels(base: string, key: string): Promise<string[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${base}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': key },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
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
    return [...usable.filter((n) => n.includes('flash')), ...usable.filter((n) => !n.includes('flash'))].slice(0, 8);
  } catch {
    return [];
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

// 1本のキーで1区間を文字起こしする。キーの切り替えは呼び出し側（transcribeAudio）が行う。
async function callGemini(
  key: string,
  url: string,
  mime: string,
  data: string,
  vocab: string,
): Promise<TranscribeResult> {
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: vocab ? `${PROMPT_BASE}\n${vocab}` : PROMPT_BASE },
          { inline_data: { mime_type: mime, data } },
        ],
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
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      // 本文はログに残し、画面へ返すのは理由と短い手がかりだけにする。
      const body = (await res.text().catch(() => '')).slice(0, 600);
      try {
        console.error('[TRANSCRIBE] gemini', res.status, body);
      } catch {}
      return { ok: false, ...classifyUpstream(res.status, body) };
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

// 1区間を文字起こしする。
// キーが複数あるときは、枠を使い切った／制限に当たったキーを自動で次のキーへ回す。
// （音声の base64 化と用語ヒントの組み立ては1回だけ行い、キーを変えて送り直す）
export async function transcribeAudio(file: Blob, filename: string): Promise<TranscribeResult> {
  const keys = geminiKeys();
  if (keys.length === 0) return { ok: false, reason: 'not_configured' };
  if (!file || file.size === 0) return { ok: false, reason: 'empty' };

  const mime = resolveAudioMime(filename, file.type);
  if (!mime) return { ok: false, reason: 'unsupported_type' };

  const base = process.env.GEMINI_API_URL || DEFAULT_BASE;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `${base}/models/${model}:generateContent`;

  const data = Buffer.from(await file.arrayBuffer()).toString('base64');
  // 社内用語のヒントはナレッジ（GLOSSARY.md / 10_理念・方針/COMPANY.md）から毎回組み立てる。
  // 読めなくても文字起こし自体は止めない。
  let vocab = '';
  try {
    vocab = await buildVocabHint();
  } catch {}

  // 直前に通ったキーから順に、ひと回りだけ試す。
  let last: TranscribeResult = { ok: false, reason: 'upstream_error' };
  for (let n = 0; n < keys.length; n++) {
    const idx = (preferredKey + n) % keys.length;
    const r = await callGemini(keys[idx], url, mime, data, vocab);
    if (r.ok) {
      preferredKey = idx; // 次の区間もこのキーから始める
      return { ...r, keyNo: idx + 1 };
    }
    last = { ...r, keyNo: idx + 1, keysTried: n + 1 };
    if (!shouldSwitchKey(r.reason)) return last;
    try {
      console.error('[TRANSCRIBE] switch key', `${idx + 1} -> ${((idx + 1) % keys.length) + 1}`, r.reason);
    } catch {}
  }
  return { ...last, keysTried: keys.length };
}
