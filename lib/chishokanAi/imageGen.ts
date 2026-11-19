// 智翔館AI：画像を作る（OpenAI の gpt-image、または Google の Gemini の画像モデル）。サーバ専用。
// 道具の定義と入力の確かめは imageTool.ts。保存と1日の枚数は Apps Script（aiImageQuota_・aiImageSave_）。
//
// 使う会社：OPENAI_API_KEY があれば OpenAI を先に使い、うまくいかなければ Google（CHISHOKAN_AI_IMAGE_PROVIDER=google で逆にする）。
//   OpenAI：モデルは OPENAI_IMAGE_MODEL（カンマ区切り）。空なら、そのキーで使えるモデルの一覧から gpt-image-… を選ぶ。
//           API で送った内容は、OpenAI の学習には使われない（既定の扱い）。
// Google：キーは議事録の文字起こしと同じ GEMINI_API_KEY（_2〜_5 の予備も順に使う）。
// ★画像のモデルは無料枠では使えないことがある。課金を有効にしたキーを使う（無料枠は、送った内容が Google の改善に使われることもある）。
// モデルは GEMINI_IMAGE_MODEL（カンマ区切り）で決められる。空なら、そのキーで使えるモデルの一覧から「gemini-…image…」を選ぶ。

import { geminiKeys } from '../transcribe';
import { callGas } from './gas';
import type { CreatedDoc } from './createDoc';
import {
  checkImageInput,
  imageDailyLimit,
  imagePrompt,
  imageProviders,
  openAiSize,
  pickImageModels,
  pickOpenAiImageModels,
  readImageResponse,
  readOpenAiImage,
  type ImageInput,
} from './imageTool';

// 土台の URL（任意。OPENAI_BASE_URL。通常は設定不要）
const openAiBase = () => process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

/** 画像を作れる設定があるか（OpenAI か Google のキー）。無ければ道具を出さない。 */
export function imageAvailable(): boolean {
  return imageProviders({ openai: !!process.env.OPENAI_API_KEY, google: geminiKeys().length > 0 }).length > 0;
}

/**
 * API での画像生成を一旦止めている（2026-11-19 職員の指示）。止めているあいだ、画像・挿絵・背景・チラシの画像を頼まれたら、
 * AI は NEP事業部への作成依頼の案を出す（lib/chishokanAi/nepRequest.ts）。再開するときは false にする。
 */
export const IMAGE_GENERATION_PAUSED = true;

/** 画像を作る道具（generate_image）を AI に渡すか：止めていない、かつキーがある。 */
export function imageGenerationEnabled(): boolean {
  return !IMAGE_GENERATION_PAUSED && imageAvailable();
}

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// 一覧が引けなかったときの候補（新しい順）
const FALLBACK_MODELS = ['gemini-3.1-flash-image', 'gemini-2.5-flash-image'];
const CALL_TIMEOUT_MS = 90_000;
const NOT_DEPLOYED = 'Apps Script が古いままです（再デプロイが必要）';

let modelCache: { at: number; models: string[] } | null = null;

