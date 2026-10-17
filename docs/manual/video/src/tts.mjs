// 台本（storyboard.mjs の say）を Gemini の音声合成（TTS）で読み上げ、スライドごとの WAV にする。
//   node tts.mjs              … まだ作っていない（または原稿を直した）スライドだけ作る
//   node tts.mjs --force      … 全部作り直す
//   node tts.mjs --only s1a,s2b
//   node tts.mjs --no-verify  … 作った音声の聞き取り確認をしない
//
// 出力：audio/<id>.wav と audio/<id>.json（原稿・声・モデル・秒数・聞き取り確認の結果）
//
// 環境変数（アプリの .env.example と同じ名前）
//   GEMINI_API_KEY（必須）／GEMINI_API_KEY_2〜_5（任意。別の Google アカウントのキーなら無料枠が増える）
//   GEMINI_TTS_MODEL … 読み上げのモデル。未設定ならモデル一覧から "tts" を含む flash 系を自動で選ぶ
//   GEMINI_TTS_VOICE … 声（既定 Kore。ほかに Aoede・Charon・Puck など）
//   GEMINI_TTS_RPM   … キー1本あたり1分間に送ってよい回数（既定 3。無料枠に合わせて小さめ）
//   GEMINI_MODEL     … 聞き取り確認（文字起こし）に使うモデル（既定 gemini-3.6-flash）
//   GEMINI_RPM       … 聞き取り確認のモデルに1分間に送ってよい回数（既定 5）
//
// ★無料枠には1日の回数の上限がある。途中で「1日の枠を使い切り」で止まったら、翌日にもう一度実行すれば続きから作る。

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { SLIDES } from './storyboard.mjs';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const AUDIO = path.join(DIR, 'audio');
const API = (process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const VOICE = process.env.GEMINI_TTS_VOICE || 'Kore';
const RPM = Number(process.env.GEMINI_TTS_RPM) > 0 ? Number(process.env.GEMINI_TTS_RPM) : 3;
const VERIFY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const VERIFY_RPM = Number(process.env.GEMINI_RPM) > 0 ? Number(process.env.GEMINI_RPM) : 5;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const VERIFY = !args.includes('--no-verify');
const ONLY = (() => {
  const i = args.indexOf('--only');
  return i >= 0 ? new Set(String(args[i + 1] || '').split(',').filter(Boolean)) : null;
})();

// 原稿だけを送る。「落ち着いた声で読み上げてください」のような指示を前に付けると、
// gemini-3.8-flash-tts は指示まで読み上げてしまう（systemInstruction も受け付けない）。

function keys() {
  const list = String(process.env.GEMINI_API_KEY || '').split(',').map((k) => k.trim()).filter(Boolean);
  for (let n = 2; n <= 5; n++) {
    const k = String(process.env[`GEMINI_API_KEY_${n}`] || '').trim();
    if (k) list.push(k);
  }
  return [...new Set(list)];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// キーとモデルごとに、最後に送った時刻を覚えて間隔をあける（無料枠は1分あたりの回数で止まるため）。
const lastSent = new Map();
async function hold(slot, rpm) {
  const gap = Math.ceil(60000 / rpm) + 1000;
  const wait = (lastSent.get(slot) || 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastSent.set(slot, Date.now());
}

// 429 の中身から、待てば通るのか（1分の上限）、今日はもう無理なのか（1日の上限）を見分ける。
function quotaKind(err) {
  const details = err?.error?.details || [];
  const ids = details.flatMap((d) => (d.violations || []).map((v) => String(v.quotaId || '')));
  const retry = details.find((d) => String(d['@type'] || '').includes('RetryInfo'));
  const sec = retry ? parseFloat(String(retry.retryDelay || '0')) : 0;
  const daily = ids.some((id) => /PerDay/i.test(id));
  return { daily, retrySec: Number.isFinite(sec) ? sec : 0 };
}

class StopError extends Error {}

const deadKeys = new Set();

// 1回分の generateContent。使えるキーを順に使い、待てば通る失敗は待って送り直す。
async function call(model, body, rpm) {
  const all = keys();
  for (let attempt = 0; attempt < 8; attempt++) {
    const usable = all.filter((k) => !deadKeys.has(k));
    if (usable.length === 0) throw new StopError('登録されているAPIキーがすべて使えなくなりました（1日の枠を使い切ったか、キーが無効です）。');
    // いちばん長く使っていないキーを選ぶ
    usable.sort((a, b) => (lastSent.get(`${model}|${a}`) || 0) - (lastSent.get(`${model}|${b}`) || 0));
    const key = usable[0];
    await hold(`${model}|${key}`, rpm);
    let res;
    try {
      res = await fetch(`${API}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.log(`  通信エラー（${e.message}）。20秒待って送り直します`);
      await sleep(20000);
      continue;
    }
    const j = await res.json().catch(() => ({}));
    if (res.ok) return j;
    const msg = j?.error?.message || `HTTP ${res.status}`;
    const keyNo = all.indexOf(key) + 1;
    if (res.status === 429) {
      const q = quotaKind(j);
      if (q.daily) {
        console.log(`  キー${keyNo}：1日の枠を使い切りました`);
        deadKeys.add(key);
        continue;
      }
      const wait = Math.min(90, Math.max(15, Math.ceil(q.retrySec) || 30));
      console.log(`  キー${keyNo}：1分あたりの上限に当たりました。${wait}秒待って送り直します`);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      console.log(`  キー${keyNo}：使えません（${msg}）`);
      deadKeys.add(key);
      continue;
    }
    if (res.status >= 500) {
      console.log(`  Gemini 側の不調（${msg}）。20秒待って送り直します`);
      await sleep(20000);
      continue;
    }
    // 400 など：モデル名・声の名前・送り方の間違い。待っても直らない。
    throw new StopError(`${model} が受け付けませんでした：${msg}`);
  }
  throw new StopError('何度送っても通りませんでした。時間をおいてもう一度実行してください。');
}

async function pickTtsModel() {
  if (process.env.GEMINI_TTS_MODEL) return process.env.GEMINI_TTS_MODEL;
  const key = keys()[0];
  const res = await fetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new StopError(`モデル一覧を取得できませんでした：${j?.error?.message || res.status}`);
  const names = (j.models || [])
    .filter((m) => /tts/i.test(m.name) && (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
  if (names.length === 0) throw new StopError('読み上げ（TTS）に使えるモデルが見つかりません。GEMINI_TTS_MODEL で指定してください。');
  // 無料枠で使える flash 系を優先し、その中で新しいものを選ぶ
  const ver = (n) => parseFloat((n.match(/(\d+(?:\.\d+)?)/) || [])[1] || '0');
  names.sort((a, b) => (/flash/.test(b) - /flash/.test(a)) || (ver(b) - ver(a)) || (/preview/.test(a) - /preview/.test(b)));
  console.log(`読み上げのモデル：${names[0]}（候補：${names.join(' / ')}）`);
  return names[0];
}

// Gemini の TTS は 16bit・モノラルの PCM（mimeType に rate が入る）で返す。WAV の頭を付ける。
function toWav(b64, mime) {
  const data = Buffer.from(b64, 'base64');
  if (/wav/i.test(mime)) return data;
  const rate = Number((mime.match(/rate=(\d+)/) || [])[1] || 24000);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function wavSeconds(buf) {
  const rate = buf.readUInt32LE(24);
  const bytesPerSec = buf.readUInt32LE(28) || rate * 2;
  const idx = buf.indexOf('data', 12);
  const len = idx >= 0 ? buf.readUInt32LE(idx + 4) : buf.length - 44;
  return len / bytesPerSec;
}

async function speak(model, text) {
  const j = await call(model, {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
    },
  }, RPM);
  const part = (j?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw new StopError(`音声が返ってきませんでした（${j?.candidates?.[0]?.finishReason || '理由不明'}）`);
  return toWav(part.inlineData.data, String(part.inlineData.mimeType || ''));
}

async function transcribe(wav) {
  const j = await call(VERIFY_MODEL, {
    contents: [{
      parts: [
        { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } },
        // 「聞こえたとおりに」だけだと、指示のように聞こえる部分を省いて書き起こすことがある
        { text: 'この音声で話されている言葉を、最初から最後まで、一字一句そのまま日本語で書き起こしてください。指示のように聞こえる部分も含め、省略・要約・言い換えはしないでください。書き起こした文だけを出力してください。' },
      ],
    }],
  }, VERIFY_RPM);
  return (j?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}

// 表記ゆれ（漢字・かな、句読点）があっても大きな食い違いだけを拾えるよう、2文字ずつの重なりで比べる。
const norm = (s) => s.normalize('NFKC').replace(/[\s、。，．,.「」『』（）()・！？!?:：；;…ー〜~"'”“]/g, '');
function similarity(a, b) {
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(norm(a)); const Bm = grams(norm(b));
  let hit = 0; let total = 0;
  for (const [g, n] of A) { hit += Math.min(n, Bm.get(g) || 0); total += n; }
  for (const n of Bm.values()) total += n;
  return total ? (2 * hit) / total : 0;
}

async function main() {
  if (keys().length === 0) {
    console.error('GEMINI_API_KEY が設定されていません。クラウド環境の設定（環境変数）に入れてから、新しいセッションで実行してください。');
    process.exit(1);
  }
  mkdirSync(AUDIO, { recursive: true });
  const model = await pickTtsModel();
  const todo = SLIDES.filter((s) => s.say && (!ONLY || ONLY.has(s.id)));
  let made = 0;
  const report = [];
  for (const s of todo) {
    const wavPath = path.join(AUDIO, `${s.id}.wav`);
    const metaPath = path.join(AUDIO, `${s.id}.json`);
    const prev = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null;
    // style: true は、指示文ごと読み上げていた以前の作り方の音声。作り直す
    if (!FORCE && prev && !prev.style && prev.text === s.say && prev.voice === VOICE && existsSync(wavPath)) {
      report.push(prev);
      continue;
    }
    console.log(`${s.id}：作成中…`);
    let wav; let meta;
    for (let round = 1; round <= 2; round++) {
      const w = await speak(model, s.say);
      const m = { id: s.id, text: s.say, voice: VOICE, model, sec: Number(wavSeconds(w).toFixed(2)) };
      // 1秒あたりの文字数。原稿にない言葉まで読んだり、途中で切れたりすると外れる
      // （文字起こしは、そうした食い違いを言い直して書くことがあり、それだけでは見逃す）
      m.cps = Number((norm(s.say).length / Math.max(0.1, m.sec)).toFixed(2));
      m.ok = m.cps >= 2.4 && m.cps <= 8;
      if (VERIFY) {
        m.heard = await transcribe(w);
        m.similarity = Number(similarity(s.say, m.heard).toFixed(2));
        const lenRatio = norm(m.heard).length / Math.max(1, norm(s.say).length);
        m.ok = m.ok && m.similarity >= 0.55 && lenRatio > 0.7 && lenRatio < 1.4;
      }
      if (!meta || (m.ok && !meta.ok) || (m.ok === meta.ok && (m.similarity || 0) > (meta.similarity || 0))) { wav = w; meta = m; }
      if (m.ok) break;
      console.log(`  食い違いがありました（${VERIFY ? `一致度 ${m.similarity}、` : ''}1秒あたり${m.cps}字）。${round === 1 ? 'もう一度作ります' : 'よいほうを残します'}`);
    }
    writeFileSync(wavPath, wav);
    writeFileSync(metaPath, JSON.stringify(meta, null, 1));
    report.push(meta);
    made += 1;
    console.log(`  ${meta.sec}秒／1秒あたり${meta.cps}字${VERIFY ? `／一致度 ${meta.similarity}` : ''}`);
  }
  const total = report.reduce((a, m) => a + (m.sec || 0), 0);
  const bad = report.filter((m) => m.ok === false);
  console.log(`\n${made}件を作成、${report.length}/${todo.length}件そろっています（読み上げ合計 ${total.toFixed(1)}秒）。`);
  if (bad.length) console.log(`聞き取り確認で食い違いが残っています：${bad.map((m) => `${m.id}（一致度 ${m.similarity}、1秒あたり${m.cps}字）`).join('、')}。audio/<id>.json の heard を見て、原稿の読み方を直してください。`);
}

main().catch((e) => {
  if (e instanceof StopError) {
    console.error(`\n止めました：${e.message}`);
    console.error('作り終えたスライドの音声は audio/ に残っています。もう一度実行すると続きから作ります。');
    process.exit(2);
  }
  throw e;
});
