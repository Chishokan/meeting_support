// 動画「部門会議の進め方」を作る。
//   node render.mjs            … 台本（storyboard.mjs）＋ナレーション（audio/）→ out/dept-meeting.mp4、out/poster.jpg
//   node render.mjs --silent   … ナレーションなし（字幕だけ）で作る
//   node render.mjs --only 3   … 確認用に3枚目のコマだけ撮る（動画は作らない）
//
// しくみ：slides.html をブラウザで開き、render(t) で時間を進めながら1コマずつ撮り、ffmpeg で MP4 にする。
// ナレーションがあるスライドは、読み上げが終わるまで表示する（前後に少し間をあける）。
// 必要なもの：Node 22、ffmpeg（libx264）、Playwright の Chromium。

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { SLIDES } from './storyboard.mjs';

const { chromium } = await import('playwright').catch(() => import('/opt/node-tools/node_modules/playwright/index.mjs'));

const DIR = path.dirname(new URL(import.meta.url).pathname);
const FRAMES = path.join(DIR, 'frames');
const OUT = path.join(DIR, 'out');
const AUDIO = path.join(DIR, 'audio');
const FPS = 30;
const LEAD = 0.7; // スライドが出てから読み始めるまで（秒）
const TAIL = 1.0; // 読み終えてから次のスライドまで（秒）

const args = process.argv.slice(2);
const SILENT = args.includes('--silent');
const only = args.includes('--only') ? Number(args[args.indexOf('--only') + 1]) : null;

// 字幕だけのときの表示時間：字幕を読み切れる長さ＋余白
function readingTime(s) {
  if (s.dur) return s.dur;
  const text = [s.title, ...(s.body || []), s.note || '', s.tip || ''].join('').replace(/<[^>]+>/g, '');
  return Math.min(11, Math.max(5.5, 2.4 + text.length / 9));
}

// そのスライドのナレーション（原稿が変わっていたら使わない）
function narrationOf(s) {
  if (SILENT || !s.say) return null;
  const meta = path.join(AUDIO, `${s.id}.json`);
  const wav = path.join(AUDIO, `${s.id}.wav`);
  if (!existsSync(meta) || !existsSync(wav)) return null;
  const m = JSON.parse(readFileSync(meta, 'utf8'));
  return m.text === s.say ? { wav, sec: m.sec } : null;
}

const narr = SLIDES.map(narrationOf);
if (!SILENT && only == null) {
  const missing = SLIDES.filter((s, i) => s.say && !narr[i]).map((s) => s.id);
  if (missing.length) {
    console.error(`ナレーションがまだ無いスライドがあります：${missing.join(', ')}`);
    console.error('先に node tts.mjs を実行してください（字幕だけで作るときは --silent）。');
    process.exit(1);
  }
}

const shots = {};
for (const s of SLIDES) {
  if (s.shot && !shots[s.shot]) shots[s.shot] = JSON.parse(readFileSync(path.join(DIR, 'shots', `${s.shot}.json`), 'utf8'));
}
writeFileSync(path.join(DIR, 'data.js'), `const SLIDES = ${JSON.stringify(SLIDES)};\nconst SHOTS = ${JSON.stringify(shots)};\n`);

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`file://${path.join(DIR, 'slides.html')}`, { waitUntil: 'networkidle' });
const broken = await page.evaluate(() => window.ready());
if (broken.length) throw new Error(`画像が読めません: ${broken.join(', ')}`);

const list = [];
const durs = [];
let posterAt = 0;
let total = 0;
for (let i = 0; i < SLIDES.length; i++) {
  if (only != null && i !== only) continue;
  const s = SLIDES[i];
  const animEnd = await page.evaluate(([k]) => window.show(k, 0), [i]);
  const n = Math.ceil(animEnd * FPS);
  let dur = narr[i] ? Math.max(animEnd + 1, LEAD + narr[i].sec + TAIL) : readingTime(s);
  // 映像と音声がずれないよう、表示時間を1コマの長さの倍数にそろえる
  dur = Math.max(n + 1, Math.round(dur * FPS)) / FPS;
  for (let f = 0; f <= n; f++) {
    const t = Math.min(f / FPS, animEnd);
    await page.evaluate(([k, tt]) => window.show(k, tt), [i, t]);
    const file = path.join(FRAMES, `${String(i).padStart(2, '0')}_${String(f).padStart(3, '0')}.png`);
    await page.screenshot({ path: file });
    list.push({ file, d: f < n ? 1 / FPS : dur - n / FPS });
  }
  if (s.id === 'flow') posterAt = total + dur - 0.5;
  durs.push(dur);
  total += dur;
  console.log(`slide ${i} ${s.id} ${dur.toFixed(2)}s${narr[i] ? `（読み上げ ${narr[i].sec}s）` : ''}`);
}
await browser.close();
if (only != null) process.exit(0);

const lines = ['ffconcat version 1.0'];
for (const x of list) lines.push(`file '${x.file}'`, `duration ${x.d.toFixed(6)}`);
lines.push(`file '${list[list.length - 1].file}'`);
writeFileSync(path.join(OUT, 'frames.txt'), lines.join('\n'));

const ff = (a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });

// 音声トラック：スライドごとに「間＋読み上げ＋間」をスライドの長さぴったりに作ってつなぐ
let audioIn = ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
let audioFilter = [];
if (!SILENT) {
  const segs = [];
  SLIDES.forEach((s, i) => {
    const seg = path.join(OUT, `seg_${String(i).padStart(2, '0')}.wav`);
    if (narr[i]) {
      ff(['-i', narr[i].wav, '-af', `adelay=${Math.round(LEAD * 1000)}:all=1,apad=whole_dur=${durs[i]}`,
        '-t', String(durs[i]), '-ar', '24000', '-ac', '1', seg]);
    } else {
      ff(['-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(durs[i]), seg]);
    }
    segs.push(seg);
  });
  writeFileSync(path.join(OUT, 'segs.txt'), segs.map((f) => `file '${f}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'segs.txt'), '-c', 'copy', path.join(OUT, 'narration.wav')]);
  audioIn = ['-i', path.join(OUT, 'narration.wav')];
  // 聞きやすい音量にそろえる（配信動画の目安 -16 LUFS）
  audioFilter = ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000', '-ac', '2'];
}

// Web 版マニュアル（Artifact）に載せられる1ファイルは15MBまで。ナレーション入り（4分半ほど）で14MBを切るよう、
// 画質は crf 24、音声は 96k にしている（crf 20 との違いは、静止したコマの細かい字でも見分けられない）
const mp4 = path.join(OUT, 'dept-meeting.mp4');
ff([
  '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'frames.txt'),
  ...audioIn,
  '-map', '0:v', '-map', '1:a',
  '-vf', `fps=${FPS},format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-tune', 'stillimage',
  ...audioFilter,
  '-c:a', 'aac', '-b:a', SILENT ? '64k' : '96k', '-shortest',
  '-movflags', '+faststart',
  mp4,
]);
ff(['-ss', String(posterAt.toFixed(2)), '-i', mp4, '-frames:v', '1', '-vf', 'scale=1280:-1', '-q:v', '3', path.join(OUT, 'poster.jpg')]);
console.log(`合計 ${total.toFixed(1)}秒 → ${mp4}`);