async function imageModels(base: string, key: string, signal?: AbortSignal): Promise<string[]> {
  const env = String(process.env.GEMINI_IMAGE_MODEL || '').split(/[,\s]+/).map((m) => m.trim()).filter(Boolean);
  if (env.length) return env;
  if (modelCache && Date.now() - modelCache.at < 3_600_000) return modelCache.models;
  let picked: string[] = [];
  try {
    const res = await fetch(`${base}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key }, signal: signal ?? AbortSignal.timeout(15_000) });
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as { models?: { name?: unknown; supportedGenerationMethods?: unknown }[] } | null;
      picked = pickImageModels(
        (j?.models ?? []).map((m) => ({
          name: String(m?.name ?? ''),
          methods: Array.isArray(m?.supportedGenerationMethods) ? (m.supportedGenerationMethods as unknown[]).map(String) : [],
        })),
      );
    }
  } catch {
    // 一覧が引けなければ、決まった候補で試す
  }
  const models = picked.length ? picked.slice(0, 3) : FALLBACK_MODELS;
  modelCache = { at: Date.now(), models };
  return models;
}

export type ImageSource = { name: string; mime: string; data: string };
export type MadeImage = { name: string; id: string; url: string; mime: string; data: string };
export type ImageRunResult = { toolResult: string; created: CreatedDoc; image?: MadeImage; inputError?: boolean };

/** 直す元の画像を、名前で探す（同じ名前 → 名前を含むもの）。 */
function findSource(sources: ImageSource[], name: string): ImageSource | undefined {
  return sources.find((s) => s.name === name) ?? sources.find((s) => s.name.includes(name) || name.includes(s.name));
}

type GenFail = { ok: false; why: string; blocked?: boolean };
type GenOk = { ok: true; mime: string; data: string; model: string };

let openAiModelCache: { at: number; models: string[] } | null = null;

async function openAiModels(key: string, signal?: AbortSignal): Promise<string[]> {
  const env = String(process.env.OPENAI_IMAGE_MODEL || '').split(/[,\s]+/).map((m) => m.trim()).filter(Boolean);
  if (env.length) return env;
  if (openAiModelCache && Date.now() - openAiModelCache.at < 3_600_000) return openAiModelCache.models;
  let ids: string[] = [];
  try {
    const res = await fetch(`${openAiBase()}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: signal ?? AbortSignal.timeout(15_000) });
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as { data?: { id?: unknown }[] } | null;
      ids = (j?.data ?? []).map((m) => String(m?.id ?? '')).filter(Boolean);
    }
  } catch {
    // 一覧が引けなければ gpt-image-1 で試す
  }
  const models = pickOpenAiImageModels(ids);
  openAiModelCache = { at: Date.now(), models };
  return models;
}

/** OpenAI に画像を作らせる（直すときは images/edits に元の画像を送る）。見つからないモデルは次へ。 */
async function generateOpenAi(v: ImageInput, src: ImageSource | undefined, signal?: AbortSignal): Promise<GenOk | GenFail> {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) return { ok: false, why: 'OpenAI の API キーがありません' };
  const prompt = imagePrompt(v, !!src);
  const size = openAiSize(v.aspect);
  let last = 'OpenAI で画像を作れませんでした';
  for (const model of await openAiModels(key, signal)) {
    if (signal?.aborted) return { ok: false, why: '途中で止めました' };
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]) : AbortSignal.timeout(CALL_TIMEOUT_MS);
    let res: Response;
    try {
      if (src) {
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', prompt);
        form.append('size', size);
        const ext = src.mime === 'image/jpeg' ? 'jpg' : src.mime === 'image/webp' ? 'webp' : 'png';
        form.append('image', new Blob([Buffer.from(src.data, 'base64')], { type: src.mime }), `source.${ext}`);
        res = await fetch(`${openAiBase()}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: sig });
      } else {
        res = await fetch(`${openAiBase()}/images/generations`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt, size, n: 1 }),
          signal: sig,
        });
      }
    } catch (e) {
      last = (e as Error)?.name === 'TimeoutError' ? 'OpenAI から時間内に返事がありませんでした' : 'OpenAI との通信に失敗しました';
      continue;
    }
    const j = await res.json().catch(() => null);
    const r = readOpenAiImage(j, res.status);
    if (r.ok) return { ok: true, mime: r.mime, data: r.data, model };
    if (r.reason === 'blocked') return { ok: false, blocked: true, why: `この内容は描けませんでした（${r.detail.slice(0, 120)}）` };
    if (res.status === 401 || res.status === 403) return { ok: false, why: `OpenAI の API キーで画像を作れません（${r.detail.slice(0, 120)}）` };
    if (res.status === 429) return { ok: false, why: `OpenAI の利用の上限に達しています（${r.detail.slice(0, 120)}）` };
    // モデルが無い・使えない（404・400 の model）なら次のモデルへ
    last = `OpenAI の画像生成でエラーになりました（${res.status} ${r.detail.slice(0, 120)}）`;
    if (!(res.status === 404 || (res.status === 400 && /model/i.test(r.detail)))) return { ok: false, why: last };
  }
  return { ok: false, why: last };
}

/** 使える会社を順に試す（OpenAI → Google。描けない内容で止まったら、ほかの会社では試さない）。 */
async function generate(v: ImageInput, src: ImageSource | undefined, signal?: AbortSignal): Promise<GenOk | GenFail> {
  const order = imageProviders({ openai: !!process.env.OPENAI_API_KEY, google: geminiKeys().length > 0 });
  if (!order.length) return { ok: false, why: '画像を作る設定（OpenAI か Google の API キー）がありません（システム担当に連絡してください）' };
  const whys: string[] = [];
  for (const p of order) {
    const r = p === 'openai' ? await generateOpenAi(v, src, signal) : await generateGoogle(v, src, signal);
    if (r.ok || r.blocked) return r;
    whys.push(r.why);
    if (signal?.aborted) break;
  }
  return { ok: false, why: whys.join('／') };
}

/** Gemini に画像を作らせる。モデル × キーを順に試す（見つからないモデルは次へ、枠切れ・権限なしのキーは次へ）。 */
async function generateGoogle(v: ImageInput, src: ImageSource | undefined, signal?: AbortSignal): Promise<GenOk | GenFail> {
  const keys = geminiKeys();
  if (!keys.length) return { ok: false, why: '画像を作る設定（Google の API キー）がありません（システム担当に連絡してください）' };
  const base = process.env.GEMINI_API_URL || DEFAULT_BASE;
  const models = await imageModels(base, keys[0], signal);
  const parts: Record<string, unknown>[] = [{ text: imagePrompt(v, !!src) }];
  if (src) parts.push({ inlineData: { mimeType: src.mime, data: src.data } });
  let last = '画像を作れませんでした';
  for (const model of models) {
    for (const key of keys) {
      for (const modalities of [['IMAGE'], ['TEXT', 'IMAGE']]) {
        if (signal?.aborted) return { ok: false, why: '途中で止めました' };
        const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]) : AbortSignal.timeout(CALL_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({
              contents: [{ role: 'user', parts }],
              generationConfig: { responseModalities: modalities, imageConfig: { aspectRatio: v.aspect } },
            }),
            signal: sig,
          });
        } catch (e) {
          last = (e as Error)?.name === 'TimeoutError' ? 'Google から時間内に返事がありませんでした' : '通信に失敗しました';
          break; // 次のキーへ
        }
        const j = await res.json().catch(() => null);
        if (res.ok) {
          const r = readImageResponse(j);
          if (r.ok) return { ok: true, mime: r.mime, data: r.data, model };
          if (r.reason === 'blocked') return { ok: false, blocked: true, why: `この内容は描けませんでした（${r.detail}）` };
          last = `画像が返ってきませんでした（${r.detail.slice(0, 80)}）`;
          break;
        }
        const msg = String((j as { error?: { message?: unknown } } | null)?.error?.message ?? res.statusText).slice(0, 160);
        // 返事の形（画像だけ）が使えないモデルは、文字と画像で頼み直す
        if (res.status === 400 && modalities.length === 1 && /modalit|response/i.test(msg)) continue;
        if (res.status === 404) { last = `モデル ${model} が使えません`; break; }
        if (res.status === 429 || res.status === 403 || res.status === 401) {
          last = res.status === 429 ? 'Google の利用の上限に達しています（無料枠では画像を作れないことがあります）' : `Google の API キーで画像を作れません（${msg}）`;
          break; // 次のキーへ
        }
        last = `Google の画像生成でエラーになりました（${res.status} ${msg}）`;
        break;
      }
      if (/モデル .* が使えません/.test(last)) break; // 次のモデルへ
    }
  }
  return { ok: false, why: last };
}

/** generate_image：画像を作って保存し、AI に返す文と、画面に出す画像を返す。 */
export async function runGenerateImage(
  input: Record<string, unknown>,
  who: { campus: string; user: string; email?: string },
  sources: ImageSource[],
  signal?: AbortSignal,
): Promise<ImageRunResult> {
  const c = checkImageInput(input);
  if (!c.ok) return { toolResult: c.message, created: { ok: false, title: '画像', note: c.message }, inputError: true };
  const v = c.value;
  const fail = (why: string, extra = '') => ({
    toolResult: `画像を作れませんでした（${why}）。この回答では呼び直さない。職員にそのことを伝え、${extra || '使った説明（プロンプト）を回答に書く。'}`,
    created: { ok: false, title: `画像：${v.name}`, note: why },
  });
  let src: ImageSource | undefined;
  if (v.source) {
    src = findSource(sources, v.source);
    if (!src) {
      const names = sources.map((s) => s.name).join('、') || 'なし';
      return { toolResult: `直す元の画像「${v.source}」が見つかりません。使える画像：${names}。名前を直して呼ぶか、新しく作るなら source を省く。`, created: { ok: false, title: `画像：${v.name}`, note: '元の画像が見つからない' }, inputError: true };
    }
  }
  // 1日の枚数（Apps Script の _画像 シートで数える）
  const limit = imageDailyLimit();
  const q = await callGas({ action: 'aiImageQuota', user: who.user, limit }, signal);
  if (!q.ok) return fail('枚数を確かめられませんでした（Apps Script との通信に失敗しました）');
  if (q.saved !== 'aiImage') return fail(NOT_DEPLOYED);
  if (q.over === true) return fail(`きょう作れる枚数（${limit}枚）を使い切りました。あしたまた作れます`, 'あしたまた作れることを伝える。');

  const g = await generate(v, src, signal);
  if (!g.ok) {
    return g.blocked
      ? { toolResult: `${g.why}。実在の人物・他社のロゴなど、描けない内容が入っていないか見直し、説明を変えて1回だけ呼び直してよい。`, created: { ok: false, title: `画像：${v.name}`, note: g.why }, inputError: true }
      : fail(g.why);
  }
  const ext = g.mime === 'image/jpeg' ? 'jpg' : g.mime === 'image/webp' ? 'webp' : 'png';
  const fileName = `${v.name}.${ext}`;
  const s = await callGas(
    {
      action: 'aiImageSave',
      user: who.user,
      campus: who.campus,
      email: who.email ?? '',
      name: fileName,
      mime: g.mime,
      base64: g.data,
      purpose: v.purpose,
      aspect: v.aspect,
      prompt: v.prompt.slice(0, 1000),
      source: src?.name ?? '',
      model: g.model,
    },
    signal,
  );
  if (!s.ok || s.saved !== 'aiImage' || typeof s.url !== 'string' || typeof s.id !== 'string') {
    const why = s.ok ? NOT_DEPLOYED : `ドライブに保存できませんでした${typeof s.detail === 'string' ? `（${s.detail.slice(0, 80)}）` : ''}`;
    return fail(why);
  }
  const shareNote = typeof s.shareError === 'string' && s.shareError ? `\nリンクの共有を設定できませんでした（${s.shareError.slice(0, 80)}）。職員にそのことを伝える。` : '';
  return {
    toolResult:
      `画像を作りました（${v.purpose}・縦横 ${v.aspect}${src ? `・「${src.name}」を直した` : ''}）。ファイル名：${s.name ?? fileName}／リンク：${s.url}／id：${s.id}\n` +
      '画像は画面の回答の下にも出る。次の質問で「文字を大きく」などと頼まれたら、source にこのファイル名を入れて直す。' +
      `スライドに入れるときは、create_google_slides の layout の image に id「${s.id}」を入れる。\n` +
      '回答には、このリンクと、画像の中の文字（とくに日付・料金・電話番号・学校名）を原稿と照らし合わせてほしいこと、ロゴ・QRコードはあとから正式データを重ねることを書く。' +
      shareNote,
    created: { ok: true, title: `画像：${v.name}`, url: s.url, note: `作成（${v.purpose}・${v.aspect}${src ? '・直し' : ''}）` },
    image: { name: String(s.name ?? fileName), id: s.id, url: s.url, mime: g.mime, data: g.data },
  };
}
